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
    
    // Should see Administration header and Members link
    expect(screen.getByText('Administration')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('9. VIEWER does not see UI controls that imply unauthorized mutation capability', () => {
    const workspaces = [{ id: 'ws2', name: 'WS 2', role: 'VIEWER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should NOT see Administration
    expect(screen.queryByText('Administration')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('10. MEMBER does not see member-management controls', () => {
    const workspaces = [{ id: 'ws3', name: 'WS 3', role: 'MEMBER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should NOT see Administration
    expect(screen.queryByText('Administration')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });
});
