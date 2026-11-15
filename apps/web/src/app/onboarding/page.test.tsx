import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OnboardingClient from './onboarding-client';
import { useRouter } from 'next/navigation';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

describe('Onboarding Flow Client Suite', () => {
  const mockPush = vi.fn();
  const mockRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      refresh: mockRefresh,
    } as any);
  });

  it('renders workspace creation input and submit button', () => {
    render(<OnboardingClient token="mock-jwt-token" apiUrl="http://localhost:3000" />);

    expect(screen.getByLabelText(/Workspace Name/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Create Workspace/i })).toBeDefined();
  });

  it('validates required workspace name before submitting', async () => {
    render(<OnboardingClient token="mock-jwt-token" apiUrl="http://localhost:3000" />);

    const submitBtn = screen.getByRole('button', { name: /Create Workspace/i });
    fireEvent.click(submitBtn);

    expect(screen.getByText('Workspace name is required.')).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('successfully creates workspace, stores active context in sessionStorage, and routes to reporting', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ws-created-999', name: 'New Corp' }),
    } as any);

    render(<OnboardingClient token="mock-jwt-token" apiUrl="http://localhost:3000" />);

    const input = screen.getByLabelText(/Workspace Name/i);
    fireEvent.change(input, { target: { value: 'New Corp' } });

    const submitBtn = screen.getByRole('button', { name: /Create Workspace/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-jwt-token',
        },
        body: JSON.stringify({ name: 'New Corp' }),
      });
      expect(sessionStorage.getItem('callflow.active_workspace_id')).toBe('ws-created-999');
      expect(mockPush).toHaveBeenCalledWith('/protected/reporting?workspace=ws-created-999');
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('handles backend error response displaying error banner', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Workspace name already in use.' }),
    } as any);

    render(<OnboardingClient token="mock-jwt-token" apiUrl="http://localhost:3000" />);

    const input = screen.getByLabelText(/Workspace Name/i);
    fireEvent.change(input, { target: { value: 'Existing Workspace' } });

    const submitBtn = screen.getByRole('button', { name: /Create Workspace/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Workspace name already in use.')).toBeDefined();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
