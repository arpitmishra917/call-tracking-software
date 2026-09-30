const fs = require('fs');
let content = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const startStr = "async getMetrics(";
const startIndex = content.indexOf(startStr);
if (startIndex === -1) throw new Error("Could not find getMetrics");

// Find the end of the getMetrics function (next async function)
const nextFnIndex = content.indexOf("async commitBuyerDial(", startIndex);
if (nextFnIndex === -1) throw new Error("Could not find next function");

const before = content.slice(0, startIndex);
const after = content.slice(nextFnIndex);

const newGetMetrics = `async getMetrics(
    workspaceId: string,
    filters: { startDate?: string; endDate?: string },
  ) {
    const where: any = { workspace_id: workspaceId };
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) where.created_at.gte = new Date(filters.startDate);
      if (filters.endDate) where.created_at.lte = new Date(filters.endDate);
    }

    const calls = await this.prisma.call.findMany({
      where,
      select: {
        state: true,
        duration_secs: true,
        campaign_id: true,
        started_at: true,
        ended_at: true,
      },
    });

    const attempts = await this.prisma.callAttempt.findMany({
      where: {
        call: { workspace_id: workspaceId, ...where },
      },
      select: {
        state: true,
        buyer_id: true,
        started_at: true,
        ended_at: true,
      },
    });

    type MetricBreakdown = {
      total: number;
      answered: number;
      aclSecs: number | null;
      tclSecs: number | null;
      _tcl: number;
      _eligible: number;
    };

    const metrics = {
      total: calls.length,
      answered: calls.filter((c) => c.state === CallState.COMPLETED).length,
      missed: calls.filter(
        (c) =>
          c.state === CallState.NO_ANSWER ||
          c.state === CallState.FAILED ||
          c.state === CallState.CANCELED,
      ).length,
      blocked: calls.filter((c) => c.state === CallState.FAILED).length,
      avgDuration: 0,
      tclSecs: null as number | null,
      aclSecs: null as number | null,
      campaigns: {} as Record<string, MetricBreakdown>,
      buyers: {} as Record<string, MetricBreakdown>,
    };

    let totalDuration = 0;
    let durationCount = 0;
    
    let overallTCL = 0;
    let overallEligible = 0;

    calls.forEach((c) => {
      if (c.duration_secs) {
        totalDuration += c.duration_secs;
        durationCount++;
      }
      
      let eligibleDuration: number | null = null;
      if (c.started_at && c.ended_at && c.ended_at.getTime() >= c.started_at.getTime()) {
        eligibleDuration = Math.floor((c.ended_at.getTime() - c.started_at.getTime()) / 1000);
        overallTCL += eligibleDuration;
        overallEligible++;
      }

      if (c.campaign_id) {
        if (!metrics.campaigns[c.campaign_id]) {
          metrics.campaigns[c.campaign_id] = { total: 0, answered: 0, aclSecs: null, tclSecs: null, _tcl: 0, _eligible: 0 };
        }
        metrics.campaigns[c.campaign_id].total++;
        if (c.state === CallState.COMPLETED) {
          metrics.campaigns[c.campaign_id].answered++;
        }
        if (eligibleDuration !== null) {
          metrics.campaigns[c.campaign_id]._tcl += eligibleDuration;
          metrics.campaigns[c.campaign_id]._eligible++;
        }
      }
    });

    if (durationCount > 0) {
      metrics.avgDuration = Math.round(totalDuration / durationCount);
    }
    
    if (overallEligible > 0) {
      metrics.tclSecs = overallTCL;
      metrics.aclSecs = Math.round(overallTCL / overallEligible);
    }

    attempts.forEach((a) => {
      let eligibleDuration: number | null = null;
      if (a.started_at && a.ended_at && a.ended_at.getTime() >= a.started_at.getTime()) {
        eligibleDuration = Math.floor((a.ended_at.getTime() - a.started_at.getTime()) / 1000);
      }

      if (a.buyer_id) {
        if (!metrics.buyers[a.buyer_id]) {
          metrics.buyers[a.buyer_id] = { total: 0, answered: 0, aclSecs: null, tclSecs: null, _tcl: 0, _eligible: 0 };
        }
        metrics.buyers[a.buyer_id].total++;
        if (
          a.state === CallAttemptState.ANSWERED ||
          a.state === CallAttemptState.COMPLETED
        ) {
          metrics.buyers[a.buyer_id].answered++;
        }
        if (eligibleDuration !== null) {
          metrics.buyers[a.buyer_id]._tcl += eligibleDuration;
          metrics.buyers[a.buyer_id]._eligible++;
        }
      }
    });
    
    for (const key of Object.keys(metrics.campaigns)) {
      const camp = metrics.campaigns[key];
      if (camp._eligible > 0) {
        camp.tclSecs = camp._tcl;
        camp.aclSecs = Math.round(camp._tcl / camp._eligible);
      }
      delete (camp as any)._tcl;
      delete (camp as any)._eligible;
    }
    
    for (const key of Object.keys(metrics.buyers)) {
      const buyer = metrics.buyers[key];
      if (buyer._eligible > 0) {
        buyer.tclSecs = buyer._tcl;
        buyer.aclSecs = Math.round(buyer._tcl / buyer._eligible);
      }
      delete (buyer as any)._tcl;
      delete (buyer as any)._eligible;
    }

    return metrics;
  }

  `;

fs.writeFileSync('apps/api/src/calls/calls.service.ts', before + newGetMetrics + after, 'utf8');
console.log('Force-patched getMetrics successfully.');
