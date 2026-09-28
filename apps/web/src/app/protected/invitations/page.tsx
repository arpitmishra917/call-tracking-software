'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MailOpen } from 'lucide-react';

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided. Please check your invitation link.");
    }
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch('/workspaces/accept-invitation', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setSuccess("Invitation accepted! You have successfully joined the workspace.");
      
      // Redirect to the workspace after a short delay
      setTimeout(() => {
        router.push(`/?workspace=${result.workspaceId}`);
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-8 w-full max-w-md mx-auto">
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
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm text-center">
              {error}
            </div>
          )}
          {success && (
            <div className="p-4 bg-success-muted text-success-foreground rounded-md border border-success-muted text-sm text-center">
              {success}
            </div>
          )}
          {!error && !success && (
            <p className="text-center text-muted-foreground text-sm">
              Click the button below to accept the invitation and gain access to the workspace.
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          {!success && (
            <Button 
              className="w-full" 
              onClick={handleAccept} 
              isLoading={loading}
              disabled={!token || !!error}
            >
              Accept Invitation
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={() => router.push('/protected')}>
            Return to Dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
