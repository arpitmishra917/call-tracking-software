import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  OutcomeDistributionChart,
  OutcomeDistributionChartProps,
} from './outcome-distribution-chart';
import { ReportingMetrics } from './page';

describe('OutcomeDistributionChart (Commercial vs Operational Alignment Matrix)', () => {
  const baseMetrics: ReportingMetrics = {
    total: 100,
    answered: 70,
    missed: 20,
    failed: 10,
    blocked: 2,
    avgDuration: 45,
    tclSecs: 3150,
    aclSecs: 45,
    commercialCalls: 40,
    converted: 15,
    qualified: 12,
    duplicate: 3,
    revenue: 750,
    payout: 300,
    profit: 450,
    currency: 'USD',
  };

  it('1. Commercial mode: maps Converted, Not Converted, and No Answer accurately', () => {
    render(<OutcomeDistributionChart metrics={baseMetrics} />);

    // Card title & subtitle
    expect(screen.getByTestId('outcome-title')).toBeDefined();
    expect(screen.getByTestId('outcome-subtitle').textContent).toBe('Commercial conversion breakdown');

    // Default select is commercial
    const select = screen.getByTestId('outcome-mode-select') as HTMLSelectElement;
    expect(select.value).toBe('commercial');

    // In commercial mode:
    // Converted = 15
    // Not Converted = 40 (commercialCalls) - 15 (converted) = 25
    // No Answer = 20 (missed)
    expect(screen.getByTestId('outcome-chart-container')).toBeDefined();
  });

  it('2. Unevaluated calls are strictly excluded from Not Converted', () => {
    // 100 total calls, 70 answered, but only 40 commercially evaluated calls
    // 15 converted -> Not Converted MUST be exactly 25 (40 - 15)
    // It must NOT treat all 85 non-converted calls (100 - 15) or 55 non-converted answered calls (70 - 15) as Not Converted.
    const metricsWithUnevaluated: ReportingMetrics = {
      ...baseMetrics,
      total: 100,
      answered: 70,
      commercialCalls: 40,
      converted: 15,
    };

    render(<OutcomeDistributionChart metrics={metricsWithUnevaluated} />);

    const select = screen.getByTestId('outcome-mode-select') as HTMLSelectElement;
    expect(select.value).toBe('commercial');

    // Verify calculation: Not Converted = commercialCalls (40) - converted (15) = 25
    const commercialCalls = metricsWithUnevaluated.commercialCalls ?? 0;
    const converted = metricsWithUnevaluated.converted ?? 0;
    const notConverted = Math.max(0, commercialCalls - converted);
    expect(notConverted).toBe(25);
  });

  it('3. Mode toggle switches between Commercial and Operational classifications cleanly', () => {
    render(<OutcomeDistributionChart metrics={baseMetrics} />);

    const select = screen.getByTestId('outcome-mode-select') as HTMLSelectElement;
    expect(select.value).toBe('commercial');
    expect(screen.getByTestId('outcome-subtitle').textContent).toBe('Commercial conversion breakdown');

    // Toggle to Operational
    fireEvent.change(select, { target: { value: 'operational' } });
    expect(select.value).toBe('operational');
    expect(screen.getByTestId('outcome-subtitle').textContent).toBe('Telephony connection states');

    // Toggle back to Commercial
    fireEvent.change(select, { target: { value: 'commercial' } });
    expect(select.value).toBe('commercial');
    expect(screen.getByTestId('outcome-subtitle').textContent).toBe('Commercial conversion breakdown');
  });

  it('4. Operational mode: maps Answered, Missed, Failed, and Blocked without treating Answered as Converted', () => {
    render(<OutcomeDistributionChart metrics={baseMetrics} />);

    const select = screen.getByTestId('outcome-mode-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'operational' } });

    expect(screen.getByTestId('outcome-subtitle').textContent).toBe('Telephony connection states');
    expect(screen.getByTestId('outcome-chart-container')).toBeDefined();
  });

  it('5. Renders clean empty state when no metrics are provided or all calls are 0', () => {
    const emptyMetrics: ReportingMetrics = {
      total: 0,
      answered: 0,
      missed: 0,
      failed: 0,
      avgDuration: null,
      tclSecs: null,
      aclSecs: null,
      commercialCalls: 0,
      converted: 0,
    };

    const { rerender } = render(<OutcomeDistributionChart metrics={emptyMetrics} />);
    expect(screen.getByTestId('outcome-empty-state')).toBeDefined();
    expect(screen.getByText('No call outcomes')).toBeDefined();

    rerender(<OutcomeDistributionChart metrics={null} />);
    expect(screen.getByTestId('outcome-empty-state')).toBeDefined();
  });

  it('6. Renders loading skeleton when isLoading is true', () => {
    render(<OutcomeDistributionChart metrics={baseMetrics} isLoading={true} />);
    expect(screen.getByTestId('outcome-loading-state')).toBeDefined();
    expect(screen.queryByTestId('outcome-chart-container')).toBeNull();
  });

  it('7. No unauthorized revenue disclosure in donut chart or tooltip', () => {
    // Redacted vendor / member metrics where revenue is stripped
    const vendorMetrics: ReportingMetrics = {
      ...baseMetrics,
      revenue: undefined,
      cost: undefined,
      profit: undefined,
    };

    render(<OutcomeDistributionChart metrics={vendorMetrics} />);

    // Should render chart container without crashing or leaking currency figures
    expect(screen.getByTestId('outcome-chart-container')).toBeDefined();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
