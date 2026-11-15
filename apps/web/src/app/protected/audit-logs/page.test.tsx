import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AuditLogsPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';
import { sanitizeMetadata, isSensitiveKey, isSensitiveValue } from '@/lib/audit-logs';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

const mockAuditLogs = [
  {
    id: 'log-1',
    workspace_id: 'ws-test-audit',
    actor_user_id: 'user-admin-1',
    actor_member_id: 'member-admin-1',
    action: 'PERMISSION_ASSIGNED',
    target_type: 'WORKSPACE_MEMBER',
    target_id: 'member-target-1',
    metadata: {
      permissionKey: 'call:read',
      scopeType: 'ALL',
      secretToken: 'super-secret-12345',
      userPassword: 'secretpassword',
    },
    created_at: '2026-10-15T10:00:00.000Z',
  },
  {
    id: 'log-2',
    workspace_id: 'ws-test-audit',
    actor_user_id: 'user-admin-1',
    actor_member_id: 'member-admin-1',
    action: 'INVITATION_CREATED',
    target_type: 'WORKSPACE_INVITATION',
    target_id: 'invite-1',
    metadata: {
      email: 'invitee@example.com',
      role: 'MEMBER',
    },
    created_at: '2026-10-15T11:00:00.000Z',
  },
  {
    id: 'log-3',
    workspace_id: 'ws-test-audit',
    actor_user_id: 'user-admin-1',
    actor_member_id: 'member-admin-1',
    action: 'MEMBER_REMOVED',
    target_type: 'WORKSPACE_MEMBER',
    target_id: 'member-removed-1',
    metadata: {
      previousRole: 'MEMBER',
    },
    created_at: '2026-10-15T12:00:00.000Z',
  },
];

