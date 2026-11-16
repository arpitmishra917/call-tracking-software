import React, { ReactNode } from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import Shell from '@/components/shell';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  console.log('[AUTH] Protected route entered');
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return redirect('/login');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  let accessToken = session?.access_token;
  if (!accessToken) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session?.access_token) {
      console.log('[AUTH] Supabase authentication failed: Session expired or refresh token invalid');
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore signOut errors in server components
      }
      return redirect('/login?message=Session+expired.+Please+log+in+again.');
    }
    accessToken = refreshData.session.access_token;
  }

  if (!accessToken) {
    return redirect('/login');
  }

  // Fetch workspaces for this user from the API
  let workspaces: { id: string; name: string; role: string; participant_type?: string; vendor_id?: string | null; buyer_id?: string | null }[] = [];
  let fetchError: string | null = null;
  let isWorkspaceAuthFailure = false;

  try {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
    let res = await fetch(`${apiUrl}/workspaces`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    console.log(`[AUTH] Workspace API returned HTTP status: ${res.status}`);

    if (res.status === 401) {
      // Access token may have expired. Attempt refresh once and retry request.
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session?.access_token) {
        // Refresh token itself is dead/revoked - this is a true session expiration
        console.log('[AUTH] Supabase authentication failed: Refresh token revoked during workspace retry');
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore
        }
        return redirect('/login?message=Session+expired.+Please+log+in+again.');
      }

      accessToken = refreshData.session.access_token;
      res = await fetch(`${apiUrl}/workspaces`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      });
      console.log(`[AUTH] Workspace API retry returned HTTP status: ${res.status}`);
    }

    if (res.status === 401) {
      // Supabase session is valid, but backend workspace API rejected the token.
      // Do NOT call signOut(); preserve valid session and render explicit workspace error.
      console.log('[AUTH] Workspace authentication failed: Backend API rejected authentication token (HTTP 401)');
      isWorkspaceAuthFailure = true;
      fetchError = 'Workspace authentication failed: Backend API rejected authentication token (HTTP 401). Your session is active, but access to workspaces was refused.';
    } else if (res.status === 403) {
      fetchError = 'Forbidden: You do not have permission to access workspaces.';
    } else if (!res.ok) {
      fetchError = `Failed to load workspaces (HTTP ${res.status}).`;
    } else {
      workspaces = await res.json();
    }
  } catch {
    fetchError = 'Network error: Failed to connect to workspace service.';
  }

  if (isWorkspaceAuthFailure || fetchError) {
    const handleSignOut = async () => {
      'use server';
      const client = await createClient();
      await client.auth.signOut();
      redirect('/login');
    };

    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50">
        <div className="max-w-md w-full rounded-lg border border-red-200 bg-white shadow-sm p-6 text-center">
          <h2 className="text-xl font-bold mb-2 text-red-600">
            {isWorkspaceAuthFailure ? 'Workspace Authentication Failed' : 'Workspace Error'}
          </h2>
          <p className="text-sm text-gray-700 mb-6">{fetchError}</p>
          <div className="flex flex-col gap-3">
            <a
              href="/protected"
              className="w-full inline-block px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 text-center transition-colors"
            >
              Retry
            </a>
            <form action={handleSignOut}>
              <button
                type="submit"
                className="w-full px-4 py-2 border border-gray-300 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return redirect('/onboarding');
  }

  return (
    <Shell workspaces={workspaces} user={{ email: user.email }}>
      {children}
    </Shell>
  );
}
