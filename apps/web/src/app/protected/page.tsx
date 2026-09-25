'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneCall, PhoneMissed, ShieldBan, Clock, Activity, Megaphone, Users } from 'lucide-react';

interface DashboardMetrics {
  total: number;
  answered: number;
  missed: number;
  blocked: number;
  avgDuration: number;
  campaigns: Record<string, { total: number; answered: number }>;
  buyers: Record<string, { total: number; answered: number }>;
}

export default function ProtectedPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    async function loadMetrics() {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (startDate) query.set('startDate', startDate);
        if (endDate) query.set('endDate', endDate);
        const data = await apiFetch(`/workspaces/${workspaceId}/calls/metrics?${query.toString()}`);
        setMetrics(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadMetrics();
    }
  }, [workspaceId, startDate, endDate]);

  if (!workspaceId) return <div className="p-6 text-muted-foreground">Select a workspace first.</div>;

  return (
    <div className="space-y-8">
      {/* Header & Date Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your call operations.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="startDate" className="sr-only">Start Date</Label>
            <Input 
              id="startDate" 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)} 
              className="w-auto h-9" 
            />
          </div>
          <span className="text-muted-foreground text-sm">to</span>
          <div className="flex items-center gap-2">
            <Label htmlFor="endDate" className="sr-only">End Date</Label>
            <Input 
              id="endDate" 
              type="date" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)} 
              className="w-auto h-9" 
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-24 bg-muted rounded"></div>
                <div className="h-4 w-4 bg-muted rounded"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !metrics ? (
        <EmptyState 
          icon={<Activity className="h-6 w-6" />}
          title="No metrics available"
          description="We couldn't load the call metrics for this workspace."
        />
      ) : (
        <div className="space-y-8">
          {/* KPI Cards */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{metrics.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Answered</CardTitle>
                <PhoneCall className="h-4 w-4 text-success-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-success-muted-foreground">{metrics.answered}</div>
                {metrics.total > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {Math.round((metrics.answered / metrics.total) * 100)}% answer rate
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Missed</CardTitle>
                <PhoneMissed className="h-4 w-4 text-warning-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-warning-muted-foreground">{metrics.missed}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Blocked</CardTitle>
                <ShieldBan className="h-4 w-4 text-error-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-error-muted-foreground">{metrics.blocked}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Campaign Performance */}
            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-primary" />
                  <CardTitle>Campaign Performance</CardTitle>
                </div>
                <CardDescription>
                  Call volumes and answer rates by campaign.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                {Object.keys(metrics.campaigns || {}).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No campaign data available for this period.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(metrics.campaigns).map(([id, stats]) => (
                      <div key={id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">{id}</span>
                          <span className="text-xs text-muted-foreground">
                            {stats.total} total calls
                          </span>
                        </div>
                        <Badge variant="success">
                          {stats.answered} ans
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Buyer Performance */}
            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <CardTitle>Buyer Performance</CardTitle>
                </div>
                <CardDescription>
                  Call volumes and answer rates by buyer.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                {Object.keys(metrics.buyers || {}).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No buyer data available for this period.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(metrics.buyers).map(([id, stats]) => (
                      <div key={id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">{id}</span>
                          <span className="text-xs text-muted-foreground">
                            {stats.total} total calls
                          </span>
                        </div>
                        <Badge variant="success">
                          {stats.answered} ans
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