describe('Audit Logs UI & RBAC Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-audit' : null),
    });
  });

  it('1. Owner can see audit logs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        return Promise.resolve({
          items: mockAuditLogs,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Audit Logs')).toBeDefined();
    expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();
    expect(screen.getByText('INVITATION_CREATED')).toBeDefined();
    expect(screen.getByText('MEMBER_REMOVED')).toBeDefined();
  });

  it('2. Admin can see audit logs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        return Promise.resolve({
          items: mockAuditLogs,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();
    expect(screen.getByText(/Showing/i)).toBeDefined();
    expect(screen.getByText(/Filter Audit Events/i)).toBeDefined();
  });

  it('3. Member with audit_log:read permission can see audit logs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          {
            id: 'ws-test-audit',
            name: 'Test WS',
            role: 'MEMBER',
            permissions: ['audit_log:read'],
          },
        ]);
      }
      if (url.includes('/audit-logs')) {
        return Promise.resolve({
          items: mockAuditLogs,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();
  });

  it('4. Member without audit_log:read permission is blocked (403 Forbidden banner)', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          {
            id: 'ws-test-audit',
            name: 'Test WS',
            role: 'MEMBER',
            permissions: ['call:read'],
          },
        ]);
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(
      screen.getByText(/You do not have permission to view audit logs/i),
    ).toBeDefined();
    expect(screen.queryByText('PERMISSION_ASSIGNED')).toBeNull();
  });

  it('5. Viewer is blocked from accessing audit logs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'VIEWER' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(
      screen.getByText(/Viewers do not have access to audit logs/i),
    ).toBeDefined();
  });

  it('6. Buyer participant is blocked from accessing audit logs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          {
            id: 'ws-test-audit',
            name: 'Buyer WS',
            role: 'MEMBER',
            participant_type: 'BUYER',
          },
        ]);
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(
      screen.getByText(/Participants do not have access to audit logs/i),
    ).toBeDefined();
  });

  it('7. Vendor participant is blocked from accessing audit logs', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          {
            id: 'ws-test-audit',
            name: 'Vendor WS',
            role: 'MEMBER',
            participant_type: 'VENDOR',
          },
        ]);
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(
      screen.getByText(/Participants do not have access to audit logs/i),
    ).toBeDefined();
  });

  it('8. Server API 403 error displays access forbidden banner', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        throw new Error('API error (403): Forbidden: Insufficient permission');
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
  });

  it('9. Prompt to select workspace when workspaceId is missing', () => {
    (useSearchParams as any).mockReturnValue({
      get: () => null,
    });

    render(<AuditLogsPage />);

    expect(screen.getByText('Select a Workspace')).toBeDefined();
  });

  it('10. Workspace scoping: calls backend with correct workspaceId', async () => {
    let requestedUrl = '';
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        requestedUrl = url;
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    await waitFor(() => {
      expect(requestedUrl).toContain('/workspaces/ws-test-audit/audit-logs');
    });
  });

  it('11. Empty state when no audit logs found', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('No audit logs found')).toBeDefined();
  });

  it('12. Error state and retry handling', async () => {
    let callCount = 0;
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        callCount++;
        if (callCount === 1) {
          throw new Error('Database connection failed');
        }
        return Promise.resolve({ items: mockAuditLogs, total: 3 });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('Database connection failed')).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();
  });

  it('13. Pagination: navigates next and previous pages', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        if (url.includes('offset=10')) {
          return Promise.resolve({ items: [mockAuditLogs[1]], total: 25 });
        }
        return Promise.resolve({ items: [mockAuditLogs[0]], total: 25 });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();
    expect(screen.getByText('Page 1 of 1')).toBeDefined(); // with limit 25 default

    // Change limit to 10
    const perPageSelect = screen.getByDisplayValue('25');
    fireEvent.change(perPageSelect, { target: { value: '10' } });

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeDefined();
    });

    // Next page button
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 2 of 3')).toBeDefined();
    });

    // Prev page button
    const prevBtn = screen.getByRole('button', { name: /previous/i });
    expect(prevBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeDefined();
    });
  });

  it('14. Safe rendering: sanitizes metadata and redacts sensitive keys and values', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        return Promise.resolve({
          items: [mockAuditLogs[0]],
          total: 1,
        });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();

    // Check summary tags: permissionKey is preserved
    expect(screen.getByText('permissionKey=call:read')).toBeDefined();

    // Open detail modal
    const viewButtons = screen.getAllByTitle('View Full Event Details');
    fireEvent.click(viewButtons[0]);

    // Modal opens
    expect(await screen.findByText('Audit Event Details')).toBeDefined();
    expect(
      screen.getByText(/Sensitive credentials, secret keys, passwords, and tokens are protected and redacted/i),
    ).toBeDefined();

    // Check that raw secret is NOT rendered
    expect(screen.queryByText('super-secret-12345')).toBeNull();
    expect(screen.queryByText('secretpassword')).toBeNull();

    // Close modal
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
  });

  it('15. Filtering by action and target triggers search', async () => {
    let capturedUrl = '';
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-audit', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/audit-logs')) {
        capturedUrl = url;
        return Promise.resolve({ items: mockAuditLogs, total: 3 });
      }
      return Promise.resolve({});
    });

    render(<AuditLogsPage />);

    await screen.findByText('PERMISSION_ASSIGNED');

    const actionInput = screen.getByPlaceholderText('e.g. PERMISSION_ASSIGNED');
    fireEvent.change(actionInput, { target: { value: 'MEMBER_REMOVED' } });

    const applyBtn = screen.getByRole('button', { name: /apply filters/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(capturedUrl).toContain('action=MEMBER_REMOVED');
    });
  });

  describe('Workspace Switching and Stale State Remediation', () => {
    it('16. Authorization still pending for workspace B displays loading state and does NOT render workspace A records', async () => {
      let currentWs = 'ws-A';
      (useSearchParams as any).mockImplementation(() => ({
        get: (key: string) => (key === 'workspace' ? currentWs : null),
      }));

      const wsALogs = [mockAuditLogs[0]]; // PERMISSION_ASSIGNED
      let resolveWsBAuth: (value: any) => void = () => {};

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          if (currentWs === 'ws-B') {
            return new Promise((resolve) => {
              resolveWsBAuth = resolve;
            });
          }
          return Promise.resolve([
            { id: 'ws-A', name: 'WS A', role: 'OWNER' },
            { id: 'ws-B', name: 'WS B', role: 'OWNER' },
          ]);
        }
        if (url.includes('/workspaces/ws-A/audit-logs')) {
          return Promise.resolve({ items: wsALogs, total: 1 });
        }
        return Promise.resolve({ items: [], total: 0 });
      });

      const { rerender } = render(<AuditLogsPage />);

      expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();

      // Switch to workspace B while auth is pending
      currentWs = 'ws-B';
      rerender(<AuditLogsPage />);

      // Must display loading state and must NOT show workspace A logs
      expect(screen.getByTestId('audit-logs-auth-loading')).toBeDefined();
      expect(screen.queryByText('PERMISSION_ASSIGNED')).toBeNull();

      // Resolve auth for B
      resolveWsBAuth([
        { id: 'ws-A', name: 'WS A', role: 'OWNER' },
        { id: 'ws-B', name: 'WS B', role: 'OWNER' },
      ]);
    });

    it('17. Workspace B request fails with a server error: clears stale records and total count', async () => {
      let currentWs = 'ws-A';
      (useSearchParams as any).mockImplementation(() => ({
        get: (key: string) => (key === 'workspace' ? currentWs : null),
      }));

      const wsALogs = [mockAuditLogs[0]];

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            { id: 'ws-A', name: 'WS A', role: 'OWNER' },
            { id: 'ws-B', name: 'WS B', role: 'OWNER' },
          ]);
        }
        if (url.includes('/workspaces/ws-A/audit-logs')) {
          return Promise.resolve({ items: wsALogs, total: 1 });
        }
        if (url.includes('/workspaces/ws-B/audit-logs')) {
          throw new Error('500 Internal Server Error');
        }
        return Promise.resolve({ items: [], total: 0 });
      });

      const { rerender } = render(<AuditLogsPage />);

      expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();

      // Switch to workspace B
      currentWs = 'ws-B';
      rerender(<AuditLogsPage />);

      // Shows error banner
      expect(await screen.findByText('500 Internal Server Error')).toBeDefined();

      // Stale records from ws-A must NOT be rendered
      expect(screen.queryByText('PERMISSION_ASSIGNED')).toBeNull();
      expect(screen.queryByText(/Showing 1 to 1/i)).toBeNull();
    });

    it('18. Workspace B is forbidden: displays forbidden state and does NOT show workspace A records', async () => {
      let currentWs = 'ws-A';
      (useSearchParams as any).mockImplementation(() => ({
        get: (key: string) => (key === 'workspace' ? currentWs : null),
      }));

      const wsALogs = [mockAuditLogs[0]];

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            { id: 'ws-A', name: 'WS A', role: 'OWNER' },
            { id: 'ws-B', name: 'WS B', role: 'VIEWER' },
          ]);
        }
        if (url.includes('/workspaces/ws-A/audit-logs')) {
          return Promise.resolve({ items: wsALogs, total: 1 });
        }
        return Promise.resolve({ items: [], total: 0 });
      });

      const { rerender } = render(<AuditLogsPage />);

      expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();

      // Switch to workspace B (VIEWER)
      currentWs = 'ws-B';
      rerender(<AuditLogsPage />);

      expect(await screen.findByText('Access Forbidden')).toBeDefined();
      expect(screen.getByText(/Viewers do not have access to audit logs/i)).toBeDefined();
      expect(screen.queryByText('PERMISSION_ASSIGNED')).toBeNull();
    });

    it('19. Successful loading of workspace B records renders only workspace B records', async () => {
      let currentWs = 'ws-A';
      (useSearchParams as any).mockImplementation(() => ({
        get: (key: string) => (key === 'workspace' ? currentWs : null),
      }));

      const wsALogs = [mockAuditLogs[0]]; // PERMISSION_ASSIGNED
      const wsBLogs = [mockAuditLogs[1]]; // INVITATION_CREATED

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            { id: 'ws-A', name: 'WS A', role: 'OWNER' },
            { id: 'ws-B', name: 'WS B', role: 'OWNER' },
          ]);
        }
        if (url.includes('/workspaces/ws-A/audit-logs')) {
          return Promise.resolve({ items: wsALogs, total: 1 });
        }
        if (url.includes('/workspaces/ws-B/audit-logs')) {
          return Promise.resolve({ items: wsBLogs, total: 1 });
        }
        return Promise.resolve({ items: [], total: 0 });
      });

      const { rerender } = render(<AuditLogsPage />);

      expect(await screen.findByText('PERMISSION_ASSIGNED')).toBeDefined();
      expect(screen.queryByText('INVITATION_CREATED')).toBeNull();

      // Switch to workspace B
      currentWs = 'ws-B';
      rerender(<AuditLogsPage />);

      expect(await screen.findByText('INVITATION_CREATED')).toBeDefined();
      expect(screen.queryByText('PERMISSION_ASSIGNED')).toBeNull();
    });

    it('20. Out-of-order race condition: late response from workspace A does NOT overwrite workspace B', async () => {
      let currentWs = 'ws-A';
      (useSearchParams as any).mockImplementation(() => ({
        get: (key: string) => (key === 'workspace' ? currentWs : null),
      }));

      let resolveWsA: (value: any) => void = () => {};
      const wsBLogs = [mockAuditLogs[1]]; // INVITATION_CREATED

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            { id: 'ws-A', name: 'WS A', role: 'OWNER' },
            { id: 'ws-B', name: 'WS B', role: 'OWNER' },
          ]);
        }
        if (url.includes('/workspaces/ws-A/audit-logs')) {
          return new Promise((resolve) => {
            resolveWsA = resolve;
          });
        }
        if (url.includes('/workspaces/ws-B/audit-logs')) {
          return Promise.resolve({ items: wsBLogs, total: 1 });
        }
        return Promise.resolve({ items: [], total: 0 });
      });

      const { rerender } = render(<AuditLogsPage />);

      // Switch to workspace B before workspace A returns
      currentWs = 'ws-B';
      rerender(<AuditLogsPage />);

      // Workspace B succeeds and shows INVITATION_CREATED
      expect(await screen.findByText('INVITATION_CREATED')).toBeDefined();

      // Workspace A belatedly resolves with PERMISSION_ASSIGNED
      resolveWsA({ items: [mockAuditLogs[0]], total: 1 });

      // Must remain workspace B logs, not overwritten by workspace A
      expect(screen.getByText('INVITATION_CREATED')).toBeDefined();
      expect(screen.queryByText('PERMISSION_ASSIGNED')).toBeNull();
    });
  });
});

