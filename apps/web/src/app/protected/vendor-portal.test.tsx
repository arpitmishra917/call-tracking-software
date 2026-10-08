import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Sidebar from '@/components/sidebar';
import CallsPage from './calls/page';
import CallDetailPage from './calls/[callId]/page';
import SettlementsPage from './settlements/page';
import { apiFetch } from '@/lib/api';
import { useSearchParams, usePathname } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
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
});
