import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function SignupPage(
  props: { searchParams: Promise<{ token?: string, message?: string }> }
) {
  const searchParams = await props.searchParams;
  const token = searchParams.token;
  const message = searchParams.message;

  const supabase = await createClient();
  const authUserResult = typeof supabase?.auth?.getUser === 'function' ? await supabase.auth.getUser() : null;
  const user = authUserResult?.data?.user;

  // Only redirect authenticated users if there is NO error or session message present.
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
      // NOTE: server component fetching to public API
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
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

  const signup = async (formData: FormData) => {
    'use server'
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string
    const fullName = formData.get('fullName') as string
    const inviteToken = formData.get('inviteToken') as string

    if (password !== confirmPassword) {
      return redirect(`/signup?message=Passwords do not match${inviteToken ? `&token=${inviteToken}` : ''}`)
    }

    const supabase = await createClient()

    let redirectUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback`
    if (inviteToken) {
      redirectUrl += `?next=${encodeURIComponent('/protected/accept-invitation?token=' + inviteToken)}` 
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo: redirectUrl,
      },
    })

    if (error) {
      return redirect(`/signup?message=${encodeURIComponent(error.message)}${inviteToken ? `&token=${inviteToken}` : ''}`)
    }

    if (data.user && !data.session) {
      return redirect(`/login?message=Check email to continue sign in process${inviteToken ? `&token=${inviteToken}` : ''}`)
    }

    if (inviteToken) {
      return redirect(`/protected/accept-invitation?token=${inviteToken}`)
    }
    
    return redirect('/protected')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Sign Up</CardTitle>
          {invitationDetails ? (
            <CardDescription className="text-center text-green-600 font-medium">
              You have been invited to join <strong>{invitationDetails.workspace_name}</strong>
            </CardDescription>
          ) : (
            <CardDescription className="text-center">Create a new account</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" action={signup}>
            {token && <input type="hidden" name="inviteToken" value={token} />}
            
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" name="fullName" placeholder="John Doe" required />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                name="email" 
                type="email" 
                placeholder="you@example.com" 
                required 
                defaultValue={invitationDetails?.email || ''}
                readOnly={!!invitationDetails}
                className={invitationDetails ? 'bg-gray-100' : ''}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" name="password" placeholder="••••••••" required />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input id="confirmPassword" type="password" name="confirmPassword" placeholder="••••••••" required />
            </div>

            {searchParams.message && (
              <p className="text-red-500 text-sm mt-2 text-center">{searchParams.message}</p>
            )}

            <Button type="submit" className="w-full mt-2">Sign Up</Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-gray-600">
            Already have an account?{' '}
            <Link href={`/login${token ? `?token=${token}` : ''}`} className="text-blue-600 hover:underline">
              Log In
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
