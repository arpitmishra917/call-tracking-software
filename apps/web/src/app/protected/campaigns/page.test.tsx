import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CampaignsPage from './page';
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

describe('Campaigns Page - Commercial Rates Configuration', () => {
  const mockCampaigns = [
    {
      id: 'camp-1',
      name: 'Commercially Configured Campaign',
      status: 'ACTIVE',
      default_revenue_amount: '45.0000',
      default_payout_amount: '30.0000',
      currency: 'USD',
      phone_numbers: [{ id: 'pn-1', phone_number: '+15551234567', campaign_id: 'camp-1' }],
      buyers: [
        {
          id: 'cb-1',
          priority: 1,
          buyer: { id: 'buyer-1', name: 'Buyer Alpha', destination_number: '+15550001', timeout: 30 },
        },
      ],
    },
    {
      id: 'camp-2',
      name: 'Unconfigured Campaign',
      status: 'ACTIVE',
      default_revenue_amount: null,
      default_payout_amount: null,
      currency: 'USD',
      phone_numbers: [],
      buyers: [],
    },
  ];

  const mockBuyers = [
    { id: 'buyer-1', name: 'Buyer Alpha', destination_number: '+15550001', timeout: 30 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test' : null),
    });

    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/campaigns?')) {
        return Promise.resolve({ items: mockCampaigns });
      }
      if (url.includes('/buyers')) {
        return Promise.resolve({ items: mockBuyers });
      }
      if (url.includes('/phone-numbers')) {
        return Promise.resolve({ items: [] });
      }
      return Promise.resolve({});
    });
  });

  it('renders campaigns list with commercial rates and status badges', async () => {
    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
      expect(screen.getByText('Unconfigured Campaign')).toBeDefined();
    });

    // Check Commercial Active badge on camp-1
    expect(screen.getByText('Commercial Active')).toBeDefined();

    // Check Non-commercial badge on camp-2
    expect(screen.getByText('Non-commercial')).toBeDefined();

    // Rates displayed for camp-1
    expect(screen.getByText('USD 45.00')).toBeDefined();
    expect(screen.getByText('USD 30.00')).toBeDefined();

    // Not configured displayed for camp-2
    const unconfiguredTexts = screen.getAllByText('Not configured');
    expect(unconfiguredTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('opens Create Campaign modal with commercial rate fields and submits them', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          id: 'camp-3',
          name: 'New Auto Campaign',
          default_revenue_amount: 50,
          default_payout_amount: 35,
          currency: 'USD',
          status: 'ACTIVE',
        });
      }
      if (url.includes('/campaigns?')) {
        return Promise.resolve({ items: mockCampaigns });
      }
      if (url.includes('/buyers')) {
        return Promise.resolve({ items: mockBuyers });
      }
      return Promise.resolve({});
    });

    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
    });

    // Click + Create Campaign
    const createBtn = screen.getByRole('button', { name: /\+ create campaign/i });
    fireEvent.click(createBtn);

    const dialog = screen.getByRole('dialog');
    const withinDialog = within(dialog);

    // Verify modal is open and shows commercial fields
    expect(withinDialog.getByLabelText(/campaign name/i)).toBeDefined();
    expect(withinDialog.getByLabelText(/default buyer revenue/i)).toBeDefined();
    expect(withinDialog.getByLabelText(/default vendor payout/i)).toBeDefined();
    expect(withinDialog.getByLabelText(/currency/i)).toBeDefined();

    // Fill form
    fireEvent.change(withinDialog.getByLabelText(/campaign name/i), {
      target: { value: 'New Auto Campaign' },
    });
    fireEvent.change(withinDialog.getByLabelText(/default buyer revenue/i), {
      target: { value: '50.00' },
    });
    fireEvent.change(withinDialog.getByLabelText(/default vendor payout/i), {
      target: { value: '35.00' },
    });

    // Submit modal
    const submitBtn = withinDialog.getByRole('button', { name: /create campaign/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test/campaigns',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'New Auto Campaign',
            default_revenue_amount: 50,
            default_payout_amount: 35,
            currency: 'USD',
            conversion_duration_secs: 90,
          }),
        }),
      );
    });
  });

  it('validates negative rate inputs and displays validation error', async () => {
    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
    });

    const createBtn = screen.getByRole('button', { name: /\+ create campaign/i });
    fireEvent.click(createBtn);

    const dialog = screen.getByRole('dialog');
    const withinDialog = within(dialog);

    fireEvent.change(withinDialog.getByLabelText(/campaign name/i), {
      target: { value: 'Invalid Campaign' },
    });
    fireEvent.change(withinDialog.getByLabelText(/default buyer revenue/i), {
      target: { value: '-10' },
    });

    const submitBtn = withinDialog.getByRole('button', { name: /create campaign/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(withinDialog.getByText(/default buyer revenue cannot be negative/i)).toBeDefined();
    });

    // Verify API was not called
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/workspaces/ws-test/campaigns',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('prepopulates commercial rates in Edit Campaign modal and submits updates', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({
          ...mockCampaigns[0],
          default_revenue_amount: 60,
          default_payout_amount: 40,
        });
      }
      if (url.includes('/campaigns?')) {
        return Promise.resolve({ items: mockCampaigns });
      }
      return Promise.resolve({ items: [] });
    });

    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
    });

    // Click Edit on first campaign
    const editBtns = screen.getAllByRole('button', { name: /^edit$/i });
    fireEvent.click(editBtns[0]);

    const dialog = screen.getByRole('dialog');
    const withinDialog = within(dialog);

    // Verify fields are prepopulated
    await waitFor(() => {
      expect(withinDialog.getByDisplayValue('Commercially Configured Campaign')).toBeDefined();
      expect(withinDialog.getByDisplayValue('45.0000')).toBeDefined();
      expect(withinDialog.getByDisplayValue('30.0000')).toBeDefined();
    });

    // Change rates
    fireEvent.change(withinDialog.getByDisplayValue('45.0000'), {
      target: { value: '60.00' },
    });
    fireEvent.change(withinDialog.getByDisplayValue('30.0000'), {
      target: { value: '40.00' },
    });

    // Save changes
    const saveBtn = withinDialog.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test/campaigns/camp-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            name: 'Commercially Configured Campaign',
            default_revenue_amount: 60,
            default_payout_amount: 40,
            currency: 'USD',
          }),
        }),
      );
    });
  });
  it('validates conversion duration threshold inputs (rejects negative and decimal)', async () => {
    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
    });

    const createBtn = screen.getByRole('button', { name: /\+ create campaign/i });
    fireEvent.click(createBtn);

    const dialog = screen.getByRole('dialog');
    const withinDialog = within(dialog);

    // Verify default value is 90
    const durationInput = withinDialog.getByLabelText(/conversion duration threshold/i);
    expect((durationInput as HTMLInputElement).value).toBe('90');

    // Fill valid name
    fireEvent.change(withinDialog.getByLabelText(/campaign name/i), {
      target: { value: 'Invalid Duration Campaign' },
    });

    // Test negative value
    fireEvent.change(durationInput, { target: { value: '-5' } });
    const submitBtn = withinDialog.getByRole('button', { name: /create campaign/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(withinDialog.getByText(/conversion duration threshold must be a non-negative whole number/i)).toBeDefined();
    });

    // Test decimal value
    fireEvent.change(durationInput, { target: { value: '45.5' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(withinDialog.getByText(/conversion duration threshold must be a non-negative whole number/i)).toBeDefined();
    });

    expect(apiFetch).not.toHaveBeenCalledWith(
      '/workspaces/ws-test/campaigns',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('allows custom and zero-second conversion duration threshold', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          id: 'camp-zero',
          name: 'Zero Sec Campaign',
          conversion_duration_secs: 0,
        });
      }
      if (url.includes('/campaigns?')) {
        return Promise.resolve({ items: mockCampaigns });
      }
      return Promise.resolve({ items: [] });
    });

    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
    });

    const createBtn = screen.getByRole('button', { name: /\+ create campaign/i });
    fireEvent.click(createBtn);

    const dialog = screen.getByRole('dialog');
    const withinDialog = within(dialog);

    fireEvent.change(withinDialog.getByLabelText(/campaign name/i), {
      target: { value: 'Zero Sec Campaign' },
    });
    fireEvent.change(withinDialog.getByLabelText(/conversion duration threshold/i), {
      target: { value: '0' },
    });

    const submitBtn = withinDialog.getByRole('button', { name: /create campaign/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test/campaigns',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Zero Sec Campaign',
            default_revenue_amount: null,
            default_payout_amount: null,
            currency: 'USD',
            conversion_duration_secs: 0,
          }),
        }),
      );
    });
  });

  it('prepopulates and updates conversion duration threshold in Edit modal', async () => {
    const campaignsWithDuration = [
      {
        ...mockCampaigns[0],
        conversion_duration_secs: 45,
      },
    ];

    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({
          ...campaignsWithDuration[0],
          conversion_duration_secs: 120,
        });
      }
      if (url.includes('/campaigns?')) {
        return Promise.resolve({ items: campaignsWithDuration });
      }
      return Promise.resolve({ items: [] });
    });

    render(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Commercially Configured Campaign')).toBeDefined();
    });

    const editBtns = screen.getAllByRole('button', { name: /^edit$/i });
    fireEvent.click(editBtns[0]);

    const dialog = screen.getByRole('dialog');
    const withinDialog = within(dialog);

    // Verify prepopulated value is 45
    const durationInput = withinDialog.getByLabelText(/conversion duration threshold/i);
    expect((durationInput as HTMLInputElement).value).toBe('45');

    // Update to 120
    fireEvent.change(durationInput, { target: { value: '120' } });

    const saveBtn = withinDialog.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test/campaigns/camp-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            name: 'Commercially Configured Campaign',
            default_revenue_amount: 45,
            default_payout_amount: 30,
            currency: 'USD',
            conversion_duration_secs: 120,
          }),
        }),
      );
    });
  });
});
