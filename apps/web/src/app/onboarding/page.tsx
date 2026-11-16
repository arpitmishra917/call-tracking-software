import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import OnboardingClient from './onboarding-client';

export default async function OnboardingPage() {
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

  if (!session || !session.user || !session.access_token) {
    return redirect('/login');
  }

  // Check if they already have workspaces
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  let hasWorkspace = false;
  try {
    const res = await fetch(`${apiUrl}/workspaces`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: 'no-store'
    });
    if (res.status === 401) {
      return redirect('/login?message=Session+expired.+Please+log+in+again.');
    }
    if (res.ok) {
      const workspaces = await res.json();
      if (workspaces.length > 0) {
        hasWorkspace = true;
      }
    }
  } catch (err) {
    console.error(err);
  }

  if (hasWorkspace) {
    return redirect('/protected');
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-3xl font-bold mb-2 text-gray-900">Welcome to CallFlow</h1>
        <p className="text-gray-600 mb-8">Let&apos;s create your first workspace to get started.</p>
        
        <OnboardingClient token={session.access_token} apiUrl={apiUrl} />
      </main>
    </div>
  );
}
