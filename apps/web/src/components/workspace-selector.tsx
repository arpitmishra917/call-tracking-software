'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export default function WorkspaceSelector({
  workspaces,
}: {
  workspaces: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const currentWorkspaceId = searchParams.get('workspace') || workspaces[0]?.id || null;

  const handleWorkspaceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set('workspace', newId);
    router.push(`${pathname}?${params.toString()}`);
  };

  if (workspaces.length === 0) {
    return <div className="text-sm text-muted-foreground">No workspaces</div>;
  }

  return (
    <div className="flex items-center gap-2 relative">
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
        <Building2 className="h-4 w-4" />
      </div>
      <select
        id="workspace-select"
        aria-label="Select workspace"
        value={currentWorkspaceId || ''}
        onChange={handleWorkspaceChange}
        className={cn(
          "h-9 w-48 appearance-none rounded-md border border-border bg-surface pl-9 pr-8 text-sm font-medium shadow-sm transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-border-focus",
          "hover:bg-secondary cursor-pointer"
        )}
      >
        {!currentWorkspaceId && (
          <option value="" disabled>
            Select workspace...
          </option>
        )}
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name} ({ws.role})
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    </div>
  );
}
