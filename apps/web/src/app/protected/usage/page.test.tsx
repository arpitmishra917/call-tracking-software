import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import UsagePage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

describe('UsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Select a workspace first." when workspace param is missing', () => {
    (useSearchParams as any).mockReturnValue({
      get: () => null,
    });

    render(<UsagePage />);
    expect(screen.getByText('Select a workspace first.')).toBeDefined();
  });

  it('renders loading state initially while fetching usage data', () => {
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-123' : null),
    });
    // Never resolves during this test
    (apiFetch as any).mockReturnValue(new Promise(() => {}));

    render(<UsagePage />);
    expect(screen.getByText('Loading usage data...')).toBeDefined();
  });

  it('handles error state when API request fails', async () => {
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-123' : null),
    });
    (apiFetch as any).mockRejectedValue(new Error('Network connection timeout'));

    render(<UsagePage />);

    expect(await screen.findByText('Network connection timeout')).toBeDefined();
  });

  it('renders the active phone numbers inventory count (3) when provided by the backend', async () => {
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-123' : null),
    });
    (apiFetch as any).mockResolvedValue({
      usage: {
        summary: {
          CALL_MINUTE: 17,
          PHONE_NUMBER: 0,
          RECORDING_STORAGE: 16,
        },
        active_phone_numbers: 3,
        period_start: '2026-10-01T00:00:00.000Z',
        period_end: '2026-10-31T23:59:59.000Z',
      },
    });

    render(<UsagePage />);

    // Active phone numbers inventory count of 3 must be displayed
    expect(await screen.findByText('3')).toBeDefined();
    expect(screen.getByText('17')).toBeDefined();
    expect(screen.getByText('16')).toBeDefined();
    expect(screen.getByText('Active phone numbers provisioned')).toBeDefined();
  });

  it('falls back to summary.PHONE_NUMBER if active_phone_numbers is undefined', async () => {
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-123' : null),
    });
    (apiFetch as any).mockResolvedValue({
      usage: {
        summary: {
          CALL_MINUTE: 10,
          PHONE_NUMBER: 2,
          RECORDING_STORAGE: 5,
        },
        period_start: null,
        period_end: null,
      },
    });

    render(<UsagePage />);

    expect(await screen.findByText('2')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });
});
