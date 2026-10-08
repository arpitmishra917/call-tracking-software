import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CallDetailPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('CallDetailPage Dispute & Adjustment UI (COMM-INTEGRATION-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-456' : null),
    });
  });

  it('renders commercial financial details and dispute filing button when no dispute exists', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-1')) {
        return Promise.resolve({
          id: 'call-1',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-1',
            status: 'PENDING',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 100,
            payout: 50,
            currency: 'USD',
            buyer: { id: 'b-1', name: 'Premium Buyer' },
            dispute: null,
          },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('Commercial Economics')).toBeDefined();
      expect(screen.getByText('File Dispute')).toBeDefined();
    });
  });

  it('allows user to file a dispute with reason and description', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-1')) {
        return Promise.resolve({
          id: 'call-1',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-1',
            status: 'PENDING',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 100,
            currency: 'USD',
            dispute: null,
          },
        });
      }
      if (url.includes('/call-commercials/comm-1/dispute')) {
        return Promise.resolve({
          id: 'disp-created-1',
          status: 'PENDING',
          reason: 'Call was silence only',
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('File Dispute')).toBeDefined();
    });

    fireEvent.click(screen.getByText('File Dispute'));

    const reasonInput = screen.getByLabelText(/Reason \*/i);
    fireEvent.change(reasonInput, { target: { value: 'Call was silence only' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit Dispute' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-456/call-commercials/comm-1/dispute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            reason: 'Call was silence only',
          }),
        })
      );
    });
  });

  it('renders pending dispute and allows resolving dispute', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-2')) {
        return Promise.resolve({
          id: 'call-2',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-2',
            status: 'PENDING',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 80,
            currency: 'USD',
            dispute: {
              id: 'disp-2',
              status: 'PENDING',
              reason: 'Wrong geographic region',
            },
          },
        });
      }
      if (url.includes('/disputes/disp-2/resolve')) {
        return Promise.resolve({
          dispute: { id: 'disp-2', status: 'ACCEPTED' },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-2' }} />);

    await waitFor(() => {
      expect(screen.getByText('Buyer Dispute')).toBeDefined();
      expect(screen.getByText('Wrong geographic region')).toBeDefined();
      expect(screen.getByText('Accept Dispute')).toBeDefined();
      expect(screen.getByText('Reject Dispute')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Accept Dispute'));

    // In modal, click Accept Dispute
    const confirmButtons = screen.getAllByRole('button', { name: 'Accept Dispute' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-456/disputes/disp-2/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            status: 'ACCEPTED',
          }),
        })
      );
    });
  });

  it('renders financial adjustment reversal when present', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-3')) {
        return Promise.resolve({
          id: 'call-3',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-3',
            status: 'FINAL',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 0,
            currency: 'USD',
            dispute: {
              id: 'disp-3',
              status: 'ACCEPTED',
              reason: 'Unqualified lead accepted by admin',
              resolution_notes: 'Full refund agreed',
            },
            adjustment: {
              id: 'adj-3',
              original_revenue: 120,
              adjusted_revenue: 0,
              original_payout: 60,
              adjusted_payout: 0,
              reason: 'Full refund agreed',
              created_at: '2026-10-02T10:00:00Z',
            },
          },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-3' }} />);

    await waitFor(() => {
      expect(screen.getByText('Financial Adjustment')).toBeDefined();
      expect(screen.getByText('Reversed')).toBeDefined();
      expect(screen.getByText('Original Revenue:')).toBeDefined();
      expect(screen.getByText('Adjusted Revenue:')).toBeDefined();
    });
  });
});
