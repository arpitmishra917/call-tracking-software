'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ShieldAlert, Building2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WorkspaceValidatorProps {
  workspaces: {
    id: string;
    name: string;
    role?: string;
    participant_type?: string;
  }[];
  children: React.ReactNode;
}

export default function WorkspaceValidator({ workspaces, children }: WorkspaceValidatorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const urlWorkspaceId = searchParams.get('workspace');
  const hasValidWorkspace = workspaces.length > 0 && !!urlWorkspaceId && workspaces.some(w => w.id === urlWorkspaceId);
  const isUnauthorizedWorkspace = !!urlWorkspaceId && !hasValidWorkspace;

  // Session-isolated active workspace memory
  useEffect(() => {
    if (hasValidWorkspace && urlWorkspaceId && typeof window !== 'undefined') {
      sessionStorage.setItem('callflow.active_workspace_id', urlWorkspaceId);
    }
  }, [hasValidWorkspace, urlWorkspaceId]);

  // Handle missing workspace in URL
  useEffect(() => {
    if (!urlWorkspaceId && workspaces.length > 0) {
      const sessionWsId = typeof window !== 'undefined' ? sessionStorage.getItem('callflow.active_workspace_id') : null;
      const targetWs = sessionWsId && workspaces.some(w => w.id === sessionWsId)
        ? sessionWsId
        : (workspaces.length === 1 ? workspaces[0].id : null);

      if (targetWs) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('workspace', targetWs);
        router.replace(`${pathname}?${params.toString()}`);
      }
    }
  }, [urlWorkspaceId, workspaces, pathname, router, searchParams]);

  // 1. Explicitly requested an unauthorized or non-existent workspace ID
  if (isUnauthorizedWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
        <div className="rounded-full bg-destructive/10 p-4 text-destructive mb-4">
          <ShieldAlert className="h-10 w-10" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Workspace Access Denied</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          You do not have access to the requested workspace or it does not exist.
        </p>
        {workspaces.length > 0 && (
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {workspaces.map((ws) => (
              <Button
                key={ws.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('callflow.active_workspace_id', ws.id);
                  }
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('workspace', ws.id);
                  router.replace(`${pathname}?${params.toString()}`);
                }}
              >
                <Building2 className="w-4 h-4 mr-2" />
                Go to {ws.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 2. No workspace in URL and multiple workspaces available with none remembered in session
  if (!urlWorkspaceId && workspaces.length > 1) {
    const sessionWsId = typeof window !== 'undefined' ? sessionStorage.getItem('callflow.active_workspace_id') : null;
    if (!sessionWsId || !workspaces.some(w => w.id === sessionWsId)) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
          <div className="rounded-full bg-primary/10 p-4 text-primary mb-4">
            <Building2 className="h-10 w-10" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Select an Active Workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            Please select which workspace context you would like to view for this session.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {workspaces.map((ws) => (
              <Button
                key={ws.id}
                size="sm"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('callflow.active_workspace_id', ws.id);
                  }
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('workspace', ws.id);
                  router.replace(`${pathname}?${params.toString()}`);
                }}
              >
                {ws.name} ({ws.participant_type || ws.role || 'MEMBER'})
              </Button>
            ))}
          </div>
        </div>
      );
    }
  }

  // 3. No accessible workspaces at all
  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold tracking-tight text-foreground">No Workspaces Found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You are not currently a member of any active workspaces.
        </p>
      </div>
    );
  }

  // 4. While resolving missing workspace
  if (!hasValidWorkspace) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] p-8 text-sm text-muted-foreground">
        Loading workspace context...
      </div>
    );
  }

  return <>{children}</>;
}
