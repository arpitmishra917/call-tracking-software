import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function LoginPage(
  props: { searchParams: Promise<{ token?: string, message?: string }> }
) {
  const searchParams = await props.searchParams;
  const token = searchParams.token;
  let invitationDetails: { workspace_name: string; email: string } | null = null;

  if (token) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invitations/verify/${token}`, { cache: 'no-store' });
      if (res.ok) {
        invitationDetails = await res.json();
      }
    } catch (e) {
      console.error('Failed to verify token', e);
    }
  }

  const login = async (formData: FormData) => {
    'use server'
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const inviteToken = formData.get('inviteToken') as string
    const supabase = await createClient()

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return redirect(`/login?message=${encodeURIComponent(error.message)}${inviteToken ? `&token=${inviteToken}` : ''}`)
    }

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
          <form className="flex flex-col gap-4" action={login}>
            {token && <input type="hidden" name="inviteToken" value={token} />}

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

            {searchParams.message && (
              <p className="text-red-500 text-sm mt-2 text-center">{searchParams.message}</p>
            )}

            <Button type="submit" className="w-full mt-2">Log In</Button>
          </form>
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
