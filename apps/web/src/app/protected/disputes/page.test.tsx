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
      if (url.includes('/disputes') && !url.includes('/resolve')) {
        return Promise.resolve({
          items: [
            {
              id: 'disp-1',
              call_id: 'call-101',
              created_at: '2026-10-01T12:00:00Z',
              revenue: 50,
              currency: 'USD',
              status: 'PENDING',
              reason: 'Dropped call under threshold',
              buyer: { id: 'buyer-1', name: 'Acme Buyer' },
            },
            {
              id: 'disp-2',
              call_id: 'call-102',
              created_at: '2026-10-02T12:00:00Z',
              revenue: 75,
              currency: 'USD',
              status: 'ACCEPTED',
              reason: 'Invalid lead',
              buyer: { id: 'buyer-2', name: 'Global Buyer' },
              resolution_notes: 'Verified bad lead',
            },
          ],
          total: 2,
          limit: 25,
          offset: 0,
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
      if (url.includes('/disputes') && !url.includes('/resolve')) {
        return Promise.resolve({
          items: [
            {
              id: 'disp-201',
              call_id: 'call-201',
              created_at: '2026-10-01T12:00:00Z',
              revenue: 60,
              currency: 'USD',
              status: 'PENDING',
              reason: 'Audio quality issue',
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
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
      if (url.includes('/disputes') && !url.includes('/resolve')) {
        return Promise.resolve({
          items: [
            {
              id: 'disp-301',
              call_id: 'call-301',
              created_at: '2026-10-01T12:00:00Z',
              revenue: 40,
              currency: 'USD',
              status: 'PENDING',
              reason: 'Wrong party reached',
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
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
      if (url.includes('/disputes')) {
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

  it('supports server-side pagination across >100 disputes', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([{ id: 'ws-test-123', role: 'ADMIN' }]);
      }
      if (url.includes('/disputes') && !url.includes('/resolve')) {
        if (url.includes('offset=0')) {
          return Promise.resolve({
            items: [
              {
                id: 'disp-page-1',
                call_id: 'call-page-1',
                created_at: '2026-10-01T12:00:00Z',
                revenue: 100,
                currency: 'USD',
                status: 'PENDING',
                reason: 'Page 1 Dispute',
              },
            ],
            total: 125, // Total 125 disputes (> 100)
            limit: 25,
            offset: 0,
          });
        }
        if (url.includes('offset=25')) {
          return Promise.resolve({
            items: [
              {
                id: 'disp-page-2',
                call_id: 'call-page-2',
                created_at: '2026-10-01T13:00:00Z',
                revenue: 150,
                currency: 'USD',
                status: 'ACCEPTED',
                reason: 'Page 2 Dispute',
              },
            ],
            total: 125,
            limit: 25,
            offset: 25,
          });
        }
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);

    expect(await screen.findByText('Page 1 Dispute')).toBeDefined();
    expect(screen.getByText(/Showing 1 to 25/)).toBeDefined();
    expect(screen.getByText('Page 1 of 5')).toBeDefined();

    // Click Next button
    const nextBtn = screen.getByRole('button', { name: 'Next' });
    expect(nextBtn).toBeDefined();
    fireEvent.click(nextBtn);

    expect(await screen.findByText('Page 2 Dispute')).toBeDefined();
    expect(screen.getByText(/Showing 26 to 50/)).toBeDefined();
    expect(screen.getByText('Page 2 of 5')).toBeDefined();
  });

  it('requests filtered status from backend when switching status tabs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([{ id: 'ws-test-123', role: 'ADMIN' }]);
      }
      if (url.includes('/disputes') && !url.includes('/resolve')) {
        if (url.includes('status=PENDING')) {
          return Promise.resolve({
            items: [
              {
                id: 'disp-pending-1',
                call_id: 'call-pen-1',
                created_at: '2026-10-01T12:00:00Z',
                revenue: 55,
                currency: 'USD',
                status: 'PENDING',
                reason: 'Only Pending Item',
              },
            ],
            total: 1,
            limit: 25,
            offset: 0,
          });
        }
        return Promise.resolve({
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
        });
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);

    // Click PENDING tab
    const pendingTab = screen.getByRole('button', { name: 'PENDING' });
    fireEvent.click(pendingTab);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/disputes?limit=25&offset=0&status=PENDING')
      );
    });

    expect(await screen.findByText('Only Pending Item')).toBeDefined();
  });
  it('Finding E: hides Accept and Reject buttons for non-admin Buyer/MEMBER', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([{ id: 'ws-test-123', role: 'MEMBER', participant_type: 'BUYER' }]);
      }
      if (url.includes('/disputes') && !url.includes('/resolve')) {
        return Promise.resolve({
          items: [
            {
              id: 'disp-buyer-1',
              call_id: 'call-101',
              status: 'PENDING',
              reason: 'Buyer dispute',
            },
          ],
          total: 1,
        });
      }
      return Promise.resolve({});
    });

    render(<DisputesPage />);
    await waitFor(() => {
      expect(screen.getByText('Buyer dispute')).toBeDefined();
    });

    expect(screen.queryByRole('button', { name: 'Accept dispute' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject dispute' })).toBeNull();
  });
});
