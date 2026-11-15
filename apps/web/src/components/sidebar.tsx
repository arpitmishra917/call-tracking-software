'use client';

import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { cn } from '@/utils/cn';
import {
  PhoneCall,
  BarChart,
  Megaphone,
  Users,
  Building2,
  Hash,
  ShieldBan,
  Key,
  Webhook,
  Activity,
  CreditCard,
  Settings,
  Users2,
  Scale,
  Receipt,
  BadgeDollarSign,
  FileCheck2,
  ScrollText
} from 'lucide-react';

export default function Sidebar({
  workspaces,
  onNavClick
}: {
  workspaces: { id: string; name: string; role: string; participant_type?: string; vendor_id?: string | null; buyer_id?: string | null; permissions?: string[] }[];
  onNavClick?: () => void;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  
  const urlWorkspaceId = searchParams.get('workspace');
  const isValidWorkspace = urlWorkspaceId ? workspaces.some(w => w.id === urlWorkspaceId) : false;
  const currentWorkspaceId = isValidWorkspace ? urlWorkspaceId : workspaces[0]?.id;
  
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0];
  const role = currentWorkspace?.role;

  const isOwnerOrAdmin = role === 'OWNER' || role === 'ADMIN';
  const isVendor = (currentWorkspace as any)?.participant_type === 'VENDOR';
  const isBuyer = (currentWorkspace as any)?.participant_type === 'BUYER';
  const isParticipant = isVendor || isBuyer;

  // Payments, Reconciliation & Audit Logs RBAC:
  // OWNER & ADMIN: visible (unless buyer/vendor participant)
  // MEMBER: only if explicitly authorized via permissions array
  // BUYER & VENDOR: strictly hidden
  // VIEWER: strictly hidden
  const permissions: string[] = (currentWorkspace as any)?.permissions || [];
  const canViewPayments = !isParticipant && role !== 'VIEWER' && (isOwnerOrAdmin || (role === 'MEMBER' && permissions.includes('payment:read')));
  const canViewReconciliation = !isParticipant && role !== 'VIEWER' && (isOwnerOrAdmin || (role === 'MEMBER' && permissions.includes('reconciliation:read')));
  const canViewAuditLogs = !isParticipant && role !== 'VIEWER' && (isOwnerOrAdmin || (role === 'MEMBER' && permissions.includes('audit_log:read')));
  const canViewVendors = !isParticipant && role !== 'VIEWER' && (isOwnerOrAdmin || (role === 'MEMBER' && permissions.includes('vendor:read')));

  const getUrl = (path: string) => {
    return `${path}${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`;
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface pb-4">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-border">
        <div className="flex items-center gap-2 text-xl font-bold text-primary tracking-tight">
          <PhoneCall className="h-6 w-6 text-info" />
          <span>CallFlow</span>
        </div>
      </div>
      
      <nav className="flex-1 px-4 py-6">
        <NavGroup title="Overview">
          <NavItem href="/protected/calls" icon={PhoneCall} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Calls</NavItem>
          <NavItem href="/protected/reporting" icon={BarChart} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Reporting</NavItem>
          {isVendor && (
            <NavItem href="/protected/phone-numbers" icon={Hash} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Tracking Numbers</NavItem>
          )}
          {role !== 'VIEWER' && !isVendor && (
            <NavItem href="/protected/disputes" icon={Scale} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Disputes</NavItem>
          )}
          {role !== 'VIEWER' && (
            <NavItem href="/protected/settlements" icon={Receipt} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Settlements</NavItem>
          )}
          {canViewPayments && (
            <NavItem href="/protected/payments" icon={BadgeDollarSign} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Payments</NavItem>
          )}
          {canViewReconciliation && (
            <NavItem href="/protected/reconciliation" icon={FileCheck2} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Reconciliation</NavItem>
          )}
        </NavGroup>

        {!isVendor && (
          <NavGroup title="Routing">
            <NavItem href="/protected/campaigns" icon={Megaphone} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Campaigns</NavItem>
            <NavItem href="/protected/buyers" icon={Users} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Buyers</NavItem>
            {canViewVendors && (
              <NavItem href="/protected/vendors" icon={Building2} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Vendors</NavItem>
            )}
            <NavItem href="/protected/phone-numbers" icon={Hash} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Phone Numbers</NavItem>
            {isOwnerOrAdmin && (
              <NavItem href="/protected/blocked-callers" icon={ShieldBan} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Blocked Callers</NavItem>
            )}
          </NavGroup>
        )}

        {isOwnerOrAdmin && (
          <>
            <NavGroup title="Developer">
              <NavItem href="/protected/api-keys" icon={Key} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>API Keys</NavItem>
              <NavItem href="/protected/webhooks" icon={Webhook} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Webhooks</NavItem>
            </NavGroup>

            <NavGroup title="Billing">
              <NavItem href="/protected/usage" icon={Activity} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Usage</NavItem>
              <NavItem href="/protected/billing" icon={CreditCard} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Billing</NavItem>
            </NavGroup>
          </>
        )}

        {(isOwnerOrAdmin || canViewAuditLogs) && (
          <NavGroup title="Workspace">
            {isOwnerOrAdmin && (
              <NavItem href="/protected/members" icon={Users2} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Members</NavItem>
            )}
            {canViewAuditLogs && (
              <NavItem href="/protected/audit-logs" icon={ScrollText} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Audit Logs</NavItem>
            )}
            {isOwnerOrAdmin && (
              <NavItem href="/protected/settings" icon={Settings} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>Settings</NavItem>
            )}
          </NavGroup>
        )}

        <NavGroup title="Personal">
          <NavItem href="/protected/account" icon={Users} pathname={pathname} getUrl={getUrl} onNavClick={onNavClick}>My Account</NavItem>
        </NavGroup>
      </nav>
    </div>
  );
}

const NavItem = ({ href, icon: Icon, children, pathname, getUrl, onNavClick }: { href: string, icon: React.ElementType, children: React.ReactNode, pathname: string, getUrl: (path: string) => string, onNavClick?: () => void }) => {
  const isActive = pathname === href || (href !== '/protected' && pathname.startsWith(href + '/'));
  return (
    <Link
      href={getUrl(href)}
      onClick={onNavClick}
      className={cn(
        "group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
        isActive 
          ? "bg-secondary text-primary" 
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
    >
      <Icon className={cn(
        "mr-3 flex-shrink-0 h-5 w-5 transition-colors",
        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
      )} />
      {children}
    </Link>
  );
};

const NavGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="mb-6">
    <h4 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h4>
    <div className="space-y-1">
      {children}
    </div>
  </div>
);
