const fs = require('fs');

let content = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const regex = /async getCalls\([\s\S]*?return \{ items, total \};\r?\n  \}/m;

const correctLogic = `async getCalls(
    workspaceId: string,
    filters: {
      campaignId?: string;
      buyerId?: string;
      status?: CallState;
      callerNumber?: string;
      trackingNumber?: string;
      durationType?: 'talk' | 'total';
      minDurationSecs?: number;
      maxDurationSecs?: number;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    let durationIds: string[] | null = null;

    if (filters.durationType && (filters.minDurationSecs !== undefined || filters.maxDurationSecs !== undefined)) {
      const min = filters.minDurationSecs || 0;
      
      let durationSql = filters.durationType === 'talk' 
          ? Prisma.sql\`EXTRACT(EPOCH FROM (ended_at - answered_at))\` 
          : Prisma.sql\`EXTRACT(EPOCH FROM (ended_at - started_at))\`;

      let maxCondition = Prisma.sql\`1=1\`;
      if (filters.maxDurationSecs !== undefined) {
         maxCondition = Prisma.sql\`\${durationSql} <= \${filters.maxDurationSecs}\`;
      }

      let notNullCondition = filters.durationType === 'talk'
          ? Prisma.sql\`ended_at IS NOT NULL AND answered_at IS NOT NULL\`
          : Prisma.sql\`ended_at IS NOT NULL AND started_at IS NOT NULL\`;

      const results = await this.prisma.$queryRaw<{id: string}[]>\`
        SELECT id FROM "calls" 
        WHERE workspace_id = \${workspaceId} 
          AND \${notNullCondition}
          AND \${durationSql} >= \${min} 
          AND \${maxCondition}
      \`;
      durationIds = results.map(r => r.id);
    }

    const where: any = { workspace_id: workspaceId };

    if (durationIds !== null) {
      where.id = { in: durationIds };
    }

    if (filters.campaignId) {
      where.campaign_id = filters.campaignId;
    }
    if (filters.buyerId) {
      where.attempts = {
        some: { buyer_id: filters.buyerId },
      };
    }
    if (filters.status) {
      where.state = filters.status;
    }
    if (filters.callerNumber) {
      where.from_number = { contains: filters.callerNumber };
    }
    if (filters.trackingNumber) {
      where.to_number = filters.trackingNumber;
    }
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) {
         where.created_at.gte = new Date(\`\${filters.startDate}T00:00:00Z\`);
      }
      if (filters.endDate) {
         const end = new Date(\`\${filters.endDate}T00:00:00Z\`);
         end.setUTCDate(end.getUTCDate() + 1);
         where.created_at.lt = end;
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.call.findMany({
        where,
        include: {
          campaign: { select: { name: true } },
          attempts: {
            include: { buyer: { select: { name: true } } },
            orderBy: { created_at: 'asc' },
          },
          recordings: true,
        },
        orderBy: { created_at: 'desc' },
        skip: filters.offset || 0,
        take: filters.limit || 50,
      }),
      this.prisma.call.count({ where }),
    ]);

    const mappedItems = items.map((call: any) => {
       let talkDurationSecs: number | null = null;
       let totalDurationSecs: number | null = null;
       
       if (call.ended_at && call.answered_at && call.ended_at >= call.answered_at) {
          talkDurationSecs = Math.floor((call.ended_at.getTime() - call.answered_at.getTime()) / 1000);
       }
       
       if (call.ended_at && call.started_at && call.ended_at >= call.started_at) {
          totalDurationSecs = Math.floor((call.ended_at.getTime() - call.started_at.getTime()) / 1000);
       }

       return {
          ...call,
          talkDurationSecs,
          totalDurationSecs,
          recordings: call.recordings ? call.recordings.map((r: any) => ({
             id: r.id,
             status: r.status
          })) : []
       };
    });

    return { items: mappedItems, total };
  }`;

content = content.replace(regex, correctLogic);

fs.writeFileSync('apps/api/src/calls/calls.service.ts', content, 'utf8');
console.log('Patched getCalls method in calls.service.ts');
