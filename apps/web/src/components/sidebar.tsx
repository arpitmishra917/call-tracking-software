'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function Sidebar({
  workspaces,
}: {
  workspaces: { id: string; name: string; role: string }[];
}) {
  const searchParams = useSearchParams();
  const currentWorkspaceId = searchParams.get('workspace') || workspaces[0]?.id;
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0];
  const role = currentWorkspace?.role;

  const isOwnerOrAdmin = role === 'OWNER' || role === 'ADMIN';

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-gray-200 font-bold text-xl text-blue-600">
        CallFlow
      </div>
      
      <nav className="flex-1 p-4 space-y-1">
        <Link href={`/protected${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`} className="block px-3 py-2 rounded-md bg-blue-50 text-blue-700 font-medium">
          Dashboard
        </Link>
        <Link href={`/protected/phone-numbers${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`} className="block px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100 font-medium">
          Phone Numbers
        </Link>
        <Link href={`/protected/campaigns${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`} className="block px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100 font-medium">
          Campaigns
        </Link>
        <Link href={`/protected/buyers${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`} className="block px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100 font-medium">
          Buyers
        </Link>
        <Link href={`/protected/calls${currentWorkspaceId ? `?workspace=${currentWorkspaceId}` : ''}`} className="block px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100 font-medium">
          Calls
        </Link>

        {/* Role-aware navigation */}
        {isOwnerOrAdmin && (
          <div className="mt-8 pt-4 border-t border-gray-100">
            <h4 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Administration
            </h4>
            <div className="block px-3 py-2 rounded-md text-gray-400 font-medium cursor-not-allowed" title="Coming soon">
              Members (Soon)
            </div>
            <div className="block px-3 py-2 rounded-md text-gray-400 font-medium cursor-not-allowed" title="Coming soon">
              Settings (Soon)
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}
