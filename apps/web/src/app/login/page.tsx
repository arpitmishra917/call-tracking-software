import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import LoginForm from './login-form'

export default async function LoginPage(
  props: { searchParams: Promise<{ token?: string, message?: string }> }
) {
  const searchParams = await props.searchParams;
  const token = searchParams.token;
  const message = searchParams.message;

  const supabase = await createClient();
  const authUserResult = typeof supabase?.auth?.getUser === 'function' ? await supabase.auth.getUser() : null;
  const user = authUserResult?.data?.user;

  // Only redirect authenticated users if there is NO error or session message present.
  // If a message is present (e.g., "Session expired. Please log in again."), the user
  // arrived here due to an authentication failure and must see the login form.
  if (user && !message) {
    if (token) {
      redirect(`/protected/accept-invitation?token=${token}`);
    } else {
      redirect('/protected');
    }
  }

  let invitationDetails: { workspace_name: string; email: string } | null = null;

  if (token) {
    try {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const res = await fetch(`${apiUrl}/invitations/verify/${token}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'PENDING') {
          invitationDetails = data;
        }
      }
    } catch (e) {
      console.error('Failed to verify token', e);
    }
  }

  const login = async (formData: FormData) => {
    'use server'
    console.log('[AUTH] Login attempt started');
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const inviteToken = formData.get('inviteToken') as string
    const supabase = await createClient()

    let error: any = null
    let authData: any = null
    try {
      const res = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      error = res.error
      authData = res.data
    } catch (err: any) {
      error = err
    }

    if (error || !authData?.user) {
      const reason = error?.message || 'Missing user profile in authentication response';
      console.log(`[AUTH] Supabase authentication failed: ${reason}`);
      const isNetworkError =
        error?.name === 'AuthRetryableFetchError' ||
        error?.message?.includes('fetch failed') ||
        error?.status === 0
      const message = isNetworkError
        ? 'Authentication service is unreachable. Please check network connectivity or provider status.'
        : error?.message || 'Invalid login credentials.'

      return redirect(`/login?message=${encodeURIComponent(message)}${inviteToken ? `&token=${inviteToken}` : ''}`)
    }

    console.log('[AUTH] Supabase authentication successful');
    console.log('[AUTH] Session cookie update attempted');

    if (inviteToken) {
      return redirect(`/protected/accept-invitation?token=${inviteToken}`);
    }

    return redirect('/protected')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Log In</CardTitle>
          {invitationDetails ? (
            <CardDescription className="text-center text-green-600 font-medium">
              Log in to accept your invitation to <strong>{invitationDetails.workspace_name}</strong>
            </CardDescription>
          ) : (
            <CardDescription className="text-center">Welcome back</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <LoginForm
            loginAction={login}
            token={token}
            invitationDetails={invitationDetails}
            initialMessage={message}
          />
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-gray-600">
            Don&apos;t have an account?{' '}
            <Link href={`/signup${token ? `?token=${token}` : ''}`} className="text-blue-600 hover:underline">
              Sign Up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
