import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WorkspaceSelector from './workspace-selector';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

describe('WorkspaceSelector Component Suite', () => {
  const mockPush = vi.fn();
  const mockWorkspaces = [
    { id: 'ws-1', name: 'Alpha Ops', role: 'OWNER' },
    { id: 'ws-2', name: 'Beta Telecom', role: 'MEMBER', participant_type: 'VENDOR' },
    { id: 'ws-3', name: 'Gamma Leads', role: 'MEMBER', participant_type: 'BUYER' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as any);
    vi.mocked(usePathname).mockReturnValue('/protected/reporting');
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('workspace=ws-1') as any);
  });

  it('renders all accessible workspaces with appropriate participant role badges', () => {
    render(<WorkspaceSelector workspaces={mockWorkspaces} />);

    const select = screen.getByRole('combobox', { name: /select workspace/i }) as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.value).toBe('ws-1');

    const options = Array.from(select.options);
    expect(options).toHaveLength(3);
    expect(options[0].text).toContain('Alpha Ops (OWNER)');
    expect(options[1].text).toContain('Beta Telecom (VENDOR)');
    expect(options[2].text).toContain('Gamma Leads (BUYER)');
  });

  it('updates session storage and navigates on workspace change', () => {
    render(<WorkspaceSelector workspaces={mockWorkspaces} />);

    const select = screen.getByRole('combobox', { name: /select workspace/i });
    fireEvent.change(select, { target: { value: 'ws-2' } });

    expect(sessionStorage.getItem('callflow.active_workspace_id')).toBe('ws-2');
    expect(mockPush).toHaveBeenCalledWith('/protected/reporting?workspace=ws-2');
  });

  it('navigates from entity detail route to section root on workspace switch', () => {
    vi.mocked(usePathname).mockReturnValue('/protected/buyers/buyer-123');
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('workspace=ws-1') as any);

    render(<WorkspaceSelector workspaces={mockWorkspaces} />);

    const select = screen.getByRole('combobox', { name: /select workspace/i });
    fireEvent.change(select, { target: { value: 'ws-2' } });

    expect(mockPush).toHaveBeenCalledWith('/protected/buyers?workspace=ws-2');
  });

  it('strips workspace-specific entity filters while preserving date filters on switch', () => {
    vi.mocked(usePathname).mockReturnValue('/protected/reporting');
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(
        'workspace=ws-1&campaignId=camp-99&buyerId=buyer-88&vendorId=vend-77&trackingNumber=%2B1555&startDate=2026-01-01&endDate=2026-01-31'
      ) as any
    );

    render(<WorkspaceSelector workspaces={mockWorkspaces} />);

    const select = screen.getByRole('combobox', { name: /select workspace/i });
    fireEvent.change(select, { target: { value: 'ws-2' } });

    expect(mockPush).toHaveBeenCalledWith(
      '/protected/reporting?workspace=ws-2&startDate=2026-01-01&endDate=2026-01-31'
    );
  });

  it('renders fallback when user has no workspaces', () => {
    render(<WorkspaceSelector workspaces={[]} />);
    expect(screen.getByText('No workspaces')).toBeDefined();
  });
});
