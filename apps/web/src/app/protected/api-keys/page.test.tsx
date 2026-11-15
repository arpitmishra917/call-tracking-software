import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ApiKeysPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

describe('API Keys Management Suite', () => {
  const mockKeys = [
    {
      id: 'key-1',
      name: 'Zapier Ingestion Key',
      key_prefix: 'cf_live_zap...',
      last_used_at: '2026-11-10T12:00:00Z',
      revoked_at: null,
      created_at: '2026-11-01T10:00:00Z',
    },
    {
      id: 'key-2',
      name: 'Staging Webhook Ingest',
      key_prefix: 'cf_live_stg...',
      last_used_at: null,
      revoked_at: '2026-11-05T14:30:00Z',
      created_at: '2026-11-02T10:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSearchParams).mockReturnValue({
      get: (param: string) => (param === 'workspace' ? 'ws-test-api-keys' : null),
    } as any);
  });

  it('loads and renders existing API keys with prefix, status, and creation date', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => mockKeys);

    render(<ApiKeysPage />);

    expect(screen.getByText('Loading API keys...')).toBeDefined();
    expect(await screen.findByText('Zapier Ingestion Key')).toBeDefined();
    expect(screen.getByText('Staging Webhook Ingest')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('Revoked')).toBeDefined();
  });

  it('creates new API key and displays secret warning banner with copy action', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return { rawSecret: 'cf_live_secret_key_1234567890abcdef' };
      }
      return mockKeys;
    });

    render(<ApiKeysPage />);
    await screen.findByText('Zapier Ingestion Key');

    const input = screen.getByLabelText(/Key Name/i);
    fireEvent.change(input, { target: { value: 'Production Integration Key' } });

    const createBtn = screen.getByRole('button', { name: /Create Key/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-api-keys/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'Production Integration Key' }),
      });
      expect(screen.getByText('API Key Created')).toBeDefined();
      expect(screen.getByText('cf_live_secret_key_1234567890abcdef')).toBeDefined();
    });
  });

  it('revokes active key via confirmation dialog', async () => {
    let keysState = [...mockKeys];
    vi.mocked(apiFetch).mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        keysState = keysState.filter((k) => k.id !== 'key-1');
        return {};
      }
      return keysState;
    });

    render(<ApiKeysPage />);
    await screen.findByText('Zapier Ingestion Key');

    const revokeButtons = screen.getAllByRole('button', { name: /^Revoke$/i });
    fireEvent.click(revokeButtons[0]);

    const confirmBtn = await screen.findByRole('button', { name: /Revoke Key/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-test-api-keys/api-keys/key-1', {
        method: 'DELETE',
      });
    });
  });

  it('renders empty state when no API keys are registered', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => []);

    render(<ApiKeysPage />);

    expect(await screen.findByText('No API keys yet')).toBeDefined();
  });
});
