import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CampaignDetailPage from './page';
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

describe('Campaign Detail Page - Multi-Destination Routing Waterfall', () => {
  const mockCampaign = {
    id: 'camp-123',
    name: 'Auto Insurance Inbound',
    status: 'ACTIVE',
    created_at: '2026-11-01T12:00:00Z',
    default_revenue_amount: 45.0,
    default_payout_amount: 30.0,
    currency: 'USD',
    phone_numbers: [{ id: 'pn-1', phone_number: '+18005550100', provider: 'twilio' }],
    destination_numbers: [
      {
        id: 'cd-1',
        campaign_id: 'camp-123',
        destination_number_id: 'dn-1',
        priority: 1,
        weight: 100,
        destination_number: {
          id: 'dn-1',
          destination_number: '+15551112222',
          name: 'Primary Tier 1',
          status: 'ACTIVE',
          timeout: 30,
          max_concurrent_calls: 5,
          buyer: {
            id: 'buyer-1',
            name: 'Apex Insurance Org',
            status: 'ACTIVE',
          },
        },
      },
      {
        id: 'cd-2',
        campaign_id: 'camp-123',
        destination_number_id: 'dn-2',
        priority: 2,
        weight: 80,
        destination_number: {
          id: 'dn-2',
          destination_number: '+15553334444',
          name: 'Overflow Center',
          status: 'ACTIVE',
          timeout: 45,
          max_concurrent_calls: 3,
          buyer: {
            id: 'buyer-2',
            name: 'Beacon Care Org',
            status: 'ACTIVE',
          },
        },
      },
    ],
    buyers: [
      {
        id: 'cb-1',
        priority: 1,
        buyer: {
          id: 'buyer-legacy-1',
          name: 'Legacy Buyer Fallback Org',
          destination_number: '+15559998888',
          status: 'ACTIVE',
        },
      },
    ],
  };

  const mockAvailableDestinations = [
    {
      id: 'dn-3',
      destination_number: '+15557778888',
      name: 'West Coast Inbound',
      status: 'ACTIVE',
      buyer: { id: 'buyer-3', name: 'Pacific Health', status: 'ACTIVE' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-1' : null),
    });
  });

  it('renders destination waterfall table with priorities and legacy fallback', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces/ws-test-1/campaigns/camp-123') {
        return Promise.resolve(mockCampaign);
      }
      return Promise.resolve({});
    });

    render(<CampaignDetailPage params={{ campaignId: 'camp-123' }} />);

    await waitFor(() => {
      expect(screen.getByText('Auto Insurance Inbound')).toBeDefined();
    });

    // Destination endpoints
    expect(screen.getByText('+15551112222')).toBeDefined();
    expect(screen.getByText('Primary Tier 1')).toBeDefined();
    expect(screen.getByText('Apex Insurance Org')).toBeDefined();
    expect(screen.getByText('+15553334444')).toBeDefined();
    expect(screen.getByText('Overflow Center')).toBeDefined();
    expect(screen.getByText('Beacon Care Org')).toBeDefined();

    // Legacy fallback card
    expect(screen.getByText('Legacy Buyer Waterfall')).toBeDefined();
    expect(screen.getByText('Legacy Buyer Fallback Org')).toBeDefined();
    expect(screen.getByText('+15559998888')).toBeDefined();
  });

  it('assigns new destination number to campaign waterfall via modal', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces/ws-test-1/campaigns/camp-123' && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve(mockCampaign);
      }
      if (url.includes('/destination-numbers') && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve({ items: mockAvailableDestinations });
      }
      if (url === '/workspaces/ws-test-1/campaigns/camp-123/destinations' && opts?.method === 'POST') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(<CampaignDetailPage params={{ campaignId: 'camp-123' }} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /assign destination/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /assign destination/i }));

    await waitFor(() => {
      expect(screen.getByText('Assign Destination Number')).toBeDefined();
      expect(screen.getByText(/\+15557778888/)).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/priority \(waterfall order\)/i), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText(/weight \(traffic share\)/i), {
      target: { value: '50' },
    });

    const submitButtons = screen.getAllByRole('button', { name: /assign destination/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-1/campaigns/camp-123/destinations',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            destinationNumberId: 'dn-3',
            priority: 3,
            weight: 50,
          }),
        })
      );
    });
  });

  it('reorders destinations when arrow button is clicked', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces/ws-test-1/campaigns/camp-123' && (!opts || !opts.method || opts.method === 'GET')) {
        return Promise.resolve(mockCampaign);
      }
      if (url === '/workspaces/ws-test-1/campaigns/camp-123/destinations/reorder' && opts?.method === 'PUT') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(<CampaignDetailPage params={{ campaignId: 'camp-123' }} />);

    await waitFor(() => {
      expect(screen.getByText('+15551112222')).toBeDefined();
    });

    const moveDownButtons = screen.getAllByTitle('Move down');
    expect(moveDownButtons.length).toBeGreaterThan(0);
    fireEvent.click(moveDownButtons[0]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-1/campaigns/camp-123/destinations/reorder',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            destinationNumberIds: ['dn-2', 'dn-1'],
          }),
        })
      );
    });
  });
});
