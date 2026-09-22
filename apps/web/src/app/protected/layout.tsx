import React, { ReactNode } from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import WorkspaceSelector from '@/components/workspace-selector';
import Sidebar from '@/components/sidebar';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session || !session.user) {
    return redirect('/login');
  }
  const user = session.user;

  // Fetch workspaces for this user from the API
  let workspaces: { id: string; name: string; role: string }[] = [];
  try {
    const res = await fetch('http://localhost:3001/workspaces', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store'
    });
    if (res.ok) {
      workspaces = await res.json();
    } else {
      console.error('Failed to fetch workspaces', await res.text());
    }
  } catch (error) {
    console.error('Error fetching workspaces:', error);
  }

  
  return (
    <div className="flex h-screen bg-gray-50">
      <React.Suspense fallback={<div className="w-64 bg-white border-r border-gray-200" />}>
        <Sidebar workspaces={workspaces} />
      </React.Suspense>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
          <div className="flex items-center space-x-6">
            <h2 className="text-xl font-semibold text-gray-800">Workspace Dashboard</h2>
            <React.Suspense fallback={<div className="w-48 h-8 bg-gray-100 rounded animate-pulse" />}>
              <WorkspaceSelector workspaces={workspaces} />
            </React.Suspense>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              {user.email}
            </div>
            <form action={async () => {
              'use server';
              const sb = await createClient();
              await sb.auth.signOut();
              redirect('/login');
            }}>
              <button className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 transition-colors">
                Sign Out
              </button>
            </form>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-gray-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
