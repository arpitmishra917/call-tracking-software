'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

interface WorkspaceValidatorProps {
  workspaces: { id: string }[];
  children: React.ReactNode;
}

export default function WorkspaceValidator({ workspaces, children }: WorkspaceValidatorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const urlWorkspaceId = searchParams.get('workspace');
  const hasValidWorkspace = workspaces.length > 0 && urlWorkspaceId 
    ? workspaces.some(w => w.id === urlWorkspaceId) 
    : false;
    
  const needsValidation = workspaces.length > 0 && !hasValidWorkspace;

  console.log('[WorkspaceValidator] DIAGNOSTICS:', {
    urlWorkspaceId,
    workspaceCount: workspaces.length,
    workspaces: workspaces.map(w => w.id),
    hasValidWorkspace,
    needsValidation,
    pathname,
  });

  useEffect(() => {
    if (needsValidation) {
      const validWorkspaceId = workspaces[0].id;
      const params = new URLSearchParams(searchParams.toString());
      params.set('workspace', validWorkspaceId);
      const targetUrl = `${pathname}?${params.toString()}`;
      console.log('[WorkspaceValidator] EXECUTING router.replace to:', targetUrl);
      // Replace the URL so we don't break history
      router.replace(targetUrl);
    }
  }, [searchParams, pathname, router, workspaces, needsValidation]);

  // Prevent rendering children until we have confirmed the URL has a valid workspace.
  // This prevents the page component from fetching data with an invalid ID and returning a 403.
  if (needsValidation) {
    console.log('[WorkspaceValidator] SUPPRESSING children');
    return null;
  }

  console.log('[WorkspaceValidator] RENDERING children');
  return <>{children}</>;
}
