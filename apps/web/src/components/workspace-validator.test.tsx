import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WorkspaceValidator from './workspace-validator';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

describe('WorkspaceValidator Context & Access Guard Suite', () => {
  const mockReplace = vi.fn();
  const mockWorkspaces = [
    { id: 'ws-valid-1', name: 'Valid Workspace 1', role: 'OWNER' },
    { id: 'ws-valid-2', name: 'Valid Workspace 2', role: 'MEMBER' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as any);
    vi.mocked(usePathname).mockReturnValue('/protected/reporting');
  });

  it('renders children when valid workspace is active in URL', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('workspace=ws-valid-1') as any);

    render(
      <WorkspaceValidator workspaces={mockWorkspaces}>
        <div data-testid="protected-content">Dashboard Active</div>
      </WorkspaceValidator>
    );

    expect(screen.getByTestId('protected-content')).toBeDefined();
    expect(sessionStorage.getItem('callflow.active_workspace_id')).toBe('ws-valid-1');
  });

  it('renders access denied banner when accessing unauthorized workspace ID', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('workspace=ws-forbidden-99') as any);

    render(
      <WorkspaceValidator workspaces={mockWorkspaces}>
        <div data-testid="protected-content">Should Not Render</div>
      </WorkspaceValidator>
    );

    expect(screen.queryByTestId('protected-content')).toBeNull();
    expect(screen.getByText('Workspace Access Denied')).toBeDefined();
    expect(screen.getByRole('button', { name: /Go to Valid Workspace 1/i })).toBeDefined();
  });

  it('automatically injects single workspace if user belongs to only 1 workspace and none in URL', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('') as any);

    render(
      <WorkspaceValidator workspaces={[mockWorkspaces[0]]}>
        <div>Child</div>
      </WorkspaceValidator>
    );

    expect(mockReplace).toHaveBeenCalledWith('/protected/reporting?workspace=ws-valid-1');
  });

  it('prompts user to select active workspace if multiple workspaces exist and none in URL or session', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('') as any);

    render(
      <WorkspaceValidator workspaces={mockWorkspaces}>
        <div data-testid="protected-content">Dashboard Content</div>
      </WorkspaceValidator>
    );

    expect(screen.queryByTestId('protected-content')).toBeNull();
    expect(screen.getByText('Select an Active Workspace')).toBeDefined();

    const selectBtn = screen.getByRole('button', { name: /Valid Workspace 1 \(OWNER\)/i });
    fireEvent.click(selectBtn);

    expect(sessionStorage.getItem('callflow.active_workspace_id')).toBe('ws-valid-1');
    expect(mockReplace).toHaveBeenCalledWith('/protected/reporting?workspace=ws-valid-1');
  });

  it('shows No Workspaces Found when user belongs to 0 workspaces', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('') as any);

    render(
      <WorkspaceValidator workspaces={[]}>
        <div>Child</div>
      </WorkspaceValidator>
    );

    expect(screen.getByText('No Workspaces Found')).toBeDefined();
  });
});