describe('Audit Log Metadata Sanitization Unit Tests', () => {
  it('detects sensitive keys correctly while preserving permissionKey', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('secretToken')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('jwtToken')).toBe(true);
    expect(isSensitiveKey('stripeCustomerId')).toBe(true);
    expect(isSensitiveKey('permissionKey')).toBe(false);
    expect(isSensitiveKey('scopeType')).toBe(false);
    expect(isSensitiveKey('email')).toBe(false);
    expect(isSensitiveKey('targetId')).toBe(false);
  });

  it('detects sensitive string values (Bearer, JWT, API tokens)', () => {
    expect(isSensitiveValue('Bearer eyJhbGciOi...')).toBe(true);
    expect(isSensitiveValue('sk_live_1234567890abcdef')).toBe(true);
    expect(isSensitiveValue('pk_test_1234567890abcdef')).toBe(true);
    expect(isSensitiveValue('regular-string-value')).toBe(false);
    expect(isSensitiveValue('[REDACTED]')).toBe(false);
  });

  it('safely sanitizes nested metadata', () => {
    const raw = {
      permissionKey: 'call:read',
      scopeType: 'ALL',
      user: {
        email: 'user@example.com',
        passwordHash: 'hash123',
        authSecret: 'shhh',
      },
      items: ['safe-item', 'sk_live_abc'],
    };

    const sanitized = sanitizeMetadata(raw);
    expect(sanitized).toEqual({
      permissionKey: 'call:read',
      scopeType: 'ALL',
      user: {
        email: 'user@example.com',
        passwordHash: '[REDACTED]',
        authSecret: '[REDACTED]',
      },
      items: ['safe-item', '[REDACTED]'],
    });
  });
});
