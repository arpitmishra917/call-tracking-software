import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DisputesPage from './page';
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

describe('DisputesPage (COMM-INTEGRATION-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-123' : null),
    });
  });

  it('renders commercial dispute list for authorized workspace members', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-123', name: 'Test WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/calls')) {
        return Promise.resolve({
          items: [
            {
              id: 'call-101',
              created_at: '2026-10-01T12:00:00Z',
              commercial: {
                id: 'comm-101',
                revenue: 50,
                currency: 'USD',
                disputeStatus: 'PENDING',
                disputeReason: 'Dropped call under threshold',
                buyer: { id: 'buyer-1', name: 'Acme Buyer' },
                dispute: {
                  id: 'disp-1',
                  status: 'PENDING',
                  reason: 'Dropped call under threshold',
                },
              },
            },
            {
              id: 'call-102',
              created_at: '2026-10-02T12:00:00Z',
              commercial: {
                id: 'comm-102',
                revenue: 75,
                currency: 'USD',
                disputeStatus: 'ACCEPTED',
                disputeReason: 'Invalid lead',
                buyer: { id: 'buyer-2', name: 'Global Buyer' },
                dispute: {
                  id: 'disp-2',
                  status: 'ACCEPTED',
                  reason: 'Invalid lead',
                  resolution_notes: 'Verified bad lead',
                },
              },
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);

    expect(screen.getByText('Commercial Disputes')).toBeDefined();

    expect(await screen.findByText('Dropped call under threshold')).toBeDefined();
    expect(await screen.findByText('Invalid lead')).toBeDefined();
    expect(await screen.findByText('Acme Buyer')).toBeDefined();
    expect(await screen.findByText('Global Buyer')).toBeDefined();
  });

  it('allows owner/admin to accept pending dispute', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([{ id: 'ws-test-123', role: 'ADMIN' }]);
      }
      if (url.includes('/calls')) {
        return Promise.resolve({
          items: [
            {
              id: 'call-201',
              created_at: '2026-10-01T12:00:00Z',
              commercial: {
                id: 'comm-201',
                revenue: 60,
                currency: 'USD',
                disputeStatus: 'PENDING',
                disputeReason: 'Audio quality issue',
                dispute: {
                  id: 'disp-201',
                  status: 'PENDING',
                  reason: 'Audio quality issue',
                },
              },
            },
          ],
        });
      }
      if (url.includes('/disputes/disp-201/resolve')) {
        return Promise.resolve({ dispute: { id: 'disp-201', status: 'ACCEPTED' } });
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);

    await waitFor(() => {
      expect(screen.getByText('Audio quality issue')).toBeDefined();
    });

    const acceptButton = await screen.findByRole('button', { name: 'Accept dispute' });
    fireEvent.click(acceptButton);

    // Confirm dialog appears
    const confirmBtn = await screen.findByRole('button', { name: 'Accept Dispute' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-123/disputes/disp-201/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'ACCEPTED' }),
        })
      );
    });
  });

  it('allows owner/admin to reject pending dispute with resolution notes', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([{ id: 'ws-test-123', role: 'OWNER' }]);
      }
      if (url.includes('/calls')) {
        return Promise.resolve({
          items: [
            {
              id: 'call-301',
              created_at: '2026-10-01T12:00:00Z',
              commercial: {
                id: 'comm-301',
                revenue: 40,
                currency: 'USD',
                disputeStatus: 'PENDING',
                disputeReason: 'Wrong party reached',
                dispute: {
                  id: 'disp-301',
                  status: 'PENDING',
                  reason: 'Wrong party reached',
                },
              },
            },
          ],
        });
      }
      if (url.includes('/disputes/disp-301/resolve')) {
        return Promise.resolve({ dispute: { id: 'disp-301', status: 'REJECTED' } });
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);

    await waitFor(() => {
      expect(screen.getByText('Wrong party reached')).toBeDefined();
    });

    const rejectButton = await screen.findByRole('button', { name: 'Reject dispute' });
    fireEvent.click(rejectButton);

    const input = await screen.findByPlaceholderText('Internal notes or explanation for this resolution');
    fireEvent.change(input, { target: { value: 'Confirmed valid party' } });

    const confirmReject = screen.getByRole('button', { name: 'Reject Dispute' });
    fireEvent.click(confirmReject);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-123/disputes/disp-301/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'REJECTED', resolution_notes: 'Confirmed valid party' }),
        })
      );
    });
  });

  it('renders access restricted banner for vendor participant', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-123', role: 'MEMBER', participant_type: 'VENDOR' },
        ]);
      }
      if (url.includes('/calls')) {
        return Promise.reject(new Error('API error (403): Forbidden'));
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);

    await waitFor(() => {
      expect(screen.getByText('Access Restricted')).toBeDefined();
      expect(
        screen.getByText(/Vendor participants are strictly isolated from buyer commercial disputes/)
      ).toBeDefined();
    });
  });
});
