import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MailOpen } from 'lucide-react'

export default async function InvitationPage(
  props: { searchParams: Promise<{ token?: string }> }
) {
  const searchParams = await props.searchParams;
  const token = searchParams.token;
  let invitationDetails: { workspace_name: string; email: string } | null = null;
  let errorMsg: string | null = null;

  if (!token) {
    errorMsg = "No invitation token provided. Please check your invitation link.";
  } else {
    try {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const res = await fetch(`${apiUrl}/invitations/verify/${token}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.status !== 'PENDING') {
          errorMsg = `This invitation is no longer valid (Status: ${data.status})`;
        } else {
          invitationDetails = data;
        }
      } else {
        const text = await res.text();
        errorMsg = `Invalid or expired invitation (${res.status})`;
      }
    } catch (e) {
      console.error('Failed to verify token', e);
      errorMsg = "Failed to verify invitation. Please try again later.";
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] py-8 w-full max-w-md mx-auto px-4">
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
            <MailOpen className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Workspace Invitation</CardTitle>
          <CardDescription>
            You have been invited to join a workspace on CallFlow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMsg ? (
            <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm text-center">
              {errorMsg}
            </div>
          ) : invitationDetails ? (
            <div className="space-y-4 text-center">
              <div className="p-4 bg-muted rounded-md text-sm">
                <p className="text-muted-foreground mb-1">You have been invited to join:</p>
                <p className="font-semibold text-lg">{invitationDetails.workspace_name}</p>
              </div>
              <div className="p-4 bg-muted rounded-md text-sm">
                <p className="text-muted-foreground mb-1">Invited email:</p>
                <p className="font-medium">{invitationDetails.email}</p>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Loading invitation details...
            </div>
          )}
        </CardContent>
        {invitationDetails && !errorMsg && (
          <CardFooter className="flex flex-col gap-4 border-t pt-6">
            <div className="w-full space-y-2">
              <p className="text-sm font-medium text-center mb-2">Create a new account</p>
              <Link href={`/signup?token=${token}`} className="w-full">
                <Button className="w-full">Create Account</Button>
              </Link>
            </div>
            
            <div className="w-full relative py-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <div className="w-full space-y-2">
              <p className="text-sm font-medium text-center mb-2">Already have an account?</p>
              <Link href={`/login?token=${token}`} className="w-full">
                <Button variant="outline" className="w-full">Log In</Button>
              </Link>
            </div>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
