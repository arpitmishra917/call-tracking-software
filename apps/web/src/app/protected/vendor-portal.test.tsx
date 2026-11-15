import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Sidebar from '@/components/sidebar';
import WorkspaceSelector from '@/components/workspace-selector';
import CallsPage from './calls/page';
import CallDetailPage from './calls/[callId]/page';
import SettlementsPage from './settlements/page';
import ReportingDashboard from './reporting/page';
import { apiFetch } from '@/lib/api';
import { useSearchParams, usePathname } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('COMM-INTEGRATION-6: Vendor Portal UI Integration Suite', () => {
  const vendorWorkspace = {
    id: 'ws-vendor-1',
    name: 'Acme Traffic Partner',
    role: 'MEMBER',
    participant_type: 'VENDOR',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue(new URLSearchParams('workspace=ws-vendor-1'));
    (usePathname as any).mockReturnValue('/protected');
  });

  describe('1. Sidebar Navigation Scoping for Vendor', () => {
    it('scopes sidebar to Calls, Reporting, and Settlements while hiding Disputes, Routing, Developer, Billing, and Workspace', () => {
      render(<Sidebar workspaces={[vendorWorkspace]} />);

      // Vendor-allowed navigation
      expect(screen.getByText('Calls')).toBeDefined();
      expect(screen.getByText('Reporting')).toBeDefined();
      expect(screen.getByText('Settlements')).toBeDefined();

      // Prohibited navigation for vendor
      expect(screen.queryByText('Disputes')).toBeNull();
      expect(screen.queryByText('Routing')).toBeNull();
      expect(screen.queryByText('Campaigns')).toBeNull();
      expect(screen.queryByText('Buyers')).toBeNull();
      expect(screen.queryByText('Phone Numbers')).toBeNull();
      expect(screen.queryByText('Blocked Callers')).toBeNull();
      expect(screen.queryByText('Developer')).toBeNull();
      expect(screen.queryByText('Billing')).toBeNull();
      expect(screen.queryByText('Workspace')).toBeNull();
    });
  });

  describe('2. Calls List Page Vendor Scoping', () => {
    it('renders Payout column, hides Revenue/Profit columns, and omits dispute badges', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url.includes('/calls?')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-v-1',
                created_at: '2026-10-08T12:00:00Z',
                from_number: '+15551112222',
                to_number: '+15553334444',
                state: 'COMPLETED',
                talkDurationSecs: 120,
                totalDurationSecs: 135,
                campaign: { name: 'Health Insurance Inbound' },
                recordings: [],
                commercial: {
                  id: 'comm-v-1',
                  status: 'FINAL',
                  qualified: true,
                  converted: true,
                  duplicate: false,
                  payout: 42.5,
                  currency: 'USD',
                  vendor: { id: 'v-1', name: 'Acme Traffic Partner' },
                  // revenue, cost, profit, and disputeStatus are stripped for vendor
                },
              },
            ],
          });
        }
        return Promise.resolve([]);
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.getByText('Payout')).toBeDefined();
      });

      // Payout column header and formatted value should exist
      expect(screen.getByText('$42.50')).toBeDefined();

      // Revenue and Profit column headers should NOT exist
      expect(screen.queryByText('Revenue')).toBeNull();
      expect(screen.queryByText('Profit')).toBeNull();

      // Classification badges should be visible
      expect(screen.getByText('Converted')).toBeDefined();
      expect(screen.getByText('Qualified')).toBeDefined();

      // Dispute badges should NOT be rendered
      expect(screen.queryByText(/Dispute:/i)).toBeNull();
    });
  });

  describe('3. Call Detail Page Vendor Scoping', () => {
    it('displays Payout while hiding Revenue, Cost, Profit, Buyer identities, and Dispute controls', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls/call-v-1')) {
          return Promise.resolve({
            id: 'call-v-1',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'COMPLETED',
            started_at: '2026-10-08T12:00:00Z',
            answered_at: '2026-10-08T12:00:05Z',
            ended_at: '2026-10-08T12:02:05Z',
            campaign: { name: 'Health Insurance Inbound' },
            attempts: [
              {
                id: 'att-1',
                state: 'COMPLETED',
                buyer: { id: 'b-secret', name: 'Confidential Buyer LLC' },
                started_at: '2026-10-08T12:00:05Z',
                answered_at: '2026-10-08T12:00:08Z',
                ended_at: '2026-10-08T12:02:05Z',
              },
            ],
            commercial: {
              id: 'comm-v-1',
              status: 'FINAL',
              qualified: true,
              converted: true,
              duplicate: false,
              payout: 42.5,
              currency: 'USD',
              vendor: { id: 'v-1', name: 'Acme Traffic Partner' },
            },
          });
        }
        return Promise.resolve({});
      });

      render(<CallDetailPage params={{ callId: 'call-v-1' }} />);

      await waitFor(() => {
        expect(screen.getByText('Commercial Economics')).toBeDefined();
      });

      // Payout card present
      expect(screen.getByTestId('detail-payout')).toBeDefined();
      expect(screen.getByText('$42.50')).toBeDefined();

      // Revenue, Cost, Profit cards strictly hidden
      expect(screen.queryByTestId('detail-revenue')).toBeNull();
      expect(screen.queryByTestId('detail-cost')).toBeNull();
      expect(screen.queryByTestId('detail-profit')).toBeNull();

      // Dispute section and File Dispute button strictly hidden
      expect(screen.queryByText('File Dispute')).toBeNull();
      expect(screen.queryByText('Buyer Dispute')).toBeNull();

      // Buyer identity strictly hidden
      expect(screen.queryByText('Final Buyer')).toBeNull();
      expect(screen.queryByText('Commercial Buyer')).toBeNull();
      expect(screen.queryByText('Confidential Buyer LLC')).toBeNull();

      // Vendor identity and classification visible
      expect(screen.getByText('Acme Traffic Partner')).toBeDefined();
      expect(screen.getByText('Converted')).toBeDefined();
      expect(screen.getByText('Qualified')).toBeDefined();

      // Timeline masked for vendor
      expect(screen.getByText('Attempt #1')).toBeDefined();
      expect(screen.getByText('Sequence of routing attempts.')).toBeDefined();
    });
  });

  describe('4. Settlements Page Vendor Scoping', () => {
    it('scopes settlements to vendor batches and hides settlement generation trigger', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/settlements/batches?')) {
          return Promise.resolve({
            batches: [
              {
                id: 'batch-v-1',
                batch_number: 'SB-VENDOR-ACME-USD-20261001',
                workspace_id: 'ws-vendor-1',
                participant_type: 'VENDOR',
                vendor_id: 'v-1',
                currency: 'USD',
                period_start: '2026-10-01T00:00:00.000Z',
                period_end: '2026-10-08T00:00:00.000Z',
                gross_amount: '425.0000',
                adjustments_amount: '0.0000',
                net_amount: '425.0000',
                item_count: 10,
                settlement_status: 'FINALIZED',
                payment_status: 'SUCCEEDED',
                reconciliation_status: 'RECONCILED',
                created_at: '2026-10-08T10:00:00.000Z',
              },
            ],
            total: 1,
          });
        }
        return Promise.resolve({});
      });

      render(<SettlementsPage />);

      await waitFor(() => {
        expect(screen.getByText('Settlements')).toBeDefined();
        expect(screen.getByText('SB-VENDOR-ACME-USD-20261001')).toBeDefined();
      });

      // Vendor settlement batch displayed
      expect(screen.getByText('Vendor Settlement')).toBeDefined();
      expect(screen.getAllByText('$425.00').length).toBeGreaterThan(0);

      // Generation trigger button must NOT be rendered
      expect(screen.queryByText('Generate Batch')).toBeNull();
      expect(screen.queryByText('Generate Settlement Batch')).toBeNull();
    });
  });

  describe('5. Authoritative Workspace Context Verification (No payload heuristic)', () => {
    const buyerWorkspace = {
      id: 'ws-buyer-1',
      name: 'Premier Buyer Corp',
      role: 'MEMBER',
      participant_type: 'BUYER',
    };

    it('does NOT classify Buyer/Owner as Vendor in CallDetailPage even if payload only has payout and lacks revenue/profit', async () => {
      (useSearchParams as any).mockReturnValue(new URLSearchParams('workspace=ws-buyer-1'));
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([buyerWorkspace]);
        }
        if (url.includes('/calls/call-buyer-1')) {
          return Promise.resolve({
            id: 'call-buyer-1',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'COMPLETED',
            started_at: '2026-10-08T12:00:00Z',
            answered_at: '2026-10-08T12:00:05Z',
            ended_at: '2026-10-08T12:02:05Z',
            campaign: { name: 'Health Insurance Inbound' },
            attempts: [
              {
                id: 'att-1',
                state: 'COMPLETED',
                buyer: { id: 'b-1', name: 'Authorized Buyer LLC' },
                started_at: '2026-10-08T12:00:05Z',
                answered_at: '2026-10-08T12:00:08Z',
                ended_at: '2026-10-08T12:02:05Z',
              },
            ],
            commercial: {
              id: 'comm-b-1',
              status: 'FINAL',
              qualified: true,
              converted: true,
              duplicate: false,
              payout: 35.0,
              // revenue and profit omitted to simulate payload edge case
              currency: 'USD',
              buyer: { id: 'b-1', name: 'Authorized Buyer LLC' },
              vendor: { id: 'v-1', name: 'Vendor 1' },
            },
          });
        }
        return Promise.resolve({});
      });

      render(<CallDetailPage params={{ callId: 'call-buyer-1' }} />);

      await waitFor(() => {
        expect(screen.getByText('Commercial Economics')).toBeDefined();
      });

      // Because workspace is BUYER, it is NOT treated as vendor.
      // Buyer details and timeline are NOT masked as anonymous vendor attempts
      expect(screen.getByText('Commercial Buyer')).toBeDefined();
      expect(screen.getAllByText('Authorized Buyer LLC').length).toBeGreaterThan(0);
      expect(screen.getByText('Sequence of buyer attempts.')).toBeDefined();

      // Dispute filing section is available to non-vendor Buyer
      expect(screen.getByText('File Dispute')).toBeDefined();
    });

    it('does NOT classify Buyer as Vendor in CallsPage even if rows only have payout', async () => {
      (useSearchParams as any).mockReturnValue(new URLSearchParams('workspace=ws-buyer-1'));
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([buyerWorkspace]);
        }
        if (url.includes('/calls?')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-b-1',
                created_at: '2026-10-08T12:00:00Z',
                from_number: '+15551112222',
                to_number: '+15553334444',
                state: 'COMPLETED',
                talkDurationSecs: 120,
                totalDurationSecs: 135,
                campaign: { name: 'Health Insurance Inbound' },
                recordings: [],
                commercial: {
                  id: 'comm-b-1',
                  status: 'FINAL',
                  qualified: true,
                  converted: true,
                  duplicate: false,
                  payout: 35.0,
                  disputeStatus: 'PENDING',
                  currency: 'USD',
                },
              },
            ],
          });
        }
        return Promise.resolve([]);
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.getByText('Dispute: PENDING')).toBeDefined();
      });

      // Dispute badge is rendered because workspace is NOT a Vendor
      expect(screen.getByText('Dispute: PENDING')).toBeDefined();
    });
  });

  describe('6. Vendor IDOR Rejection & Forbidden Handling', () => {
    it('renders error state when Vendor A attempts to access Vendor B call detail (403 Forbidden)', async () => {
      (useSearchParams as any).mockReturnValue(new URLSearchParams('workspace=ws-vendor-1'));
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls/call-vendor-b')) {
          return Promise.reject(new Error('Access denied to call'));
        }
        return Promise.resolve({});
      });

      render(<CallDetailPage params={{ callId: 'call-vendor-b' }} />);

      await waitFor(() => {
        expect(screen.getByText('Access denied to call')).toBeDefined();
      });

      // Commercial economics and attempts should NOT be displayed
      expect(screen.queryByText('Commercial Economics')).toBeNull();
      expect(screen.queryByText('Call Timeline')).toBeNull();
      expect(screen.getByText('Back to Call Logs')).toBeDefined();
    });

    it('renders error state when Vendor A attempts to access cross-workspace call detail (404/403)', async () => {
      (useSearchParams as any).mockReturnValue(new URLSearchParams('workspace=ws-vendor-1'));
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls/call-cross-ws')) {
          return Promise.reject(new Error('Call not found'));
        }
        return Promise.resolve({});
      });

      render(<CallDetailPage params={{ callId: 'call-cross-ws' }} />);

      await waitFor(() => {
        expect(screen.getByText('Call not found')).toBeDefined();
      });

      expect(screen.queryByText('Commercial Economics')).toBeNull();
    });

    it('renders error banner when Vendor attempts unauthorized settlement batch query (403 Forbidden)', async () => {
      (useSearchParams as any).mockReturnValue(new URLSearchParams('workspace=ws-vendor-1'));
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/settlements/batches?')) {
          return Promise.reject(new Error('Access denied to settlement batches'));
        }
        return Promise.resolve({});
      });

      render(<SettlementsPage />);

      await waitFor(() => {
        expect(screen.getByText('Access denied to settlement batches')).toBeDefined();
      });

      // Invariant: Error state must NOT display "No settlement batches found" empty state
      expect(screen.queryByText('No settlement batches found')).toBeNull();
    });

    it('renders VENDOR badge in WorkspaceSelector for vendor participant workspace', () => {
      render(<WorkspaceSelector workspaces={[vendorWorkspace]} />);
      expect(screen.getByText('Acme Traffic Partner (VENDOR)')).toBeDefined();
    });
  });
  describe('7. Phase 2 Slice 4: Vendor Portal Pagination, Operational Reporting & Scope Hardening', () => {
    it('CallsPage: supports server-side pagination with limit and offset query parameters', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls?')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-v-page1',
                created_at: '2026-10-08T12:00:00Z',
                from_number: '+15551112222',
                to_number: '+15553334444',
                state: 'COMPLETED',
                talkDurationSecs: 120,
                totalDurationSecs: 135,
                campaign: { name: 'Health Insurance Inbound' },
                recordings: [],
                commercial: {
                  id: 'comm-v-1',
                  status: 'FINAL',
                  qualified: true,
                  converted: true,
                  payout: 42.5,
                  currency: 'USD',
                },
              },
            ],
            total: 45,
          });
        }
        return Promise.resolve([]);
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.getByText((_, el) => el?.textContent?.replace(/\s+/g, ' ').trim() === 'Showing 1 to 20 of 45 calls')).toBeDefined();
        expect(screen.getByText('Page 1 of 3')).toBeDefined();
      });

      // Limit and offset must be sent in the API query
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('limit=20'));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('offset=0'));

      // Previous button should be disabled on first page
      const prevButton = screen.getByLabelText('Previous Page') as HTMLButtonElement;
      expect(prevButton.disabled).toBe(true);

      // Next button should be enabled
      const nextButton = screen.getByLabelText('Next Page') as HTMLButtonElement;
      expect(nextButton.disabled).toBe(false);

      // Click Next page
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('offset=20'));
      });
    });

    it('CallsPage: allows filtering by Canceled / Missed status', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls?')) {
          return Promise.resolve({ items: [], total: 0 });
        }
        return Promise.resolve([]);
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText('Status')).toBeDefined();
      });

      // Verify Canceled / Missed option exists
      const statusSelect = screen.getByLabelText('Status');
      expect(screen.getByRole('option', { name: 'Canceled / Missed' })).toBeDefined();

      // Change status to CANCELED
      fireEvent.change(statusSelect, { target: { value: 'CANCELED' } });

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('status=CANCELED'));
      });
    });

    it('CallsPage: renders error banner when API request fails (403 Forbidden)', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls?')) {
          return Promise.reject(new Error('Missing call:read permission'));
        }
        return Promise.resolve([]);
      });

      render(<CallsPage />);

      await waitFor(() => {
        expect(screen.getByText('Missing call:read permission')).toBeDefined();
      });

      // Call items and table rows should not be rendered
      expect(screen.queryByText('Showing 1 to')).toBeNull();
    });

    it('ReportingDashboard: renders operational metrics and Payout for Vendor without Buyer option in Group By', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([vendorWorkspace]);
        }
        if (url.includes('/calls/metrics?')) {
          return Promise.resolve({
            total: 25,
            answered: 18,
            missed: 5,
            failed: 2,
            avgDuration: 95,
            tclSecs: 1800,
            aclSecs: 100,
            payout: 765.0,
            currency: 'USD',
            converted: 12,
            qualified: 15,
            conversionRate: 48.0,
            commercialCalls: 25,
            campaigns: {},
            trackingNumbers: {},
            buckets: [],
          });
        }
        if (url.includes('/calls?')) {
          return Promise.resolve({ items: [], total: 0 });
        }
        if (url.includes('/calls/live-calls')) {
          return Promise.resolve({ liveCalls: 0 });
        }
        if (url.includes('/reports')) {
          return Promise.resolve([]);
        }
        return Promise.resolve({});
      });

      render(<ReportingDashboard />);

      await waitFor(() => {
        expect(screen.getByText('Total Calls')).toBeDefined();
        expect(screen.getByText('25')).toBeDefined();
      });

      // Operational metrics present
      expect(screen.getByText('18')).toBeDefined(); // Answered
      expect(screen.getByText('5')).toBeDefined();  // Missed
      expect(screen.getByText('2')).toBeDefined();  // Failed

      // Commercial Economics: Payout present
      expect(screen.getByTestId('kpi-payout')).toBeDefined();
      expect(screen.getByText('$765.00')).toBeDefined();

      // Commercial Economics: Revenue, Profit, Cost strictly hidden
      expect(screen.queryByTestId('kpi-revenue')).toBeNull();
      expect(screen.queryByTestId('kpi-profit')).toBeNull();
      expect(screen.queryByTestId('kpi-cost')).toBeNull();

      // Buyer option strictly hidden in Group By dropdown for Vendor
      expect(screen.queryByRole('option', { name: 'Buyer' })).toBeNull();
    });
  });
});
