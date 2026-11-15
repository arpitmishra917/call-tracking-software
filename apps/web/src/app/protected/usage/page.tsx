'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Phone, Clock, HardDrive } from 'lucide-react';

type UsageSummary = {
  CALL_MINUTE: number;
  PHONE_NUMBER: number;
  RECORDING_STORAGE: number;
};

type UsageData = {
  summary: UsageSummary;
  active_phone_numbers?: number;
  period_start: string | null;
  period_end: string | null;
};

export default function UsagePage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/billing`);
      setUsage(data.usage || null);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (!ignore) {
        setLoading(true);
        fetchUsage();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchUsage]);

  if (!workspaceId) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Select a workspace first.
      </div>
    );
  }

  const formatPeriod = (start: string | null, end: string | null) => {
    if (!start || !end) return 'Current Billing Period';
    return `${new Date(start).toLocaleDateString()} to ${new Date(end).toLocaleDateString()}`;
  };

  return (
    <div className="flex flex-col gap-8 pb-8 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Workspace Usage</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Review your usage metrics for the current billing cycle.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading usage data...</div>
      ) : usage && usage.summary ? (
        <div className="flex flex-col gap-6">
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Billing Period
                </p>
                <p className="text-lg font-semibold text-foreground">
                  {formatPeriod(usage.period_start, usage.period_end)}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Call Minutes
                </CardTitle>
                <Clock className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-foreground">
                  {usage.summary.CALL_MINUTE}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Total voice minutes processed
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Phone Numbers
                </CardTitle>
                <Phone className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-foreground">
                  {usage.active_phone_numbers ?? usage.summary.PHONE_NUMBER}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Active phone numbers provisioned
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recording Storage
                </CardTitle>
                <HardDrive className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-foreground">
                  {usage.summary.RECORDING_STORAGE}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Storage units consumed by call recordings
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center">
            <p>No usage data available for this workspace.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
