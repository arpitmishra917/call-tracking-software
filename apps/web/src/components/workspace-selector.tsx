'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

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
    return <div className="text-sm text-gray-500">No workspaces</div>;
  }

  return (
    <div className="flex items-center space-x-2">
      <label htmlFor="workspace-select" className="text-sm font-medium text-gray-700">
        Workspace:
      </label>
      <select
        id="workspace-select"
        value={currentWorkspaceId || ''}
        onChange={handleWorkspaceChange}
        className="block w-48 rounded-md border-gray-300 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500 bg-white shadow-sm"
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
    </div>
  );
}
