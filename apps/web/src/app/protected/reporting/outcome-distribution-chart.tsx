'use client';

import React, { useState, useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportingMetrics } from './page';

export interface OutcomeDistributionChartProps {
  metrics: ReportingMetrics | null;
  isLoading?: boolean;
}

export interface OutcomeSlice {
  name: string;
  value: number;
  color: string;
  category: 'commercial' | 'operational';
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  total?: number;
}

const CustomOutcomeTooltip: React.FC<CustomTooltipProps> = ({ active, payload, total = 0 }) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0];
  const value = typeof data.value === 'number' ? data.value : 0;
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div
      data-testid="outcome-tooltip"
      className="bg-slate-900/95 border border-slate-700/80 rounded-lg p-2.5 shadow-2xl text-xs space-y-1 min-w-[140px] z-50 text-slate-100 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: data.payload.color }} />
        <span className="font-semibold text-slate-200">{data.name}</span>
      </div>
      <div className="flex items-center justify-between gap-4 font-mono">
        <span className="text-slate-400">Calls:</span>
        <span className="font-bold text-slate-100">{value.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4 font-mono text-[11px]">
        <span className="text-slate-400">Share:</span>
        <span className="text-emerald-400">{pct}%</span>
      </div>
    </div>
  );
};

export function OutcomeDistributionChart({ metrics, isLoading = false }: OutcomeDistributionChartProps) {
  // Determine if commercial metrics exist in current workspace and filter scope
  const hasCommercialData = useMemo(() => {
    if (!metrics) return false;
    return (
      (metrics.commercialCalls !== undefined && metrics.commercialCalls > 0) ||
      (metrics.converted !== undefined && metrics.converted > 0) ||
      metrics.revenue !== undefined
    );
  }, [metrics]);

  // Default to commercial view if commercial data is configured and present, otherwise operational
  const [mode, setMode] = useState<'commercial' | 'operational'>('commercial');

  // Commercial Outcomes (aligned with Calls by Day series):
  // 1. Converted: evaluated commercial calls where talk duration >= conversion_duration_secs
  // 2. Not Converted: evaluated commercial calls where talk duration < conversion_duration_secs
  //    (strictly excluding unevaluated calls)
  // 3. No Answer: calls in terminal state NO_ANSWER or CANCELED
  const commercialData = useMemo<OutcomeSlice[]>(() => {
    if (!metrics) return [];

    const converted = typeof metrics.converted === 'number' ? metrics.converted : 0;
    const commercialCalls = typeof metrics.commercialCalls === 'number' ? metrics.commercialCalls : 0;
    // Unevaluated calls are strictly excluded: only evaluated calls are considered for Not Converted
    const notConverted = commercialCalls > 0 ? Math.max(0, commercialCalls - converted) : 0;
    const noAnswer = typeof metrics.missed === 'number' ? metrics.missed : 0;

    const slices: OutcomeSlice[] = [
      { name: 'Converted', value: converted, color: '#10b981', category: 'commercial' },
      { name: 'Not Converted', value: notConverted, color: '#64748b', category: 'commercial' },
      { name: 'No Answer', value: noAnswer, color: '#f97316', category: 'commercial' },
    ];

    return slices.filter((s) => s.value > 0);
  }, [metrics]);

  // Operational Telephony Outcomes (aligned with call status):
  // 1. Answered: c.state = COMPLETED
  // 2. Missed: c.state IN (NO_ANSWER, CANCELED)
  // 3. Failed: c.state = FAILED (unblocked)
  // 4. Blocked: c.state = FAILED (blocked by blacklist rule)
  const operationalData = useMemo<OutcomeSlice[]>(() => {
    if (!metrics) return [];

    const answered = typeof metrics.answered === 'number' ? metrics.answered : 0;
    const missed = typeof metrics.missed === 'number' ? metrics.missed : 0;
    const failed = typeof metrics.failed === 'number' ? metrics.failed : 0;
    const blocked = typeof metrics.blocked === 'number' ? metrics.blocked : 0;

    const slices: OutcomeSlice[] = [
      { name: 'Answered', value: answered, color: '#10b981', category: 'operational' },
      { name: 'Missed', value: missed, color: '#f97316', category: 'operational' },
      { name: 'Failed', value: failed, color: '#ef4444', category: 'operational' },
    ];

    if (blocked > 0) {
      slices.push({ name: 'Blocked', value: blocked, color: '#8b5cf6', category: 'operational' });
    }

    return slices.filter((s) => s.value > 0);
  }, [metrics]);

  const activeData = mode === 'commercial' ? commercialData : operationalData;

  const totalEvaluated = useMemo(() => {
    return activeData.reduce((acc, curr) => acc + curr.value, 0);
  }, [activeData]);

  const subtitle =
    mode === 'commercial'
      ? 'Commercial conversion breakdown'
      : 'Telephony connection states';

  return (
    <Card className="flex flex-col" data-testid="outcome-distribution-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-0.5">
          <CardTitle className="text-base font-semibold" data-testid="outcome-title">
            Outcome Distribution
          </CardTitle>
          <p className="text-xs text-muted-foreground" data-testid="outcome-subtitle">
            {subtitle}
          </p>
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'commercial' | 'operational')}
          className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus:outline-hidden focus:ring-1 focus:ring-ring"
          aria-label="Outcome Classification Mode"
          data-testid="outcome-mode-select"
        >
          <option value="commercial">Commercial</option>
          <option value="operational">Operational</option>
        </select>
      </CardHeader>

      <CardContent className="flex-1 min-h-[300px] flex items-center justify-center">
        {isLoading ? (
          <div className="w-full flex flex-col items-center justify-center p-6 space-y-3" data-testid="outcome-loading-state">
            <Skeleton className="h-32 w-32 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : activeData.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center p-6 space-y-1" data-testid="outcome-empty-state">
            <p className="font-medium text-foreground">No call outcomes</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {mode === 'commercial'
                ? 'No commercial calls recorded for the selected filters. Switch to Operational to view telephony states.'
                : 'No calls recorded for the selected filters.'}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260} data-testid="outcome-chart-container">
            <PieChart>
              <Pie
                data={activeData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={88}
                paddingAngle={3}
                dataKey="value"
                nameKey="name"
              >
                {activeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <RechartsTooltip content={<CustomOutcomeTooltip total={totalEvaluated} />} />
              <Legend
                iconType="circle"
                layout="horizontal"
                verticalAlign="bottom"
                align="center"
                wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
