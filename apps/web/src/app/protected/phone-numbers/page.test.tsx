import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PhoneNumbersPage, { getPhoneTypeDisplay } from './page';
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

describe('PhoneNumbersPage Helpers', () => {
  describe('getPhoneTypeDisplay', () => {
    it('returns "Local" when phone_number_type is local', () => {
      const input = {
        phone_number: '+13363886505',
        phone_number_type: 'local',
      };
      expect(getPhoneTypeDisplay(input)).toBe('Local');
    });

    it('returns "Toll-Free" when phone_number_type is toll_free', () => {
      const input = {
        phone_number: '+18005551234',
        phone_number_type: 'toll_free',
      };
      expect(getPhoneTypeDisplay(input)).toBe('Toll-Free');
    });

    it('returns "Unknown" when phone_number_type is missing', () => {
      const input = {
        phone_number: '+13363886505',
      };
      expect(getPhoneTypeDisplay(input)).toBe('Unknown');
    });

    it('returns "Unknown" when phone_number_type is unhandled', () => {
      const input = {
        phone_number: '+13363886505',
        phone_number_type: 'mobile',
      };
      expect(getPhoneTypeDisplay(input)).toBe('Unknown');
    });
  });
});

describe('PhoneNumbersPage - Vendor and Admin Scoping Suite', () => {
  const workspaceId = 'ws-test-123';

  const mockAdminWorkspace = [
    {
      id: workspaceId,
      name: 'Primary Org',
      role: 'ADMIN',
      participant_type: 'INTERNAL',
    },
  ];

  const mockVendorWorkspace = [
    {
      id: workspaceId,
      name: 'Vendor Partner Org',
      role: 'MEMBER',
      participant_type: 'VENDOR',
    },
  ];

  const mockPhoneNumbers = [
    {
      id: 'pn-1',
      phone_number: '+15551001000',
      name: 'Vendor Main Line',
      status: 'ACTIVE',
      number_type: 'local',
      campaign: { id: 'camp-1', name: 'Auto Insurance Inbound' },
      vendor: { id: 'vend-1', name: 'Acme Media' },
      vendor_id: 'vend-1',
    },
    {
      id: 'pn-2',
      phone_number: '+18005552000',
      name: 'Unassigned Toll-Free',
      status: 'ACTIVE',
      number_type: 'toll_free',
      campaign: null,
      vendor: null,
      vendor_id: null,
    },
  ];

  const mockCampaigns = [
    { id: 'camp-1', name: 'Auto Insurance Inbound' },
    { id: 'camp-2', name: 'Home Security Leads' },
  ];

  const mockVendors = [
    { id: 'vend-1', name: 'Acme Media' },
    { id: 'vend-2', name: 'Apex Traffic' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue(new URLSearchParams(`workspace=${workspaceId}`));
  });

  describe('Vendor Participant View', () => {
    beforeEach(() => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve(mockVendorWorkspace);
        }
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({
            items: [
              {
                id: 'pn-v1',
                phone_number: '+15551001000',
                name: 'Assigned Direct',
                status: 'ACTIVE',
                number_type: 'local',
                campaign: { id: 'camp-1', name: 'Auto Insurance Inbound' },
              },
            ],
            total: 1,
          });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: [] });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: [] });
        }
        return Promise.resolve([]);
      });
    });

    it('renders "Tracking Numbers" title and description for Vendor', async () => {
      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'Tracking Numbers' })).toBeDefined();
        expect(screen.getByText('Assigned Tracking Numbers')).toBeDefined();
        expect(screen.getByText('Inbound tracking numbers assigned to your organization.')).toBeDefined();
      });
    });

    it('displays assigned tracking numbers with details in read-only mode', async () => {
      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByText('+15551001000')).toBeDefined();
        expect(screen.getByText('Assigned Direct')).toBeDefined();
        expect(screen.getByText('Auto Insurance Inbound')).toBeDefined();
      });

      // Actions column and mutation buttons must not be rendered
      expect(screen.queryByText('Action')).toBeNull();
      expect(screen.queryByRole('button', { name: /Assign/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Release/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Unassign/i })).toBeNull();

      // Vendor column must not be rendered
      expect(screen.queryByText('Vendor')).toBeNull();

      // Provisioning search/buy UI must be hidden
      expect(screen.queryByText('Provision New Number')).toBeNull();
      expect(screen.queryByText('Search Available Numbers')).toBeNull();
    });

    it('displays vendor-specific empty state when no numbers are assigned', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve(mockVendorWorkspace);
        if (url.includes('/phone-numbers')) return Promise.resolve({ items: [], total: 0 });
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByText('No tracking numbers assigned')).toBeDefined();
        expect(screen.getByText('You do not have any inbound tracking numbers assigned to your account yet.')).toBeDefined();
      });
    });
  });

  describe('Workspace Admin/Owner View', () => {
    beforeEach(() => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve(mockAdminWorkspace);
        }
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({
            items: mockPhoneNumbers,
            total: 2,
          });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: mockVendors });
        }
        return Promise.resolve([]);
      });
    });

    it('renders "Phone Numbers" title, provision card, and Vendor column for Admin', async () => {
      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'Phone Numbers' })).toBeDefined();
        expect(screen.getByText('Provisioned Numbers')).toBeDefined();
        expect(screen.getByText('Provision New Number')).toBeDefined();
      });

      // Vendor column header exists
      expect(screen.getByRole('columnheader', { name: 'Vendor' })).toBeDefined();
      // Assigned vendor name displayed in table and filter dropdown
      expect(screen.getAllByText('Acme Media').length).toBeGreaterThanOrEqual(1);
      // Action buttons exist
      expect(screen.getByRole('columnheader', { name: 'Action' })).toBeDefined();
    });

    it('opens Assign Vendor modal and updates vendor assignment on submit', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve(mockAdminWorkspace);
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`) && opts?.method === 'PUT') {
          return Promise.resolve({ id: 'pn-2', vendor_id: 'vend-2' });
        }
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({ items: mockPhoneNumbers, total: 2 });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: mockVendors });
        }
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByText('+18005552000')).toBeDefined();
      });

      // Find the Assign Vendor button for unassigned number pn-2
      const assignVendorBtn = screen.getByRole('button', { name: 'Assign Vendor' });
      fireEvent.click(assignVendorBtn);

      // Verify modal is open
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 3, name: 'Assign Vendor' })).toBeDefined();
        expect(screen.getAllByText('+18005552000').length).toBeGreaterThanOrEqual(2);
      });

      // Select vendor 'Apex Traffic' (id: 'vend-2')
      const select = screen.getByLabelText('Vendor');
      fireEvent.change(select, { target: { value: 'vend-2' } });

      // Click "Save Assignment"
      const saveBtn = screen.getByRole('button', { name: 'Save Assignment' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          `/workspaces/${workspaceId}/phone-numbers/pn-2`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ vendorId: 'vend-2' }),
          })
        );
        expect(screen.getByText('Vendor assignment updated successfully.')).toBeDefined();
      });
    });

    it('allows unassigning a vendor by selecting unassigned', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve(mockAdminWorkspace);
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`) && opts?.method === 'PUT') {
          return Promise.resolve({ id: 'pn-1', vendor_id: null });
        }
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({ items: mockPhoneNumbers, total: 2 });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: mockVendors });
        }
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByText('+15551001000')).toBeDefined();
      });

      // Find the 'Vendor' button for pn-1 (already has vendor)
      const vendorBtn = screen.getByRole('button', { name: 'Vendor' });
      fireEvent.click(vendorBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 3, name: 'Assign Vendor' })).toBeDefined();
      });

      // Select '-- Unassigned --' (value: '')
      const select = screen.getByLabelText('Vendor');
      fireEvent.change(select, { target: { value: '' } });

      // Save
      const saveBtn = screen.getByRole('button', { name: 'Save Assignment' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          `/workspaces/${workspaceId}/phone-numbers/pn-1`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ vendorId: null }),
          })
        );
      });
    });

    it('displays error feedback when vendor assignment PUT request fails', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve(mockAdminWorkspace);
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`) && opts?.method === 'PUT') {
          return Promise.reject(new Error('Vendor not found in workspace'));
        }
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({ items: mockPhoneNumbers, total: 2 });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: mockVendors });
        }
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByText('+18005552000')).toBeDefined();
      });

      const assignVendorBtn = screen.getByRole('button', { name: 'Assign Vendor' });
      fireEvent.click(assignVendorBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 3, name: 'Assign Vendor' })).toBeDefined();
      });

      const select = screen.getByLabelText('Vendor');
      fireEvent.change(select, { target: { value: 'vend-1' } });

      const saveBtn = screen.getByRole('button', { name: 'Save Assignment' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/Unable to update vendor assignment: Vendor not found in workspace/i)).toBeDefined();
      });
    });

    it('triggers dedicated Unassign Vendor confirmation dialog and sends null vendorId', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve(mockAdminWorkspace);
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`) && opts?.method === 'PUT') {
          return Promise.resolve({ id: 'pn-1', vendor_id: null });
        }
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({ items: mockPhoneNumbers, total: 2 });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: mockVendors });
        }
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Unassign Vendor' })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Unassign Vendor' }));

      // Confirm dialog appears
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toBeDefined();
      expect(screen.getByText(/Are you sure you want to unassign vendor/i)).toBeDefined();

      // Click Confirm inside dialog
      const confirmBtns = screen.getAllByRole('button', { name: 'Unassign Vendor' });
      const dialogConfirmBtn = confirmBtns[confirmBtns.length - 1];
      fireEvent.click(dialogConfirmBtn);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          `/workspaces/${workspaceId}/phone-numbers/pn-1`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ vendorId: null }),
          })
        );
      });
    });

    it('filters phone numbers by search text and allows clearing', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve(mockAdminWorkspace);
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({ items: mockPhoneNumbers, total: 2 });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: mockVendors });
        }
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByText('+15551001000')).toBeDefined();
        expect(screen.getByText('+18005552000')).toBeDefined();
      });

      const searchInput = screen.getByPlaceholderText('Filter by number or name...');
      fireEvent.change(searchInput, { target: { value: '800555' } });

      // Only pn-2 should be visible in table
      expect(screen.queryByText('+15551001000')).toBeNull();
      expect(screen.getByText('+18005552000')).toBeDefined();

      // Clear button should be visible
      const clearBtn = screen.getByRole('button', { name: 'Clear' });
      fireEvent.click(clearBtn);

      // Both should be restored
      expect(screen.getByText('+15551001000')).toBeDefined();
      expect(screen.getByText('+18005552000')).toBeDefined();
    });

    it('shows informative notice when no vendors exist in workspace', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve(mockAdminWorkspace);
        if (url.includes(`/workspaces/${workspaceId}/phone-numbers`)) {
          return Promise.resolve({ items: mockPhoneNumbers, total: 2 });
        }
        if (url.includes(`/workspaces/${workspaceId}/campaigns`)) {
          return Promise.resolve({ items: mockCampaigns });
        }
        if (url.includes(`/workspaces/${workspaceId}/vendors`)) {
          return Promise.resolve({ items: [] }); // 0 vendors
        }
        return Promise.resolve([]);
      });

      render(<PhoneNumbersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Assign Vendor' })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Assign Vendor' }));

      await waitFor(() => {
        expect(screen.getByText(/No vendors found in this workspace/i)).toBeDefined();
        expect(screen.getByText('Create a vendor in the Vendors tab')).toBeDefined();
      });
    });
  });
});
