import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VendorsPage from './page';
import VendorDetailPage from './[vendorId]/page';
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

describe('Vendors Management UI Suite', () => {
  const mockOwnerWorkspace = {
    id: 'ws-test-vendors',
    name: 'Primary Marketing WS',
    role: 'OWNER',
    participant_type: 'INTERNAL',
    permissions: [],
  };

  const mockVendors = [
    {
      id: 'v-1',
      name: 'Alpha Media Traffic',
      status: 'ACTIVE',
      workspace_id: 'ws-test-vendors',
      created_at: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 'v-2',
      name: 'Beta Affiliate Network',
      status: 'INACTIVE',
      workspace_id: 'ws-test-vendors',
      created_at: '2026-10-02T11:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-vendors' : null),
    });
  });

  describe('1. Authorization & Role Verification', () => {
    it('renders forbidden state when external VENDOR participant attempts access', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            {
              id: 'ws-test-vendors',
              name: 'Vendor Workspace',
              role: 'MEMBER',
              participant_type: 'VENDOR',
            },
          ]);
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
        expect(screen.getByText(/Participants do not have access to vendor management/i)).toBeDefined();
      });
      expect(screen.queryByText('Add Vendor')).toBeNull();
    });

    it('renders forbidden state when external BUYER participant attempts access', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            {
              id: 'ws-test-vendors',
              name: 'Buyer Workspace',
              role: 'MEMBER',
              participant_type: 'BUYER',
            },
          ]);
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
        expect(screen.getByText(/Participants do not have access to vendor management/i)).toBeDefined();
      });
    });

    it('renders forbidden state for VIEWER role', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            {
              id: 'ws-test-vendors',
              role: 'VIEWER',
              participant_type: 'INTERNAL',
            },
          ]);
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
        expect(screen.getByText(/Viewers do not have permission/i)).toBeDefined();
      });
    });

    it('renders forbidden state for internal MEMBER lacking vendor:read permission', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            {
              id: 'ws-test-vendors',
              role: 'MEMBER',
              participant_type: 'INTERNAL',
              permissions: ['call:read'],
            },
          ]);
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
        expect(screen.getByText(/Missing vendor:read permission/i)).toBeDefined();
      });
    });
  });

  describe('2. Vendor Listing, Empty & Error States', () => {
    it('renders loading indicator initially then displays vendor list', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?')) {
          return Promise.resolve({ items: mockVendors, total: 2 });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Alpha Media Traffic')).toBeDefined();
        expect(screen.getByText('Beta Affiliate Network')).toBeDefined();
      });

      expect(screen.getByText('ACTIVE')).toBeDefined();
      expect(screen.getByText('INACTIVE')).toBeDefined();
    });

    it('renders empty state when workspace has no vendors', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?')) {
          return Promise.resolve({ items: [], total: 0 });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('No vendors found')).toBeDefined();
        expect(screen.getByText(/Add a vendor partner to start tracking inbound traffic sources/i)).toBeDefined();
      });
    });

    it('renders error banner when API fetch fails', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?')) {
          return Promise.reject(new Error('Network connection failed'));
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Network connection failed')).toBeDefined();
      });
    });
  });

  describe('3. Filtering & Search', () => {
    it('queries backend with search and status query parameters', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?')) {
          return Promise.resolve({ items: [mockVendors[0]], total: 1 });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Alpha Media Traffic')).toBeDefined();
      });

      const searchInput = screen.getByPlaceholderText('Search vendors by name...');
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('search=Alpha')
        );
      });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'ACTIVE' } });

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('status=ACTIVE')
        );
      });
    });
  });

  describe('4. Vendor Creation Form & Validation', () => {
    it('opens create modal and successfully creates a new vendor', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?') && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockVendors, total: 2 });
        }
        if (url.endsWith('/vendors') && opts?.method === 'POST') {
          return Promise.resolve({
            id: 'v-new',
            name: 'Delta Inbound Solutions',
            status: 'ACTIVE',
            workspace_id: 'ws-test-vendors',
          });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Add Vendor')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Add Vendor'));
      expect(screen.getByText('Add New Vendor')).toBeDefined();

      const input = screen.getByLabelText('Vendor Name');
      fireEvent.change(input, { target: { value: 'Delta Inbound Solutions' } });

      fireEvent.click(screen.getByText('Create Vendor'));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-vendors/vendors', {
          method: 'POST',
          body: JSON.stringify({ name: 'Delta Inbound Solutions' }),
        });
      });
    });
  });

  describe('5. Vendor Editing & Status Actions', () => {
    it('opens edit modal and submits vendor name update', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?') && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockVendors, total: 2 });
        }
        if (url.includes('/vendors/v-1') && opts?.method === 'PUT') {
          return Promise.resolve({ ...mockVendors[0], name: 'Alpha Media Traffic Group' });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Edit').length).toBeGreaterThan(0);
      });

      // Click Edit for first vendor
      fireEvent.click(screen.getAllByText('Edit')[0]);

      expect(screen.getByText('Edit Vendor')).toBeDefined();
      const input = screen.getByLabelText('Vendor Name');
      expect((input as HTMLInputElement).value).toBe('Alpha Media Traffic');

      fireEvent.change(input, { target: { value: 'Alpha Media Traffic Group' } });
      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-vendors/vendors/v-1', {
          method: 'PUT',
          body: JSON.stringify({ name: 'Alpha Media Traffic Group' }),
        });
      });
    });

    it('triggers deactivate archive action with confirmation dialog', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?') && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockVendors, total: 2 });
        }
        if (url.includes('/vendors/v-1/archive') && opts?.method === 'POST') {
          return Promise.resolve({ ...mockVendors[0], status: 'INACTIVE' });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Deactivate')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Deactivate'));

      // Confirm dialog appears
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toBeDefined();
      expect(screen.getByText(/Are you sure you want to deactivate/i)).toBeDefined();

      // Click confirm button inside the alertdialog
      const confirmButtons = screen.getAllByRole('button', { name: 'Deactivate' });
      // The last one is inside the ConfirmDialog
      fireEvent.click(confirmButtons[confirmButtons.length - 1]);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-vendors/vendors/v-1/archive', {
          method: 'POST',
        });
      });
    });

    it('activates an inactive vendor', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url.includes('/vendors?') && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockVendors, total: 2 });
        }
        if (url.includes('/vendors/v-2/activate') && opts?.method === 'POST') {
          return Promise.resolve({ ...mockVendors[1], status: 'ACTIVE' });
        }
        return Promise.resolve({});
      });

      render(<VendorsPage />);

      await waitFor(() => {
        expect(screen.getByText('Activate')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Activate'));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-vendors/vendors/v-2/activate', {
          method: 'POST',
        });
      });
    });
  });

  describe('6. Vendor Detail Page', () => {
    it('renders vendor details, metadata, assigned numbers, and commercial note', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces/ws-test-vendors/vendors/v-1') {
          return Promise.resolve({
            id: 'v-1',
            name: 'Alpha Media Traffic',
            status: 'ACTIVE',
            workspace_id: 'ws-test-vendors',
            created_at: '2026-10-01T10:00:00.000Z',
            updated_at: '2026-10-05T12:00:00.000Z',
            phone_numbers: [
              {
                id: 'pn-1',
                phone_number: '+18005550199',
                name: 'Toll-Free Lead Gen',
                status: 'ACTIVE',
                campaign: {
                  id: 'c-1',
                  name: 'Health Inbound 2026',
                  status: 'ACTIVE',
                },
              },
            ],
          });
        }
        return Promise.resolve({});
      });

      render(<VendorDetailPage params={{ vendorId: 'v-1' }} />);

      await waitFor(() => {
        expect(screen.getAllByText('Alpha Media Traffic').length).toBeGreaterThan(0);
      });

      expect(screen.getByText('+18005550199')).toBeDefined();
      expect(screen.getByText('Health Inbound 2026')).toBeDefined();
      expect(screen.getByText('Commercial Terms')).toBeDefined();
      expect(screen.getByText(/Vendor payout rates and terms are defined on associated campaigns/i)).toBeDefined();
    });

    it('renders 403 Forbidden state for detail view when unauthorized', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url.includes('/vendors/v-forbidden')) {
          return Promise.reject(new Error('403 Forbidden: Insufficient resource scope'));
        }
        return Promise.resolve({});
      });

      render(<VendorDetailPage params={{ vendorId: 'v-forbidden' }} />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
        expect(screen.getByText('Back to Vendors')).toBeDefined();
      });
    });

    it('opens Assign Number modal, selects an available number, and assigns it to vendor', async () => {
      const mockWorkspaceNumbers = [
        {
          id: 'pn-avail-1',
          phone_number: '+18005553333',
          name: 'Direct Line',
          status: 'ACTIVE',
          campaign: { id: 'c-1', name: 'Auto Campaign' },
          vendor_id: null,
        },
        {
          id: 'pn-avail-2',
          phone_number: '+18005554444',
          name: 'Existing Line',
          status: 'ACTIVE',
          campaign: null,
          vendor_id: 'v-2',
          vendor: { id: 'v-2', name: 'Beta Affiliate Network' },
        },
      ];

      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url === '/workspaces/ws-test-vendors/vendors/v-1') {
          return Promise.resolve({
            id: 'v-1',
            name: 'Alpha Media Traffic',
            status: 'ACTIVE',
            workspace_id: 'ws-test-vendors',
            phone_numbers: [],
          });
        }
        if (url === '/workspaces/ws-test-vendors/invitations') {
          return Promise.resolve([]);
        }
        if (url === '/workspaces/ws-test-vendors/phone-numbers' && (!opts || opts.method === 'GET' || !opts.method)) {
          return Promise.resolve({ items: mockWorkspaceNumbers });
        }
        if (url === '/workspaces/ws-test-vendors/phone-numbers/pn-avail-1' && opts?.method === 'PUT') {
          return Promise.resolve({ id: 'pn-avail-1', vendor_id: 'v-1' });
        }
        return Promise.resolve({});
      });

      render(<VendorDetailPage params={{ vendorId: 'v-1' }} />);

      await waitFor(() => {
        expect(screen.getAllByText('Alpha Media Traffic').length).toBeGreaterThan(0);
      });

      // Both the header button and the empty state CTA exist; find "Assign Number"
      const assignBtns = screen.getAllByRole('button', { name: /Assign (Phone )?Number/i });
      fireEvent.click(assignBtns[0]);

      // Verify modal is open
      await waitFor(() => {
        expect(screen.getByText(/Assign Phone Number to Alpha Media Traffic/i)).toBeDefined();
        expect(screen.getByText('+18005553333')).toBeDefined();
      });

      // Click on pn-avail-1
      fireEvent.click(screen.getByText('+18005553333'));

      // Click "Assign to Vendor" submit button
      const submitBtn = screen.getByRole('button', { name: 'Assign to Vendor' });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-test-vendors/phone-numbers/pn-avail-1',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ vendorId: 'v-1' }),
          })
        );
      });
    });

    it('unassigns an assigned phone number with confirmation dialog', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces') return Promise.resolve([mockOwnerWorkspace]);
        if (url === '/workspaces/ws-test-vendors/vendors/v-1') {
          return Promise.resolve({
            id: 'v-1',
            name: 'Alpha Media Traffic',
            status: 'ACTIVE',
            workspace_id: 'ws-test-vendors',
            phone_numbers: [
              {
                id: 'pn-1',
                phone_number: '+18005550199',
                status: 'ACTIVE',
                campaign: { id: 'c-1', name: 'Health Inbound' },
              },
            ],
          });
        }
        if (url === '/workspaces/ws-test-vendors/invitations') {
          return Promise.resolve([]);
        }
        if (url === '/workspaces/ws-test-vendors/phone-numbers/pn-1' && opts?.method === 'PUT') {
          return Promise.resolve({ id: 'pn-1', vendor_id: null });
        }
        return Promise.resolve({});
      });

      render(<VendorDetailPage params={{ vendorId: 'v-1' }} />);

      await waitFor(() => {
        expect(screen.getByText('+18005550199')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Unassign' })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));

      // Confirm dialog appears
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toBeDefined();
      expect(screen.getByText(/Are you sure you want to unassign/i)).toBeDefined();

      // Click "Unassign Number" in the dialog
      const confirmBtn = screen.getByRole('button', { name: 'Unassign Number' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-test-vendors/phone-numbers/pn-1',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ vendorId: null }),
          })
        );
      });
    });
  });
});
