import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BuyersPage from './page';
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

describe('Buyers Page - Redesigned UI Suite', () => {
  const mockOwnerWorkspace = {
    id: 'ws-test-buyers',
    name: 'Buyers Workspace',
    role: 'OWNER',
    participant_type: 'INTERNAL',
  };

  const mockMemberWorkspace = {
    id: 'ws-test-buyers',
    name: 'Buyers Workspace',
    role: 'MEMBER',
    participant_type: 'INTERNAL',
  };

  const mockVendorWorkspace = {
    id: 'ws-test-buyers',
    name: 'Vendor Workspace',
    role: 'MEMBER',
    participant_type: 'VENDOR',
  };

  const mockBuyers = [
    {
      id: 'buyer-1',
      name: 'Acme Direct Insurance',
      email: 'contact@acme.com',
      destination_number: '+15551234567',
      status: 'ACTIVE',
      timeout: 30,
      destination_numbers: [
        { id: 'dn-1', destination_number: '+15551234567', name: 'Main Line', status: 'ACTIVE' },
      ],
    },
    {
      id: 'buyer-2',
      name: 'Apex Home Services',
      email: 'leads@apex.com',
      destination_number: '+15559876543',
      status: 'INACTIVE',
      timeout: 45,
      destination_numbers: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-buyers' : null),
    });
  });

  describe('1. Role Access & Navigation Scoping', () => {
    it('renders buyer list, metric cards, and Add Buyer button for OWNER', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces/ws-test-buyers/buyers') {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockOwnerWorkspace]);
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
        expect(screen.getByText('Apex Home Services')).toBeDefined();
      });

      // Metric cards
      expect(screen.getByText('Organizations')).toBeDefined();
      expect(screen.getByText('Active Orgs')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();

      // Add Buyer button visible for owner
      expect(screen.getByRole('button', { name: /add buyer/i })).toBeDefined();

      // Invite user buttons
      const inviteButtons = screen.getAllByRole('button', { name: /invite user/i });
      expect(inviteButtons.length).toBe(2);
    });

    it('hides Invite User and Add Buyer button for regular MEMBER', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces/ws-test-buyers/buyers') {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockMemberWorkspace]);
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
      });

      expect(screen.queryByRole('button', { name: /add buyer/i })).toBeNull();
      const inviteButtons = screen.queryAllByRole('button', { name: /invite user/i });
      expect(inviteButtons.length).toBe(0);
      expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^activate$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^deactivate$/i })).toBeNull();
    });

    it('renders forbidden state for VENDOR participant attempting access', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces/ws-test-buyers/buyers') {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockVendorWorkspace]);
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
        expect(screen.getByText(/Vendor participants do not have access to buyer management/i)).toBeDefined();
      });
    });
  });

  describe('2. Search & Status Filtering', () => {
    it('filters buyer list locally by name and status', async () => {
      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces/ws-test-buyers/buyers') {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockOwnerWorkspace]);
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
        expect(screen.getByText('Apex Home Services')).toBeDefined();
      });

      const searchInput = screen.getByPlaceholderText(/search organizations or endpoints/i);
      fireEvent.change(searchInput, { target: { value: 'Acme' } });

      expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
      expect(screen.queryByText('Apex Home Services')).toBeNull();

      // Clear search and filter by status
      fireEvent.change(searchInput, { target: { value: '' } });
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'INACTIVE' } });

      expect(screen.queryByText('Acme Direct Insurance')).toBeNull();
      expect(screen.getByText('Apex Home Services')).toBeDefined();
    });
  });

  describe('3. Modal Creation & Inline Validation', () => {
    it('opens Add Buyer modal and submits valid buyer organization payload', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces/ws-test-buyers/buyers' && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockOwnerWorkspace]);
        }
        if (url === '/workspaces/ws-test-buyers/buyers' && opts?.method === 'POST') {
          return Promise.resolve({
            id: 'buyer-3',
            name: 'Delta Auto Insurance',
            email: 'contact@delta.com',
            destination_number: '+15554443322',
            timeout: 35,
            max_concurrent_calls: 1,
            status: 'ACTIVE',
          });
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add buyer/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /add buyer/i }));

      // Modal is visible
      expect(screen.getByText('Create Buyer Organization')).toBeDefined();

      fireEvent.change(screen.getByLabelText(/organization name/i), {
        target: { value: 'Delta Auto Insurance' },
      });
      fireEvent.change(screen.getByLabelText(/organization email/i), {
        target: { value: 'contact@delta.com' },
      });
      fireEvent.change(screen.getByLabelText(/destination phone number/i), {
        target: { value: '+15554443322' },
      });
      fireEvent.change(screen.getByLabelText(/ring timeout/i), {
        target: { value: '35' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create organization/i }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-test-buyers/buyers',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              name: 'Delta Auto Insurance',
              email: 'contact@delta.com',
              timeout: 35,
              max_concurrent_calls: 1,
              destinationNumber: '+15554443322',
            }),
          })
        );
      });
    });
  });

  describe('4. Deactivation Confirmation', () => {
    it('opens accessible ConfirmDialog on Deactivate click and submits archive POST', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces/ws-test-buyers/buyers' && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockOwnerWorkspace]);
        }
        if (url.includes('/buyers/buyer-1/archive') && opts?.method === 'POST') {
          return Promise.resolve({ ...mockBuyers[0], status: 'INACTIVE' });
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
      });

      // Find Deactivate button for Acme
      const deactivateButtons = screen.getAllByRole('button', { name: /deactivate/i });
      fireEvent.click(deactivateButtons[0]);

      // ConfirmDialog should be visible
      const alertdialog = await screen.findByRole('alertdialog');
      expect(alertdialog).toBeDefined();
      expect(screen.getByText(/Are you sure you want to deactivate/i)).toBeDefined();

      // Click Deactivate inside the dialog
      const dialogConfirmButtons = screen.getAllByRole('button', { name: 'Deactivate' });
      fireEvent.click(dialogConfirmButtons[dialogConfirmButtons.length - 1]);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-test-buyers/buyers/buyer-1/archive',
          expect.objectContaining({ method: 'POST' })
        );
      });
    });
  });

  describe('5. Invitation Modal Integration', () => {
    it('opens InviteUserDialog on button click and submits BUYER invitation', async () => {
      (apiFetch as any).mockImplementation((url: string, opts?: any) => {
        if (url === '/workspaces/ws-test-buyers/buyers' && (!opts || !opts.method || opts.method === 'GET')) {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces') {
          return Promise.resolve([mockOwnerWorkspace]);
        }
        if (url === '/workspaces/ws-test-buyers/invitations' && opts?.method === 'POST') {
          return Promise.resolve({
            id: 'inv-123',
            token: 'token-buyer-abc',
            email: 'buyer-user@acme.com',
            role: 'MEMBER',
            participant_type: 'BUYER',
            buyer_id: 'buyer-1',
          });
        }
        return Promise.resolve({});
      });

      render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
      });

      const inviteButtons = screen.getAllByRole('button', { name: /invite user/i });
      fireEvent.click(inviteButtons[0]);

      // Modal should now be open
      await waitFor(() => {
        expect(screen.getByText('Invite Buyer User')).toBeDefined();
        expect(screen.getAllByText('Acme Direct Insurance').length).toBeGreaterThan(1);
      });

      fireEvent.change(screen.getByLabelText(/user email/i), {
        target: { value: 'buyer-user@acme.com' },
      });

      fireEvent.click(screen.getByRole('button', { name: /generate invitation/i }));

      await waitFor(() => {
        expect(screen.getByText('Invitation Link Ready')).toBeDefined();
        expect(screen.getByDisplayValue(/token-buyer-abc/)).toBeDefined();
      });

      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-buyers/invitations',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'buyer-user@acme.com',
            role: 'MEMBER',
            participant_type: 'BUYER',
            buyer_id: 'buyer-1',
          }),
        })
      );
    });
  });

  describe('6. Tenant Isolation & Stale Response Protection', () => {
    it('clears buyers and does not apply stale responses when workspace switches to a forbidden workspace', async () => {
      let activeWs = 'ws-test-buyers';
      (useSearchParams as any).mockImplementation(() => ({
        get: (key: string) => (key === 'workspace' ? activeWs : null),
      }));

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            mockOwnerWorkspace,
            { id: 'ws-forbidden', name: 'Vendor Workspace', role: 'MEMBER', participant_type: 'VENDOR' },
          ]);
        }
        if (url === '/workspaces/ws-test-buyers/buyers') {
          return Promise.resolve({ items: mockBuyers });
        }
        if (url === '/workspaces/ws-forbidden/buyers') {
          return Promise.reject(new Error('API error (403): Forbidden'));
        }
        return Promise.resolve({});
      });

      const { rerender } = render(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Acme Direct Insurance')).toBeDefined();
      });

      // Switch to forbidden workspace
      activeWs = 'ws-forbidden';
      rerender(<BuyersPage />);

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeDefined();
      });

      // Prior workspace buyers must be cleared and not rendered
      expect(screen.queryByText('Acme Direct Insurance')).toBeNull();
      expect(screen.queryByText('Apex Home Services')).toBeNull();
    });
  });
});
