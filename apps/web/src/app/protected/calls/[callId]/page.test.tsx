import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('Call Detail Page - Destination Snapshots & Timeline', () => {
  const mockOwnerWorkspace = {
    id: 'ws-test-1',
    role: 'OWNER',
    participant_type: 'INTERNAL',
  };

  const mockVendorWorkspace = {
    id: 'ws-test-1',
    role: 'MEMBER',
    participant_type: 'VENDOR',
  };

  const mockCallDetail = {
    id: 'call-100',
    provider_call_id: 'CA123456789',
    from_number: '+15550001111',
    to_number: '+18005550100',
    state: 'COMPLETED',
    created_at: '2026-11-05T10:00:00Z',
    campaign: { name: 'Auto Insurance Inbound' },
    attempts: [
      {
        id: 'att-1',
        created_at: '2026-11-05T10:00:05Z',
        buyer_id: 'buyer-1',
        destination_number: '+15551112222',
        destination_number_id: 'dn-1',
        destination_ref: {
          id: 'dn-1',
          name: 'Primary Center',
          destination_number: '+15551112222',
        },
        state: 'NO_ANSWER',
        buyer: { name: 'Apex Health Org' },
      },
      {
        id: 'att-2',
        created_at: '2026-11-05T10:00:35Z',
        buyer_id: 'buyer-2',
        destination_number: '+15553334444',
        destination_number_id: 'dn-2',
        destination_ref: {
          id: 'dn-2',
          name: 'Overflow Center',
          destination_number: '+15553334444',
        },
        state: 'COMPLETED',
        started_at: '2026-11-05T10:00:35Z',
        answered_at: '2026-11-05T10:00:40Z',
        ended_at: '2026-11-05T10:02:10Z',
        buyer: { name: 'Beacon Care Org' },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-1' : null),
      toString: () => 'workspace=ws-test-1',
    });
  });

  it('renders routing attempts with dialed destination snapshot and friendly label for Owner/Admin', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces/ws-test-1/calls/call-100') {
        return Promise.resolve(mockCallDetail);
      }
      if (url === '/workspaces') {
        return Promise.resolve([mockOwnerWorkspace]);
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-100' }} />);

    await waitFor(() => {
      expect(screen.getByText('Routing Timeline')).toBeDefined();
    });

    // Buyers
    expect(screen.getByText('1. Apex Health Org')).toBeDefined();
    expect(screen.getByText('2. Beacon Care Org')).toBeDefined();

    // Endpoints snapshot
    expect(screen.getByText('+15551112222')).toBeDefined();
    expect(screen.getByText('Primary Center')).toBeDefined();
    expect(screen.getByText('+15553334444')).toBeDefined();
    expect(screen.getByText('Overflow Center')).toBeDefined();
  });

  it('masks buyer identity and destination number endpoints for Vendor participant workspaces', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces/ws-test-1/calls/call-100') {
        return Promise.resolve(mockCallDetail);
      }
      if (url === '/workspaces') {
        return Promise.resolve([mockVendorWorkspace]);
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-100' }} />);

    await waitFor(() => {
      expect(screen.getByText('Routing Timeline')).toBeDefined();
    });

    // Attempts should be numbered without buyer names
    expect(screen.getByText('Attempt #1')).toBeDefined();
    expect(screen.getByText('Attempt #2')).toBeDefined();

    // Buyer org names and dialed endpoints should be hidden
    expect(screen.queryByText('Apex Health Org')).toBeNull();
    expect(screen.queryByText('Primary Center')).toBeNull();
    expect(screen.queryByText('+15551112222')).toBeNull();
  });

  it('resolves recording download endpoint using call.workspace_id over ambient workspace parameter', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const callWithRecording = {
      ...mockCallDetail,
      workspace_id: 'ws-actual-call-tenant',
      recordings: [
        {
          id: 'rec-xyz-99',
          status: 'COMPLETED',
          duration_secs: 60,
        },
      ],
    };

    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces/ws-test-1/calls/call-100') {
        return Promise.resolve(callWithRecording);
      }
      if (url === '/workspaces') {
        return Promise.resolve([mockOwnerWorkspace]);
      }
      if (url === '/workspaces/ws-actual-call-tenant/recordings/rec-xyz-99/download') {
        return Promise.resolve({ url: 'https://storage.callflow.internal/recordings/rec-xyz-99.mp3' });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-100' }} />);

    const downloadBtn = await screen.findByRole('button', { name: /download/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-actual-call-tenant/recordings/rec-xyz-99/download');
      expect(windowOpenSpy).toHaveBeenCalledWith('https://storage.callflow.internal/recordings/rec-xyz-99.mp3', '_blank');
    });

    windowOpenSpy.mockRestore();
  });
});
