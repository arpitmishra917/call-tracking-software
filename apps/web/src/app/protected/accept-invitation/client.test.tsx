import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AcceptInvitationClient from './client';
import { apiFetch } from '@/lib/api';
import { useRouter } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

describe('Accept Invitation Client Suite', () => {
  const mockRouter = { push: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter as any);
  });

  it('submits token to /workspaces/accept-invitation and displays success', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ workspaceId: 'ws-accepted-123' });

    render(<AcceptInvitationClient token="tok-accept-abc" />);

    expect(screen.getByText(/Accepting Invitation.../i)).toBeDefined();

    expect(await screen.findByText(/Invitation accepted successfully! Redirecting.../i)).toBeDefined();
    expect(apiFetch).toHaveBeenCalledWith('/workspaces/accept-invitation', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok-accept-abc' }),
    });
  });

  it('displays parsed error message when invitation acceptance fails', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new Error('API error (400): {"message": "Invitation token has already been accepted or revoked"}')
    );

    render(<AcceptInvitationClient token="tok-invalid" />);

    expect(
      await screen.findByText('Invitation token has already been accepted or revoked')
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeDefined();
  });
});
