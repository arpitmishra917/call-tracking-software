'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { BarChart3, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Clock } from 'lucide-react';

type Metrics = {
  total: number;
  answered: number;
  missed: number;
  blocked: number;
  avgDuration: number;
  campaigns: Record<string, { total: number; answered: number }>;
  buyers: Record<string, { total: number; answered: number }>;
};

type Campaign = { id: string; name: string };
type Buyer = { id: string; name: string };

export default function ReportingPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [campaignMap, setCampaignMap] = useState<Record<string, string>>({});
  const [buyerMap, setBuyerMap] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchMetrics = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append('startDate', new Date(startDate).toISOString());
      if (endDate) {
        // End of the selected day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        queryParams.append('endDate', end.toISOString());
      }
      
      const qs = queryParams.toString();
      const metricsUrl = `/workspaces/${workspaceId}/calls/metrics${qs ? `?${qs}` : ''}`;
      
      const [metricsData, campaignsData, buyersData] = await Promise.all([
        apiFetch(metricsUrl),
        apiFetch(`/workspaces/${workspaceId}/campaigns`).catch(() => []),
        apiFetch(`/workspaces/${workspaceId}/buyers`).catch(() => [])
      ]);
      
      setMetrics(metricsData);
      
      // Build maps for human-readable names
      const cMap: Record<string, string> = {};
      if (Array.isArray(campaignsData)) {
        campaignsData.forEach((c: Campaign) => { cMap[c.id] = c.name; });
      }
      setCampaignMap(cMap);
      
      const bMap: Record<string, string> = {};
      if (Array.isArray(buyersData)) {
        buyersData.forEach((b: Buyer) => { bMap[b.id] = b.name; });
      }
      setBuyerMap(bMap);
      
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, startDate, endDate]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (!ignore) {
        fetchMetrics();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchMetrics]);

  // Derived formats for display
  const formatDuration = (secs: number) => {
    if (!secs) return '0s';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const calculateRate = (part: number, total: number) => {
    if (total === 0) return '0%';
    return Math.round((part / total) * 100) + '%';
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Loading reporting data...
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Select a workspace first.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Reporting</h1>
          <p className="text-muted-foreground mt-2">
            Understand call volume, outcomes, and routing performance.
          </p>
        </div>
        
        {/* Date Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-background border rounded-md px-3 py-1.5 shadow-sm">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 border-0 shadow-none focus-visible:ring-0 p-0 w-32"
            />
            <span className="text-muted-foreground text-sm font-medium px-1">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 border-0 shadow-none focus-visible:ring-0 p-0 w-32"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {!metrics || metrics.total === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<BarChart3 />}
            title="No call data yet"
            description="Once calls are processed, reporting metrics and performance breakdowns will appear here."
          />
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneCall className="h-4 w-4" />
                  <span className="text-sm font-medium">Total Calls</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneIncoming className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">Answered</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.answered}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  Rate: {calculateRate(metrics.answered, metrics.total)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneMissed className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-medium">Missed/No Answer</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.missed}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneOff className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Blocked/Failed</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.blocked}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Avg Answered Duration</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDuration(metrics.avgDuration)}</div>
              </CardContent>
            </Card>
          </div>

          {/* Call Volume Visualization Placeholder */}
          <Card className="bg-muted/30 border-dashed">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Call Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BarChart3 className="h-8 w-8 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">Time-series visualization not available</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  The current API only provides aggregated metrics for the selected period. Daily or hourly breakdowns are not supported.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Campaign Performance */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Campaign Performance</CardTitle>
                <CardDescription>Breakdown of routing performance by campaign.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {Object.keys(metrics.campaigns).length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No campaign data in this period.</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="min-w-[150px]">Campaign</TableHead>
                        <TableHead className="text-right min-w-[100px]">Total Calls</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answered</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answer Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(metrics.campaigns).map(([id, stats]) => (
                        <TableRow key={id}>
                          <TableCell className="font-medium">
                            {campaignMap[id] || <span className="font-mono text-xs text-muted-foreground">{id}</span>}
                          </TableCell>
                          <TableCell className="text-right">{stats.total}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">{stats.answered}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs bg-muted">
                              {calculateRate(stats.answered, stats.total)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Buyer Performance */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Buyer Performance</CardTitle>
                <CardDescription>Breakdown of connection success by buyer.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {Object.keys(metrics.buyers).length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No buyer data in this period.</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="min-w-[150px]">Buyer</TableHead>
                        <TableHead className="text-right min-w-[100px]">Total Attempts</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answered</TableHead>
                        <TableHead className="text-right min-w-[100px]">Connect Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(metrics.buyers).map(([id, stats]) => (
                        <TableRow key={id}>
                          <TableCell className="font-medium">
                            {buyerMap[id] || <span className="font-mono text-xs text-muted-foreground">{id}</span>}
                          </TableCell>
                          <TableCell className="text-right">{stats.total}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">{stats.answered}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs bg-muted">
                              {calculateRate(stats.answered, stats.total)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
