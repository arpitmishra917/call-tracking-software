import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InviteUserDialog } from './invite-user-dialog';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

describe('InviteUserDialog - Buyer/Vendor Participant Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly when open for a BUYER with entity context', () => {
    render(
      <InviteUserDialog
        workspaceId="ws-1"
        isOpen={true}
        onClose={vi.fn()}
        participantType="BUYER"
        entityId="buyer-101"
        entityName="Direct Lead Buyer LLC"
      />
    );

    expect(screen.getByText('Invite Buyer User')).toBeDefined();
    expect(screen.getByText('Direct Lead Buyer LLC')).toBeDefined();
    expect(screen.getByText('BUYER')).toBeDefined();
    expect(screen.getByLabelText(/User Email/i)).toBeDefined();
    expect(screen.getByLabelText(/Role/i)).toBeDefined();
  });

  it('submits exact BUYER DTO payload with buyer_id and displays copyable link on success', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'inv-1',
      token: 'secret-buyer-token-123',
    });

    const handleSuccess = vi.fn();

    render(
      <InviteUserDialog
        workspaceId="ws-1"
        isOpen={true}
        onClose={vi.fn()}
        participantType="BUYER"
        entityId="buyer-101"
        entityName="Direct Lead Buyer LLC"
        onSuccess={handleSuccess}
      />
    );

    const emailInput = screen.getByLabelText(/User Email/i);
    fireEvent.change(emailInput, { target: { value: 'buyer.agent@example.com' } });

    const submitBtn = screen.getByRole('button', { name: /Generate Invitation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: 'buyer.agent@example.com',
          role: 'MEMBER',
          participant_type: 'BUYER',
          buyer_id: 'buyer-101',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Invitation Link Ready')).toBeDefined();
      expect(screen.getByLabelText('Invitation Link')).toBeDefined();
    });

    const linkInput = screen.getByLabelText('Invitation Link') as HTMLInputElement;
    expect(linkInput.value).toContain('/invitations?token=secret-buyer-token-123');
    expect(handleSuccess).toHaveBeenCalledWith('secret-buyer-token-123');
  });

  it('submits exact VENDOR DTO payload with vendor_id for VENDOR participant', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'inv-2',
      token: 'secret-vendor-token-456',
    });

    render(
      <InviteUserDialog
        workspaceId="ws-1"
        isOpen={true}
        onClose={vi.fn()}
        participantType="VENDOR"
        entityId="vendor-202"
        entityName="Global Traffic Source"
      />
    );

    expect(screen.getByText('Invite Vendor User')).toBeDefined();
    expect(screen.getByText('Global Traffic Source')).toBeDefined();

    const emailInput = screen.getByLabelText(/User Email/i);
    fireEvent.change(emailInput, { target: { value: 'vendor.rep@traffic.com' } });

    const roleSelect = screen.getByLabelText(/Role/i);
    fireEvent.change(roleSelect, { target: { value: 'VIEWER' } });

    const submitBtn = screen.getByRole('button', { name: /Generate Invitation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: 'vendor.rep@traffic.com',
          role: 'VIEWER',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-202',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Invitation Link Ready')).toBeDefined();
    });
  });

  it('displays API error alert when invitation submission fails', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Vendor not found in workspace'));

    render(
      <InviteUserDialog
        workspaceId="ws-1"
        isOpen={true}
        onClose={vi.fn()}
        participantType="VENDOR"
        entityId="vendor-invalid"
        entityName="Invalid Vendor"
      />
    );

    const emailInput = screen.getByLabelText(/User Email/i);
    fireEvent.change(emailInput, { target: { value: 'test@invalid.com' } });

    const submitBtn = screen.getByRole('button', { name: /Generate Invitation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText('Vendor not found in workspace')).toBeDefined();
    });
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <InviteUserDialog
        workspaceId="ws-1"
        isOpen={false}
        onClose={vi.fn()}
        participantType="BUYER"
        entityId="buyer-101"
        entityName="Direct Lead Buyer LLC"
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
