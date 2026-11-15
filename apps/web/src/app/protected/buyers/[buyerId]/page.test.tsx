import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BuyerDetailPage from './page';
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

describe('Buyer Detail Page - Destination Number Management', () => {
  const mockOwnerWorkspace = {
    id: 'ws-test-1',
    role: 'OWNER',
    participant_type: 'INTERNAL',
  };

  const mockBuyer = {
    id: 'buyer-org-1',
    workspace_id: 'ws-test-1',
    name: 'Apex Global Insurance',
    email: 'ops@apexinsurance.com',
    status: 'ACTIVE',
    timeout: 30,
    max_concurrent_calls: 5,
    destination_number: '+15551112222',
    destination_numbers: [
      {
        id: 'dn-1',
        destination_number: '+15551112222',
        name: 'Primary Tier 1 Center',
        status: 'ACTIVE',
        timeout: 30,
        max_concurrent_calls: 5,
        campaign_destinations: [
          {
            id: 'cd-1',
            priority: 1,
            campaign: { id: 'camp-1', name: 'Auto Insurance Inbound', status: 'ACTIVE' },
          },
        ],
      },
      {
        id: 'dn-2',
        destination_number: '+15553334444',
        name: 'After Hours Overflow',
        status: 'INACTIVE',
        timeout: 45,
        max_concurrent_calls: 2,
        campaign_destinations: [],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-1' : null),
    });
  });

  it('renders buyer organization details and destination numbers list', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1') {
        return Promise.resolve(mockBuyer);
      }
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1/destination-numbers') {
        return Promise.resolve(mockBuyer.destination_numbers);
      }
      if (url === '/workspaces') {
        return Promise.resolve([mockOwnerWorkspace]);
      }
      return Promise.resolve({});
    });

    render(<BuyerDetailPage params={{ buyerId: 'buyer-org-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Global Insurance')).toBeDefined();
      expect(screen.getByText('ops@apexinsurance.com')).toBeDefined();
    });

    // Destination numbers should appear
    expect(screen.getByText('+15551112222')).toBeDefined();
    expect(screen.getByText('Primary Tier 1 Center')).toBeDefined();
    expect(screen.getByText('+15553334444')).toBeDefined();
    expect(screen.getByText('After Hours Overflow')).toBeDefined();

    // Campaign badge
    expect(screen.getByText('Auto Insurance Inbound')).toBeDefined();
  });

  it('opens Add Destination modal, validates E.164, and submits new destination number', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1' && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve(mockBuyer);
      }
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1/destination-numbers' && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve(mockBuyer.destination_numbers);
      }
      if (url === '/workspaces') {
        return Promise.resolve([mockOwnerWorkspace]);
      }
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1/destination-numbers' && opts?.method === 'POST') {
        return Promise.resolve({
          id: 'dn-3',
          destination_number: '+15557778888',
          name: 'Spanish Bilingual Desk',
          status: 'ACTIVE',
          timeout: 25,
          max_concurrent_calls: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<BuyerDetailPage params={{ buyerId: 'buyer-org-1' }} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add destination/i })).toBeDefined();
    });

    const openButtons = screen.getAllByRole('button', { name: /add destination/i });
    fireEvent.click(openButtons[0]);

    expect(screen.getByRole('heading', { name: 'Add Destination Number' })).toBeDefined();

    fireEvent.change(screen.getByLabelText(/destination phone number/i), {
      target: { value: '+15557778888' },
    });
    fireEvent.change(screen.getByLabelText(/friendly label/i), {
      target: { value: 'Spanish Bilingual Desk' },
    });
    fireEvent.change(screen.getByLabelText(/ring timeout/i), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByLabelText(/max concurrent calls/i), {
      target: { value: '3' },
    });

    const buttons = screen.getAllByRole('button', { name: /^add destination number$/i });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-1/buyers/buyer-org-1/destination-numbers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            destinationNumber: '+15557778888',
            name: 'Spanish Bilingual Desk',
            timeout: 25,
            max_concurrent_calls: 3,
          }),
        })
      );
    });
  });

  it('triggers delete confirmation dialog and calls DELETE endpoint', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1' && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve(mockBuyer);
      }
      if (url === '/workspaces/ws-test-1/buyers/buyer-org-1/destination-numbers' && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve(mockBuyer.destination_numbers);
      }
      if (url === '/workspaces') {
        return Promise.resolve([mockOwnerWorkspace]);
      }
      if (url.includes('/destination-numbers/dn-2') && opts?.method === 'DELETE') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(<BuyerDetailPage params={{ buyerId: 'buyer-org-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('+15553334444')).toBeDefined();
    });

    const deleteButtons = screen.getAllByTitle(/delete destination number/i);
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    // Confirm dialog should be visible
    const alertdialog = await screen.findByRole('alertdialog');
    expect(alertdialog).toBeDefined();
    expect(screen.getByText(/Are you sure you want to delete/i)).toBeDefined();

    const confirmBtn = screen.getByRole('button', { name: 'Delete Destination' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-1/destination-numbers/dn-2',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
