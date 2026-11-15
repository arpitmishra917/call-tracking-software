'use client';

import React, { useState, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function formatCurrency(amount: number | null | undefined, currency: string = 'USD'): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function formatBucketLabel(time: string | undefined, bucket: string = 'day'): string {
  if (!time) return '—';
  const d = new Date(time);
  if (isNaN(d.getTime())) return time;

  if (bucket === 'hour') {
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (bucket === 'week') {
    return `Week of ${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatAxisTick(time: string | undefined, bucket: string = 'day'): string {
  if (!time) return '';
  const d = new Date(time);
  if (isNaN(d.getTime())) return time;

  if (bucket === 'hour') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export interface BucketData {
  time?: string;
  bucket_time?: string;
  total?: number;
  answered?: number;
  missed?: number;
  noAnswer?: number;
  failed?: number;
  blocked?: number;
  revenue?: number | null;
  payout?: number | null;
  profit?: number | null;
  converted?: number | null;
  qualified?: number | null;
  duplicate?: number | null;
  commercialCalls?: number | null;
}

export interface CallsByDayChartProps {
  buckets?: BucketData[] | null;
  currency?: string;
  bucket?: string;
  onBucketChange?: (bucket: string) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  hasRevenue?: boolean;
}

export interface TransformedChartPoint {
  time: string;
  formattedTime: string;
  converted: number;
  notConverted: number;
  noAnswer: number;
  revenue: number | null;
  _raw: BucketData;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  currency?: string;
  bucket?: string;
  hasRevenue?: boolean;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  currency = 'USD',
  bucket = 'day',
  hasRevenue = true,
}) => {
  if (!active || !payload || !payload.length) return null;

  const data: TransformedChartPoint = payload[0]?.payload;
  if (!data) return null;

  const timeLabel = formatBucketLabel(data.time || label, bucket);

  return (
    <div
      data-testid="chart-tooltip"
      className="bg-slate-900/95 border border-slate-700/80 rounded-lg p-3 shadow-2xl text-xs space-y-2 min-w-[200px] z-50 text-slate-100 backdrop-blur-sm"
    >
      <div className="font-semibold text-slate-200 border-b border-slate-800 pb-1.5 flex items-center justify-between">
        <span>{timeLabel}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#10b981] inline-block" />
            Converted
          </span>
          <span className="font-mono font-medium text-slate-100" data-testid="tooltip-converted">
            {data.converted !== undefined && data.converted !== null ? Number(data.converted).toLocaleString() : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#64748b] inline-block" />
            Not Converted
          </span>
          <span className="font-mono font-medium text-slate-100" data-testid="tooltip-not-converted">
            {data.notConverted !== undefined && data.notConverted !== null ? Number(data.notConverted).toLocaleString() : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#f97316] inline-block" />
            No Answer
          </span>
          <span className="font-mono font-medium text-slate-100" data-testid="tooltip-no-answer">
            {data.noAnswer !== undefined && data.noAnswer !== null ? Number(data.noAnswer).toLocaleString() : '—'}
          </span>
        </div>
        {hasRevenue && (
          <div className="flex items-center justify-between gap-4 pt-1.5 border-t border-slate-800">
            <span className="flex items-center gap-1.5 text-blue-400 font-medium">
              <span className="w-2.5 h-0.5 bg-[#3b82f6] inline-block" />
              Revenue
            </span>
            <span className="font-mono font-bold text-blue-300" data-testid="tooltip-revenue">
              {data.revenue !== undefined && data.revenue !== null ? formatCurrency(data.revenue, currency) : '—'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export function CallsByDayChart({
  buckets,
  currency = 'USD',
  bucket = 'day',
  onBucketChange,
  isLoading = false,
  error = null,
  onRetry,
  hasRevenue = true,
}: CallsByDayChartProps) {
  const [visibleSeries, setVisibleSeries] = useState({
    converted: true,
    notConverted: true,
    noAnswer: true,
    revenue: true,
  });

  const toggleSeries = (key: keyof typeof visibleSeries) => {
    setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const chartData = useMemo<TransformedChartPoint[]>(() => {
    if (!buckets || !Array.isArray(buckets) || buckets.length === 0) {
      return [];
    }

    const items = buckets.map((b) => {
      const rawTime = b.time || b.bucket_time || '';
      const converted = typeof b.converted === 'number' ? b.converted : 0;
      const commercialCalls = typeof b.commercialCalls === 'number' ? b.commercialCalls : 0;
      // Eligible, evaluated calls classified as not converted
      const notConverted = commercialCalls > 0 ? Math.max(0, commercialCalls - converted) : 0;
      // No Answer: count from existing reporting missed / noAnswer definition
      const noAnswer = typeof b.noAnswer === 'number' ? b.noAnswer : typeof b.missed === 'number' ? b.missed : 0;
      // Recognized revenue: preserve null if unavailable, else format numeric
      const revenue = b.revenue !== undefined && b.revenue !== null && !isNaN(Number(b.revenue)) ? Number(b.revenue) : null;

      return {
        time: rawTime,
        formattedTime: formatAxisTick(rawTime, bucket),
        converted,
        notConverted,
        noAnswer,
        revenue,
        _raw: b,
      };
    });

    // Ensure chronological ordering
    return items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }, [buckets, bucket]);

  const seriesButtons = [
    { key: 'converted' as const, label: 'Converted', color: '#10b981', type: 'bar' },
    { key: 'notConverted' as const, label: 'Not Converted', color: '#64748b', type: 'bar' },
    { key: 'noAnswer' as const, label: 'No Answer', color: '#f97316', type: 'bar' },
    ...(hasRevenue ? [{ key: 'revenue' as const, label: 'Revenue', color: '#3b82f6', type: 'line' }] : []),
  ];

  const titleText = bucket === 'hour' ? 'Calls by Hour' : bucket === 'week' ? 'Calls by Week' : 'Calls by Day';

  return (
    <Card className="col-span-1 lg:col-span-2 flex flex-col" data-testid="calls-by-day-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-0.5">
          <CardTitle className="text-base font-semibold" data-testid="chart-title">
            {titleText}
          </CardTitle>
          <p className="text-xs text-muted-foreground hidden sm:block">
            Outcomes and recognized revenue over time
          </p>
        </div>
        {onBucketChange && (
          <select
            value={bucket}
            onChange={(e) => onBucketChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus:outline-hidden focus:ring-1 focus:ring-ring"
            aria-label="Time Grouping"
            data-testid="chart-grouping-select"
          >
            <option value="hour">Hourly</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
          </select>
        )}
      </CardHeader>

      <CardContent className="flex-1 min-h-[340px] flex flex-col justify-between">
        {error ? (
          <div
            className="h-full min-h-[280px] w-full flex flex-col items-center justify-center text-center p-6"
            data-testid="chart-error-state"
          >
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm font-semibold text-foreground">Failed to load chart metrics</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">{error}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 h-8 text-xs">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            )}
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-2 min-h-[280px] flex flex-col justify-center" data-testid="chart-loading-state">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-[240px] w-full rounded-md" />
          </div>
        ) : chartData.length === 0 ? (
          <div
            className="h-full min-h-[280px] w-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground"
            data-testid="chart-empty-state"
          >
            <BarChart3 className="h-10 w-10 text-muted-foreground/30 mb-2 stroke-1" />
            <p className="text-sm font-medium text-foreground">No call activity recorded</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              No calls match the selected filters for this time period.
            </p>
          </div>
        ) : (
          <div className="w-full h-[280px] pt-2" data-testid="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 12, right: hasRevenue ? 16 : 10, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/40" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => formatAxisTick(t, bucket)}
                  tick={{ fontSize: 11 }}
                  axisLine={{ stroke: 'currentColor', className: 'text-border/60' }}
                  tickLine={false}
                />
                {/* Left YAxis: integer call counts */}
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  axisLine={{ stroke: 'currentColor', className: 'text-border/60' }}
                  tickLine={false}
                  tickFormatter={(v) => (Number.isInteger(v) ? v.toLocaleString() : '')}
                  domain={[0, 'auto']}
                />
                {/* Right YAxis: recognized currency */}
                {hasRevenue && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    axisLine={{ stroke: 'currentColor', className: 'text-border/60' }}
                    tickLine={false}
                    tickFormatter={(v) => formatCurrency(v, currency)}
                    domain={[
                      (dataMin: number) => (dataMin < 0 ? dataMin : 0),
                      (dataMax: number) => (dataMax <= 0 ? 100 : 'auto'),
                    ]}
                  />
                )}
                <RechartsTooltip
                  content={<CustomTooltip currency={currency} bucket={bucket} hasRevenue={hasRevenue} />}
                  cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                />

                <Bar
                  yAxisId="left"
                  dataKey="converted"
                  name="Converted"
                  fill="#10b981"
                  hide={!visibleSeries.converted}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  yAxisId="left"
                  dataKey="notConverted"
                  name="Not Converted"
                  fill="#64748b"
                  hide={!visibleSeries.notConverted}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  yAxisId="left"
                  dataKey="noAnswer"
                  name="No Answer"
                  fill="#f97316"
                  hide={!visibleSeries.noAnswer}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
                {hasRevenue && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#3b82f6' }}
                    activeDot={{ r: 5, stroke: '#60a5fa', strokeWidth: 2 }}
                    hide={!visibleSeries.revenue}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Interactive Accessible Legend Controls */}
        <div
          className="flex flex-wrap items-center justify-center gap-2 pt-3 border-t border-border/40 text-xs"
          role="toolbar"
          aria-label="Chart Series Legend"
          data-testid="interactive-legend"
        >
          {seriesButtons.map((s) => {
            const isVisible = visibleSeries[s.key];
            return (
              <button
                key={s.key}
                type="button"
                role="button"
                aria-pressed={isVisible}
                aria-label={`Toggle ${s.label} series`}
                tabIndex={0}
                onClick={() => toggleSeries(s.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSeries(s.key);
                  }
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer border select-none ${
                  isVisible
                    ? 'border-border/60 bg-muted/40 text-foreground font-medium shadow-xs hover:bg-muted/60'
                    : 'border-transparent text-muted-foreground/50 line-through opacity-50 hover:opacity-75'
                }`}
                data-testid={`legend-toggle-${s.key}`}
              >
                <span
                  className="rounded-xs shrink-0"
                  style={{
                    backgroundColor: s.type === 'line' ? 'transparent' : s.color,
                    border: s.type === 'line' ? `2px solid ${s.color}` : 'none',
                    height: s.type === 'line' ? '2px' : '10px',
                    width: s.type === 'line' ? '12px' : '10px',
                  }}
                />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
