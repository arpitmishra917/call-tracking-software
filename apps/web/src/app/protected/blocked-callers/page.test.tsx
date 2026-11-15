import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BlockedCallersPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

describe('Blocked Callers Management Suite', () => {
  const mockCallers = [
    {
      id: 'bc-1',
      phone_number: '+15551234567',
      reason: 'Known robocaller / spam source',
      created_at: '2026-11-01T12:00:00Z',
    },
    {
      id: 'bc-2',
      phone_number: '+15559876543',
      reason: null,
      created_at: '2026-11-02T15:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSearchParams).mockReturnValue({
      get: (param: string) => (param === 'workspace' ? 'ws-test-blocked' : null),
    } as any);
  });

  it('loads and lists blocked callers', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ items: mockCallers }));

    render(<BlockedCallersPage />);

    expect(await screen.findByText('+15551234567')).toBeDefined();
    expect(screen.getByText('Known robocaller / spam source')).toBeDefined();
    expect(screen.getByText('+15559876543')).toBeDefined();
  });

  it('adds a new blocked caller with phone number and reason', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return { id: 'bc-3' };
      }
      return { items: mockCallers };
    });

    render(<BlockedCallersPage />);
    await screen.findByText('+15551234567');

    const phoneInput = screen.getByLabelText(/Phone Number/i);
    fireEvent.change(phoneInput, { target: { value: '+15550001111' } });

    const reasonInput = screen.getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Fraud' } });

    const blockBtn = screen.getByRole('button', { name: /^Block Caller$/i });
    fireEvent.click(blockBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-blocked/blocked-callers', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: '+15550001111', reason: 'Fraud' }),
      });
    });
  });

  it('unblocks a caller with confirmation dialog', async () => {
    let items = [...mockCallers];
    vi.mocked(apiFetch).mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        items = items.filter((c) => c.id !== 'bc-1');
        return {};
      }
      return { items };
    });

    render(<BlockedCallersPage />);
    await screen.findByText('+15551234567');

    const unblockButtons = screen.getAllByRole('button', { name: /Unblock/i });
    fireEvent.click(unblockButtons[0]);

    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /^Unblock$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-blocked/blocked-callers/bc-1', {
        method: 'DELETE',
      });
    });
  });

  it('renders empty state when no blocked callers are present', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ items: [] }));

    render(<BlockedCallersPage />);

    expect(await screen.findByText('No blocked callers')).toBeDefined();
  });
});
