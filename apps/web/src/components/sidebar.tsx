'use client';

import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { cn } from '@/utils/cn';
import {
  LayoutDashboard,
  PhoneCall,
  BarChart,
  Megaphone,
  Users,
  Hash,
  ShieldBan,
  Key,
  Webhook,
  Activity,
  CreditCard,
  Settings,
  Users2
} from 'lucide-react';

export default function Sidebar({
  workspaces,
  onNavClick
}: {
  workspaces: { id: string; name: string; role: string }[];
  onNavClick?: () => void;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const currentWorkspaceId = searchParams.get('workspace') || workspaces[0]?.id;
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0];
  const role = currentWorkspace?.role;

  const isOwnerOrAdmin = role === 'OWNER' || role === 'ADMIN';

  const getUrl = (path: string) => {
    return `${path}${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`;
  };

  const NavItem = ({ href, icon: Icon, children }: { href: string, icon: any, children: React.ReactNode }) => {
    const isActive = pathname === href;
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
          <NavItem href="/protected" icon={LayoutDashboard}>Dashboard</NavItem>
          <NavItem href="/protected/calls" icon={PhoneCall}>Calls</NavItem>
          <NavItem href="/protected/reporting" icon={BarChart}>Reporting</NavItem>
        </NavGroup>

        <NavGroup title="Routing">
          <NavItem href="/protected/campaigns" icon={Megaphone}>Campaigns</NavItem>
          <NavItem href="/protected/buyers" icon={Users}>Buyers</NavItem>
          <NavItem href="/protected/phone-numbers" icon={Hash}>Phone Numbers</NavItem>
          {isOwnerOrAdmin && (
            <NavItem href="/protected/blocked-callers" icon={ShieldBan}>Blocked Callers</NavItem>
          )}
        </NavGroup>

        {isOwnerOrAdmin && (
          <>
            <NavGroup title="Developer">
              <NavItem href="/protected/api-keys" icon={Key}>API Keys</NavItem>
              <NavItem href="/protected/webhooks" icon={Webhook}>Webhooks</NavItem>
            </NavGroup>

            <NavGroup title="Billing">
              <NavItem href="/protected/usage" icon={Activity}>Usage</NavItem>
              <NavItem href="/protected/billing" icon={CreditCard}>Billing</NavItem>
            </NavGroup>

            <NavGroup title="Workspace">
              <NavItem href="/protected/members" icon={Users2}>Members</NavItem>
              <NavItem href="/protected/settings" icon={Settings}>Settings</NavItem>
            </NavGroup>
          </>
        )}
      </nav>
    </div>
  );
}
