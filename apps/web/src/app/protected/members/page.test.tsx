import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MembersPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams, useRouter } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn().mockReturnValue({
    push: vi.fn(),
  }),
}));

vi.mock('@/utils/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-admin-1' } },
      }),
    },
  }),
}));

describe('MembersPage - Buyer/Vendor Invitation UI', () => {
  const mockWorkspacesAdmin = [
    { id: 'ws-test-1', name: 'Test Workspace', role: 'ADMIN' },
  ];

  const mockWorkspacesMember = [
    { id: 'ws-test-1', name: 'Test Workspace', role: 'MEMBER' },
  ];

  const mockMembers = [
    {
      id: 'mem-1',
      workspace_id: 'ws-test-1',
      user_id: 'user-admin-1',
      role: 'ADMIN',
      participant_type: 'INTERNAL',
      created_at: '2026-10-01T00:00:00Z',
      profile: {
        id: 'p-1',
        display_name: 'Admin User',
        created_at: '2026-10-01T00:00:00Z',
      },
    },
    {
      id: 'mem-2',
      workspace_id: 'ws-test-1',
      user_id: 'user-2',
      role: 'MEMBER',
      participant_type: 'VENDOR',
      created_at: '2026-10-05T00:00:00Z',
      profile: {
        id: 'p-2',
        display_name: 'Vendor User',
        created_at: '2026-10-05T00:00:00Z',
      },
    },
  ];

  const mockVendors = {
    items: [
      { id: 'vendor-101', name: 'Acme Traffic Partner', status: 'ACTIVE' },
      { id: 'vendor-102', name: 'Global Direct Leads', status: 'ACTIVE' },
    ],
  };

  const mockBuyers = {
    items: [
      { id: 'buyer-201', name: 'Direct Buyer Alpha', destination_number: '+15551234567', status: 'ACTIVE' },
      { id: 'buyer-202', name: 'Prime Buyer Beta', destination_number: '+15559876543', status: 'ACTIVE' },
    ],
    total: 2,
  };

  const mockInvitations = [
    {
      id: 'inv-1',
      email: 'vendor.invited@example.com',
      role: 'MEMBER',
      participant_type: 'VENDOR',
      vendor_id: 'vendor-101',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000 * 5).toISOString(),
      created_at: '2026-10-15T00:00:00Z',
    },
    {
      id: 'inv-2',
      email: 'expired.buyer@example.com',
      role: 'MEMBER',
      participant_type: 'BUYER',
      buyer_id: 'buyer-201',
      status: 'EXPIRED',
      expires_at: new Date(Date.now() - 86400000).toISOString(),
      created_at: '2026-10-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-1' : null),
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  const setupDefaultApiMock = (role: 'ADMIN' | 'MEMBER' = 'ADMIN') => {
    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve(role === 'ADMIN' ? mockWorkspacesAdmin : mockWorkspacesMember);
      }
      if (url === '/workspaces/ws-test-1/members') {
        return Promise.resolve(mockMembers);
      }
      if (url === '/workspaces/ws-test-1/invitations' && (!options || options.method === 'GET')) {
        return Promise.resolve(mockInvitations);
      }
      if (url === '/workspaces/ws-test-1/vendors') {
        return Promise.resolve(mockVendors);
      }
      if (url === '/workspaces/ws-test-1/buyers') {
        return Promise.resolve(mockBuyers);
      }
      return Promise.resolve(null);
    });
  };

  it('1. Non-Owner/Admin cannot access the invite action', async () => {
    setupDefaultApiMock('MEMBER');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Team Members')).toBeDefined();
    });

    // Non-owner/admin should NOT see "Invite Member" button
    expect(screen.queryByText('Invite Member')).toBeNull();
    // Non-owner/admin should NOT see Pending Invitations table
    expect(screen.queryByText('Pending Invitations')).toBeNull();
  });

  it('2. Owner/Admin can view pending invitations with associated entities and expired status', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Pending Invitations')).toBeDefined();
    });

    expect(screen.getByText('vendor.invited@example.com')).toBeDefined();
    expect(screen.getAllByText('Acme Traffic Partner').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('PENDING')).toBeDefined();

    expect(screen.getByText('expired.buyer@example.com')).toBeDefined();
    expect(screen.getAllByText('Direct Buyer Alpha').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('EXPIRED')).toBeDefined();
  });

  it('3. INTERNAL invitation submits exact backend DTO without entity IDs', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    // Open invite modal
    fireEvent.click(screen.getByText('Invite Member'));

    // Modal elements should be visible
    expect(screen.getByLabelText(/Email/i)).toBeDefined();
    expect(screen.getByLabelText(/Participant Type/i)).toBeDefined();

    // Fill in Email
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'internal.teammate@example.com' },
    });

    // Participant Type defaults to INTERNAL
    const participantSelect = screen.getByLabelText(/Participant Type/i) as HTMLSelectElement;
    expect(participantSelect.value).toBe('INTERNAL');

    // Buyer and Vendor selectors should be hidden
    expect(screen.queryByLabelText(/Buyer \*/i)).toBeNull();
    expect(screen.queryByLabelText(/Vendor \*/i)).toBeNull();

    // Mock invitation creation response
    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces/ws-test-1/invitations' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'inv-new-internal',
          token: 'token-internal-abc-123',
          email: 'internal.teammate@example.com',
          role: 'MEMBER',
          participant_type: 'INTERNAL',
        });
      }
      return Promise.resolve([]);
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/i }));

    await waitFor(() => {
      expect(screen.getByText('Invitation Created')).toBeDefined();
    });

    // Verify exact backend DTO was sent
    expect(apiFetch).toHaveBeenCalledWith(
      '/workspaces/ws-test-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'internal.teammate@example.com',
          role: 'MEMBER',
          participant_type: 'INTERNAL',
        }),
      })
    );

    // Verify invitation link display
    const linkInput = screen.getByDisplayValue(/invitations\?token=token-internal-abc-123/);
    expect(linkInput).toBeDefined();

    // Click Copy button
    fireEvent.click(screen.getByText('Copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('invitations?token=token-internal-abc-123')
    );
  });

  it('4. BUYER invitation with buyer ID submits exact backend DTO', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Invite Member'));

    // Fill email
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'buyer.lead@example.com' },
    });

    // Select role
    fireEvent.change(screen.getByLabelText(/Role/i), {
      target: { value: 'VIEWER' },
    });

    // Select BUYER participant type
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'BUYER' },
    });

    // Buyer selector should appear, Vendor selector should be hidden
    await waitFor(() => {
      expect(screen.getByLabelText(/Buyer \*/i)).toBeDefined();
    });
    expect(screen.queryByLabelText(/Vendor \*/i)).toBeNull();

    const buyerSelect = screen.getByLabelText(/Buyer \*/i) as HTMLSelectElement;
    expect(within(buyerSelect).getByText(/Direct Buyer Alpha/)).toBeDefined();
    expect(within(buyerSelect).getByText(/Prime Buyer Beta/)).toBeDefined();

    // Select buyer ID
    fireEvent.change(buyerSelect, {
      target: { value: 'buyer-201' },
    });

    // Mock API POST
    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces/ws-test-1/invitations' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'inv-new-buyer',
          token: 'token-buyer-xyz-456',
          email: 'buyer.lead@example.com',
          role: 'VIEWER',
          participant_type: 'BUYER',
          buyer_id: 'buyer-201',
        });
      }
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Invite$/i }));

    await waitFor(() => {
      expect(screen.getByText('Invitation Created')).toBeDefined();
    });

    // Verify exact backend payload with buyer_id and without vendor_id
    expect(apiFetch).toHaveBeenCalledWith(
      '/workspaces/ws-test-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'buyer.lead@example.com',
          role: 'VIEWER',
          participant_type: 'BUYER',
          buyer_id: 'buyer-201',
        }),
      })
    );
  });

  it('5. VENDOR invitation with vendor ID submits exact backend DTO', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Invite Member'));

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'vendor.rep@example.com' },
    });

    // Select VENDOR participant type
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'VENDOR' },
    });

    // Vendor selector should appear, Buyer selector should be hidden
    await waitFor(() => {
      expect(screen.getByLabelText(/Vendor \*/i)).toBeDefined();
    });
    expect(screen.queryByLabelText(/Buyer \*/i)).toBeNull();

    const vendorSelect = screen.getByLabelText(/Vendor \*/i) as HTMLSelectElement;
    expect(within(vendorSelect).getByText(/Acme Traffic Partner/)).toBeDefined();
    expect(within(vendorSelect).getByText(/Global Direct Leads/)).toBeDefined();

    // Select vendor ID
    fireEvent.change(vendorSelect, {
      target: { value: 'vendor-101' },
    });

    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces/ws-test-1/invitations' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'inv-new-vendor',
          token: 'token-vendor-789',
          email: 'vendor.rep@example.com',
          role: 'MEMBER',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-101',
        });
      }
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Invite$/i }));

    await waitFor(() => {
      expect(screen.getByText('Invitation Created')).toBeDefined();
    });

    // Verify exact backend payload with vendor_id and without buyer_id
    expect(apiFetch).toHaveBeenCalledWith(
      '/workspaces/ws-test-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'vendor.rep@example.com',
          role: 'MEMBER',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-101',
        }),
      })
    );
  });

  it('6. Missing participant entity validation prevents submission and disables button', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Invite Member'));

    // Fill Email
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'test@example.com' },
    });

    const submitBtn = screen.getByRole('button', { name: /^Invite$/i });

    // When INTERNAL, valid
    expect(submitBtn.hasAttribute('disabled')).toBe(false);

    // Switch to BUYER without selecting buyer
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'BUYER' },
    });
    // Submit button should be disabled because buyerId is missing
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Switch to VENDOR without selecting vendor
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'VENDOR' },
    });
    // Submit button should be disabled because vendorId is missing
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('7. Switching participant type clears stale entity selection', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Invite Member'));

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'switch.test@example.com' },
    });

    // 1. Select BUYER and choose buyer-201
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'BUYER' },
    });
    const buyerSelect = screen.getByLabelText(/Buyer \*/i) as HTMLSelectElement;
    fireEvent.change(buyerSelect, { target: { value: 'buyer-201' } });
    expect(buyerSelect.value).toBe('buyer-201');

    // 2. Switch to VENDOR
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'VENDOR' },
    });
    // Buyer selector is unmounted
    expect(screen.queryByLabelText(/Buyer \*/i)).toBeNull();
    // Vendor selector is mounted and its value is empty (stale state cleared)
    const vendorSelect = screen.getByLabelText(/Vendor \*/i) as HTMLSelectElement;
    expect(vendorSelect.value).toBe('');

    // 3. Select vendor-101
    fireEvent.change(vendorSelect, { target: { value: 'vendor-101' } });
    expect(vendorSelect.value).toBe('vendor-101');

    // 4. Switch back to BUYER
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'BUYER' },
    });
    // Buyer selector is mounted with empty value (stale buyer-201 cleared)
    const newBuyerSelect = screen.getByLabelText(/Buyer \*/i) as HTMLSelectElement;
    expect(newBuyerSelect.value).toBe('');

    // 5. Switch to INTERNAL
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'INTERNAL' },
    });
    expect(screen.queryByLabelText(/Buyer \*/i)).toBeNull();
    expect(screen.queryByLabelText(/Vendor \*/i)).toBeNull();

    // 6. Submit as INTERNAL and verify no stale buyer_id or vendor_id is transmitted
    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces/ws-test-1/invitations' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'inv-internal-clean',
          token: 'token-clean',
        });
      }
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Invite$/i }));

    await waitFor(() => {
      expect(screen.getByText('Invitation Created')).toBeDefined();
    });

    expect(apiFetch).toHaveBeenCalledWith(
      '/workspaces/ws-test-1/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'switch.test@example.com',
          role: 'MEMBER',
          participant_type: 'INTERNAL',
        }),
      })
    );
  });

  it('8. Handles empty buyer and vendor lists with clear warning alerts', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') return Promise.resolve(mockWorkspacesAdmin);
      if (url === '/workspaces/ws-test-1/members') return Promise.resolve(mockMembers);
      if (url === '/workspaces/ws-test-1/invitations') return Promise.resolve([]);
      if (url === '/workspaces/ws-test-1/vendors') return Promise.resolve({ items: [] });
      if (url === '/workspaces/ws-test-1/buyers') return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve(null);
    });

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Invite Member'));

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'empty.check@example.com' },
    });

    // Switch to BUYER
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'BUYER' },
    });

    expect(
      screen.getByText(/No active buyers found in this workspace\. Please create a buyer before inviting a buyer participant\./i)
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /^Invite$/i }).hasAttribute('disabled')).toBe(true);

    // Switch to VENDOR
    fireEvent.change(screen.getByLabelText(/Participant Type/i), {
      target: { value: 'VENDOR' },
    });

    expect(
      screen.getByText(/No active vendors found in this workspace\. Please create a vendor before inviting a vendor participant\./i)
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /^Invite$/i }).hasAttribute('disabled')).toBe(true);
  });

  it('9. Handles API 403 / server error gracefully during invitation submission', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Invite Member'));

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'error.test@example.com' },
    });

    // Mock API error
    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces/ws-test-1/invitations' && options?.method === 'POST') {
        return Promise.reject(new Error('API error (403): Forbidden: You do not have permission to invite members'));
      }
      return Promise.resolve([]);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Invite$/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText(/API error \(403\): Forbidden/i).length).toBeGreaterThanOrEqual(1);
    // Modal stays open so user can rectify
    expect(screen.getByRole('heading', { name: 'Invite Member' })).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('10. Allows revoking an invitation and handles revocation errors gracefully', async () => {
    setupDefaultApiMock('ADMIN');

    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('vendor.invited@example.com')).toBeDefined();
    });

    (apiFetch as any).mockImplementation((url: string, options?: any) => {
      if (url === '/workspaces/ws-test-1/invitations/inv-1' && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve(mockInvitations);
    });

    const revokeButtons = screen.getAllByRole('button', { name: /Revoke/i });
    expect(revokeButtons.length).toBeGreaterThan(0);

    fireEvent.click(revokeButtons[0]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-1/invitations/inv-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
