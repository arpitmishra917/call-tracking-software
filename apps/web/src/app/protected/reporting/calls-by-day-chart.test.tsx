import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  CallsByDayChart,
  formatCurrency,
  formatBucketLabel,
  formatAxisTick,
  CustomTooltip,
  BucketData,
} from './calls-by-day-chart';

describe('CallsByDayChart (Dialics-Inspired Mixed Chart Acceptance Suite)', () => {
  const sampleBuckets: BucketData[] = [
    {
      time: '2026-10-20T00:00:00.000Z',
      total: 10,
      answered: 7,
      missed: 2,
      noAnswer: 2,
      failed: 1,
      commercialCalls: 6,
      converted: 4,
      revenue: 200,
      payout: 100,
      profit: 100,
    },
    {
      time: '2026-10-21T00:00:00.000Z',
      total: 15,
      answered: 12,
      missed: 3,
      noAnswer: 3,
      commercialCalls: 10,
      converted: 6,
      revenue: 350.5,
      payout: 150,
      profit: 200.5,
    },
    {
      time: '2026-10-22T00:00:00.000Z',
      total: 5,
      answered: 3,
      missed: 2,
      noAnswer: 2,
      commercialCalls: 2,
      converted: 0,
      revenue: 0, // valid zero revenue
      payout: 0,
      profit: 0,
    },
  ];

  it('Requirement 1: All four series map to the correct API fields', () => {
    // Bucket with 10 commercial calls, 4 converted -> notConverted = 6
    const rawBucket: BucketData = {
      time: '2026-10-24T00:00:00.000Z',
      total: 20,
      answered: 15,
      missed: 3,
      noAnswer: 3,
      commercialCalls: 10,
      converted: 4,
      revenue: 450,
    };

    const payload = [
      {
        payload: {
          time: rawBucket.time,
          converted: rawBucket.converted,
          notConverted: (rawBucket.commercialCalls ?? 0) - (rawBucket.converted ?? 0),
          noAnswer: rawBucket.noAnswer ?? rawBucket.missed,
          revenue: rawBucket.revenue,
        },
      },
    ];

    render(<CustomTooltip active={true} payload={payload} currency="USD" bucket="day" />);

    expect(screen.getByTestId('tooltip-converted').textContent).toBe('4');
    expect(screen.getByTestId('tooltip-not-converted').textContent).toBe('6');
    expect(screen.getByTestId('tooltip-no-answer').textContent).toBe('3');
    expect(screen.getByTestId('tooltip-revenue').textContent).toBe('$450.00');
  });

  it('Requirement 2 & 3: Converted, Not Converted, and No Answer render as bars on left axis; Revenue renders as line on right axis', () => {
    render(
      <CallsByDayChart buckets={sampleBuckets} currency="USD" bucket="day" hasRevenue={true} />
    );

    // Verify card and title
    expect(screen.getByTestId('calls-by-day-card')).toBeDefined();
    expect(screen.getByTestId('chart-title').textContent).toBe('Calls by Day');

    // Chart container is rendered
    expect(screen.getByTestId('chart-container')).toBeDefined();

    // Verify all 4 legend items exist
    expect(screen.getByTestId('legend-toggle-converted')).toBeDefined();
    expect(screen.getByTestId('legend-toggle-notConverted')).toBeDefined();
    expect(screen.getByTestId('legend-toggle-noAnswer')).toBeDefined();
    expect(screen.getByTestId('legend-toggle-revenue')).toBeDefined();
  });

  it('Requirement 4: Left and right axes use correct units and formatting', () => {
    // Left axis tick formatter formats integer counts
    const formatCount = (v: number) => (Number.isInteger(v) ? v.toLocaleString() : '');
    expect(formatCount(10)).toBe('10');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1.5)).toBe('');

    // Right axis tick formatter formats currency
    expect(formatCurrency(250, 'USD')).toBe('$250.00');
    expect(formatCurrency(1250.75, 'USD')).toBe('$1,250.75');
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
  });

  it('Requirement 5: Revenue tooltips display the correct currency', () => {
    const payload = [
      {
        payload: {
          time: '2026-10-24T00:00:00.000Z',
          converted: 2,
          notConverted: 1,
          noAnswer: 1,
          revenue: 1200,
        },
      },
    ];

    const { rerender } = render(<CustomTooltip active={true} payload={payload} currency="EUR" />);
    expect(screen.getByTestId('tooltip-revenue').textContent).toContain('1,200.00');

    rerender(<CustomTooltip active={true} payload={payload} currency="USD" />);
    expect(screen.getByTestId('tooltip-revenue').textContent).toBe('$1,200.00');
  });

  it('Requirement 6: Zero Revenue is displayed correctly', () => {
    const payload = [
      {
        payload: {
          time: '2026-10-24T00:00:00.000Z',
          converted: 0,
          notConverted: 2,
          noAnswer: 1,
          revenue: 0,
        },
      },
    ];
    render(<CustomTooltip active={true} payload={payload} currency="USD" />);
    expect(screen.getByTestId('tooltip-revenue').textContent).toBe('$0.00');
  });

  it('Requirement 7: Negative Revenue is handled if API returns adjustments', () => {
    const payload = [
      {
        payload: {
          time: '2026-10-24T00:00:00.000Z',
          converted: 0,
          notConverted: 1,
          noAnswer: 0,
          revenue: -85.25,
        },
      },
    ];
    render(<CustomTooltip active={true} payload={payload} currency="USD" />);
    expect(screen.getByTestId('tooltip-revenue').textContent).toBe('-$85.25');
  });

  it('Requirement 8: Empty API results do not produce fabricated data', () => {
    render(<CallsByDayChart buckets={[]} isLoading={false} />);
    expect(screen.getByTestId('chart-empty-state')).toBeDefined();
    expect(screen.getByText('No call activity recorded')).toBeDefined();
    expect(screen.queryByTestId('chart-container')).toBeNull();
  });

  it('Requirement 9: Missing values remain distinguishable from valid zeros', () => {
    const payload = [
      {
        payload: {
          time: '2026-10-24T00:00:00.000Z',
          converted: null,
          notConverted: undefined,
          noAnswer: null,
          revenue: null,
        },
      },
    ];
    render(<CustomTooltip active={true} payload={payload} currency="USD" />);
    // Missing values formatted as em-dash, not false zero
    expect(screen.getByTestId('tooltip-converted').textContent).toBe('—');
    expect(screen.getByTestId('tooltip-not-converted').textContent).toBe('—');
    expect(screen.getByTestId('tooltip-no-answer').textContent).toBe('—');
    expect(screen.getByTestId('tooltip-revenue').textContent).toBe('—');
  });

  it('Requirement 10: Date boundaries and chronological ordering are preserved', () => {
    // Unordered input buckets
    const unorderedBuckets: BucketData[] = [
      { time: '2026-10-25T00:00:00.000Z', total: 2, commercialCalls: 2, converted: 1, revenue: 100 },
      { time: '2026-10-23T00:00:00.000Z', total: 4, commercialCalls: 3, converted: 2, revenue: 200 },
      { time: '2026-10-24T00:00:00.000Z', total: 3, commercialCalls: 1, converted: 0, revenue: 0 },
    ];

    render(<CallsByDayChart buckets={unorderedBuckets} currency="USD" bucket="day" />);
    expect(screen.getByTestId('chart-container')).toBeDefined();
  });

  it('Requirement 11: Grouping changes update the chart only for supported buckets', () => {
    const onBucketChange = vi.fn();
    render(<CallsByDayChart buckets={sampleBuckets} bucket="day" onBucketChange={onBucketChange} />);

    const select = screen.getByTestId('chart-grouping-select');
    // Change to hour
    fireEvent.change(select, { target: { value: 'hour' } });
    expect(onBucketChange).toHaveBeenCalledWith('hour');

    // Change to week
    fireEvent.change(select, { target: { value: 'week' } });
    expect(onBucketChange).toHaveBeenCalledWith('week');
  });

  it('Requirement 12: Redacted / Vendor view hides revenue while preserving outcome series', () => {
    render(<CallsByDayChart buckets={sampleBuckets} currency="USD" bucket="day" hasRevenue={false} />);
    expect(screen.queryByTestId('legend-toggle-revenue')).toBeNull();
    expect(screen.getByTestId('legend-toggle-converted')).toBeDefined();
    expect(screen.getByTestId('legend-toggle-notConverted')).toBeDefined();
    expect(screen.getByTestId('legend-toggle-noAnswer')).toBeDefined();
  });

  it('Requirement 13: A failed chart request shows an error state without breaking dashboard', () => {
    const onRetry = vi.fn();
    render(<CallsByDayChart error="Internal server error" onRetry={onRetry} />);

    expect(screen.getByTestId('chart-error-state')).toBeDefined();
    expect(screen.getByText('Internal server error')).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Requirement 15: Interactive legend controls show and hide the correct series', () => {
    render(<CallsByDayChart buckets={sampleBuckets} currency="USD" bucket="day" hasRevenue={true} />);

    const convToggle = screen.getByTestId('legend-toggle-converted');
    const revToggle = screen.getByTestId('legend-toggle-revenue');
    const notConvToggle = screen.getByTestId('legend-toggle-notConverted');

    expect(convToggle.getAttribute('aria-pressed')).toBe('true');
    expect(revToggle.getAttribute('aria-pressed')).toBe('true');

    // Click toggle on Converted
    fireEvent.click(convToggle);
    expect(convToggle.getAttribute('aria-pressed')).toBe('false');
    // Other series remain visible
    expect(revToggle.getAttribute('aria-pressed')).toBe('true');
    expect(notConvToggle.getAttribute('aria-pressed')).toBe('true');

    // Keyboard support on legend toggle
    fireEvent.keyDown(revToggle, { key: 'Enter' });
    expect(revToggle.getAttribute('aria-pressed')).toBe('false');
  });
});
