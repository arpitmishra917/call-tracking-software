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
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session || !session.user) {
    return redirect('/login');
  }
  const user = session.user;
  console.log('[ProtectedLayout] DIAGNOSTICS - Frontend session user:', {
    id: user.id,
    email: user.email
  });

  // Fetch workspaces for this user from the API
  let workspaces: { id: string; name: string; role: string; participant_type?: string }[] = [];
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const res = await fetch(`${apiUrl}/workspaces`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store'
    });
    if (res.ok) {
      workspaces = await res.json();
      console.log('[ProtectedLayout] DIAGNOSTICS - API /workspaces response:', workspaces);
    } else {
      console.error('Failed to fetch workspaces', await res.text());
    }
  } catch (error) {
    console.error('Error fetching workspaces:', error);
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
