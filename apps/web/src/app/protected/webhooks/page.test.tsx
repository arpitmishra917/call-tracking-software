import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WebhooksPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

describe('Webhooks Management Suite', () => {
  const mockWebhooks = [
    {
      id: 'wh-1',
      url: 'https://api.crm.example.com/call-events',
      status: 'ACTIVE',
      created_at: '2026-11-01T12:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSearchParams).mockReturnValue({
      get: (param: string) => (param === 'workspace' ? 'ws-test-webhooks' : null),
    } as any);
  });

  it('loads and lists registered webhook subscriptions', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => mockWebhooks);

    render(<WebhooksPage />);

    expect(await screen.findByText('https://api.crm.example.com/call-events')).toBeDefined();
    expect(screen.getByText('active')).toBeDefined();
  });

  it('creates a new webhook and reveals secret banner', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return { id: 'wh-2', secret: 'whsec_9876543210fedcba' };
      }
      return mockWebhooks;
    });

    render(<WebhooksPage />);
    await screen.findByText('https://api.crm.example.com/call-events');

    const input = screen.getByLabelText(/Endpoint URL/i);
    fireEvent.change(input, { target: { value: 'https://new-listener.com' } });

    const createBtn = screen.getByRole('button', { name: /^Create Webhook$/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-webhooks/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://new-listener.com' }),
      });
      expect(screen.getByText('Webhook Created')).toBeDefined();
      expect(screen.getByText('whsec_9876543210fedcba')).toBeDefined();
    });
  });

  it('deletes webhook subscription using ConfirmDialog', async () => {
    let list = [...mockWebhooks];
    vi.mocked(apiFetch).mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        list = list.filter((w) => w.id !== 'wh-1');
        return {};
      }
      return list;
    });

    render(<WebhooksPage />);
    await screen.findByText('https://api.crm.example.com/call-events');

    const deleteBtn = screen.getByRole('button', { name: /^Delete$/i });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /^Delete$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-webhooks/webhooks/wh-1', {
        method: 'DELETE',
      });
    });
  });

  it('renders empty state when no webhooks exist', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => []);

    render(<WebhooksPage />);

    expect(await screen.findByText('No webhooks yet')).toBeDefined();
  });
});
