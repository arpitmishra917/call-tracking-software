import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sidebar from './sidebar';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/protected',
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>,
}));

describe('Sidebar Role-Aware Navigation', () => {
  it('11. ADMIN/OWNER appropriate management navigation is available where applicable', () => {
    const workspaces = [{ id: 'ws1', name: 'WS 1', role: 'OWNER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should see Workspace header and Members link
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('9. VIEWER does not see UI controls that imply unauthorized mutation capability', () => {
    const workspaces = [{ id: 'ws2', name: 'WS 2', role: 'VIEWER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should NOT see Workspace header
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('10. MEMBER does not see member-management controls', () => {
    const workspaces = [{ id: 'ws3', name: 'WS 3', role: 'MEMBER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should NOT see Workspace header
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('VENDOR member sees Calls, Reporting, Settlements, but NOT Disputes or Routing', () => {
    const workspaces = [{ id: 'ws-vendor', name: 'Vendor Workspace', role: 'MEMBER', participant_type: 'VENDOR' }];
    render(<Sidebar workspaces={workspaces} />);

    // Vendor sees Calls, Reporting, Settlements
    expect(screen.getByText('Calls')).toBeTruthy();
    expect(screen.getByText('Reporting')).toBeTruthy();
    expect(screen.getByText('Settlements')).toBeTruthy();

    // Vendor does NOT see Disputes
    expect(screen.queryByText('Disputes')).toBeNull();

    // Vendor does NOT see Routing group (Campaigns, Buyers, Phone Numbers)
    expect(screen.queryByText('Routing')).toBeNull();
    expect(screen.queryByText('Campaigns')).toBeNull();
    expect(screen.queryByText('Buyers')).toBeNull();
    expect(screen.queryByText('Phone Numbers')).toBeNull();

    // Vendor does NOT see Workspace management
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });
});

