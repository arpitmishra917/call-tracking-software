import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MemberPermissionsPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams, useParams, useRouter } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

describe('Member Granular Permissions Suite', () => {
  const mockMember = {
    id: 'mem-1',
    user_id: 'user-1',
    role: 'MEMBER',
    participant_type: 'INTERNAL',
    profile: { display_name: 'John Teammate' },
  };

  const mockAllPermissions = [
    { key: 'campaign:read', name: 'View Campaigns', group: 'Campaigns', description: 'Can view campaigns' },
  ];

  const mockMemberPermissions = [
    {
      id: 'mp-1',
      key: 'campaign:read',
      permission_key: 'campaign:read',
      group: 'Campaigns',
      name: 'View Campaigns',
      description: 'Can view campaigns',
      scope_type: 'ALL',
      resource_id: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useParams).mockReturnValue({ memberId: 'mem-1' });
    vi.mocked(useSearchParams).mockReturnValue({
      get: (param: string) => (param === 'workspace' ? 'ws-test-members' : null),
    } as any);
    vi.mocked(useRouter).mockReturnValue({ back: vi.fn() } as any);
  });

  it('loads member and displays assigned permissions', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('/members/mem-1/buyers')) return [];
      if (url.includes('/permissions/members/')) return mockMemberPermissions;
      if (url.includes('/permissions')) return mockAllPermissions;
      if (url.includes('/members')) return [mockMember];
      return [];
    });

    render(<MemberPermissionsPage />);

    expect(await screen.findByText(/John Teammate/i)).toBeDefined();
    expect(screen.getByText('campaign:read')).toBeDefined();
    expect(screen.getByText('ALL')).toBeDefined();
  });

  it('renders 403 Forbidden banner when user lacks permission to view', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('API error (403): Forbidden'));

    render(<MemberPermissionsPage />);

    expect(
      await screen.findByText(/You do not have permission to view or manage permissions/i)
    ).toBeDefined();
  });
});
