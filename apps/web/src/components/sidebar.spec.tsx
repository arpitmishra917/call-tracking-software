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
    // OWNER should see Payments and Reconciliation
    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Reconciliation')).toBeTruthy();
    expect(screen.getByText('Audit Logs')).toBeTruthy();
    // OWNER should see Vendors under Routing
    expect(screen.getByText('Vendors')).toBeTruthy();
  });

  it('ADMIN sees Payments, Reconciliation, Audit Logs, and Vendors', () => {
    const workspaces = [{ id: 'ws1', name: 'WS 1', role: 'ADMIN' }];
    render(<Sidebar workspaces={workspaces} />);
    
    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Reconciliation')).toBeTruthy();
    expect(screen.getByText('Audit Logs')).toBeTruthy();
    expect(screen.getByText('Vendors')).toBeTruthy();
  });

  it('9. VIEWER does not see UI controls that imply unauthorized mutation capability', () => {
    const workspaces = [{ id: 'ws2', name: 'WS 2', role: 'VIEWER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should NOT see Workspace header
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
    // VIEWER should NOT see Payments or Reconciliation or Audit Logs
    expect(screen.queryByText('Payments')).toBeNull();
    expect(screen.queryByText('Reconciliation')).toBeNull();
    expect(screen.queryByText('Audit Logs')).toBeNull();
    // VIEWER should NOT see Vendors
    expect(screen.queryByText('Vendors')).toBeNull();
  });

  it('10. MEMBER does not see member-management controls or unassigned payment/reconciliation/audit logs/vendors', () => {
    const workspaces = [{ id: 'ws3', name: 'WS 3', role: 'MEMBER' }];
    render(<Sidebar workspaces={workspaces} />);
    
    // Should NOT see Workspace header
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
    // Default MEMBER without permissions should NOT see Payments or Reconciliation or Audit Logs or Vendors
    expect(screen.queryByText('Payments')).toBeNull();
    expect(screen.queryByText('Reconciliation')).toBeNull();
    expect(screen.queryByText('Audit Logs')).toBeNull();
    expect(screen.queryByText('Vendors')).toBeNull();
  });

  it('MEMBER with explicit permissions sees Payments and Reconciliation', () => {
    const workspaces = [{
      id: 'ws3',
      name: 'WS 3',
      role: 'MEMBER',
      permissions: ['payment:read', 'reconciliation:read']
    }];
    render(<Sidebar workspaces={workspaces} />);
    
    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Reconciliation')).toBeTruthy();
    expect(screen.queryByText('Audit Logs')).toBeNull();
    expect(screen.queryByText('Vendors')).toBeNull();
  });

  it('MEMBER with vendor:read sees Vendors under Routing', () => {
    const workspaces = [{
      id: 'ws-vendor-perm',
      name: 'WS Vendor Perm',
      role: 'MEMBER',
      permissions: ['vendor:read']
    }];
    render(<Sidebar workspaces={workspaces} />);

    expect(screen.getByText('Routing')).toBeTruthy();
    expect(screen.getByText('Vendors')).toBeTruthy();
    expect(screen.queryByText('Payments')).toBeNull();
  });

  it('MEMBER with audit_log:read sees Workspace header and Audit Logs', () => {
    const workspaces = [{
      id: 'ws4',
      name: 'WS 4',
      role: 'MEMBER',
      permissions: ['audit_log:read']
    }];
    render(<Sidebar workspaces={workspaces} />);
    
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Audit Logs')).toBeTruthy();
    expect(screen.queryByText('Members')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('VENDOR member sees Calls, Reporting, Settlements, but NOT Disputes, Routing, Payments or Reconciliation', () => {
    const workspaces = [{ id: 'ws-vendor', name: 'Vendor Workspace', role: 'MEMBER', participant_type: 'VENDOR' }];
    render(<Sidebar workspaces={workspaces} />);

    // Vendor sees Calls, Reporting, Settlements, Tracking Numbers
    expect(screen.getByText('Calls')).toBeTruthy();
    expect(screen.getByText('Reporting')).toBeTruthy();
    expect(screen.getByText('Settlements')).toBeTruthy();
    expect(screen.getByText('Tracking Numbers')).toBeTruthy();

    // Vendor does NOT see Disputes
    expect(screen.queryByText('Disputes')).toBeNull();

    // Vendor does NOT see Routing group (Campaigns, Buyers, Vendors, Phone Numbers)
    expect(screen.queryByText('Routing')).toBeNull();
    expect(screen.queryByText('Campaigns')).toBeNull();
    expect(screen.queryByText('Buyers')).toBeNull();
    expect(screen.queryByText('Vendors')).toBeNull();
    expect(screen.queryByText('Phone Numbers')).toBeNull();

    // Vendor does NOT see Workspace management
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();

    // Vendor does NOT see Payments or Reconciliation or Audit Logs
    expect(screen.queryByText('Payments')).toBeNull();
    expect(screen.queryByText('Reconciliation')).toBeNull();
    expect(screen.queryByText('Audit Logs')).toBeNull();
  });

  it('BUYER member does NOT see Payments, Reconciliation, Audit Logs, or Vendors', () => {
    const workspaces = [{ id: 'ws-buyer', name: 'Buyer Workspace', role: 'MEMBER', participant_type: 'BUYER' }];
    render(<Sidebar workspaces={workspaces} />);

    expect(screen.queryByText('Payments')).toBeNull();
    expect(screen.queryByText('Reconciliation')).toBeNull();
    expect(screen.queryByText('Audit Logs')).toBeNull();
    expect(screen.queryByText('Vendors')).toBeNull();
  });
});
