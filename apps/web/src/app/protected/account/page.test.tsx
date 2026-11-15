import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountPage from './page';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/components/appearance-settings', () => ({
  AppearanceSettings: () => <div data-testid="appearance-settings">Appearance Settings</div>,
}));

describe('Account Settings Page Suite', () => {
  const mockSupabase = {
    auth: {
      getUser: vi.fn(),
      updateUser: vi.fn(),
      signInWithPassword: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue(mockSupabase as any);
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'usr-1', email: 'owner@example.com' } },
      error: null,
    });
  });

  it('loads account details and renders profile form', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ fullName: 'Alice Workspace Owner' });

    render(<AccountPage />);

    expect(await screen.findByDisplayValue('Alice Workspace Owner')).toBeDefined();
    expect(screen.getByDisplayValue('owner@example.com')).toBeDefined();
    expect(screen.getByTestId('appearance-settings')).toBeDefined();
  });

  it('updates profile full name successfully', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ fullName: 'Alice Original' })
      .mockResolvedValueOnce({ fullName: 'Alice Updated' });

    render(<AccountPage />);

    const nameInput = await screen.findByDisplayValue('Alice Original');
    fireEvent.change(nameInput, { target: { value: 'Alice Updated' } });

    const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/account/profile', {
        method: 'PUT',
        body: JSON.stringify({ fullName: 'Alice Updated' }),
      });
    });

    expect(await screen.findByText(/profile updated successfully/i)).toBeDefined();
  });

  it('displays error banner if fetching account fails', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Failed to retrieve account details'));

    render(<AccountPage />);

    expect(await screen.findByText('Failed to retrieve account details')).toBeDefined();
  });
});
