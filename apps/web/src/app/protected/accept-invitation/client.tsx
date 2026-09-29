'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function AcceptInvitationClient({ token }: { token: string }) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  useEffect(() => {
    async function accept() {
      try {
        const res = await apiFetch(`/workspaces/accept-invitation`, {
          method: 'POST',
          body: JSON.stringify({ token }),
        });

        setStatus('success');
        setTimeout(() => {
          if (res?.workspaceId) {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `/protected?workspace=${res.workspaceId}`;
          } else {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/protected';
          }
        }, 2000);
      } catch (err: unknown) {
        setStatus('error');
        const errorObj = err as Error;
        let errMsg = errorObj.message || 'An error occurred';
        if (errMsg.includes('API error')) {
          try {
            const jsonPart = errMsg.substring(errMsg.indexOf('{'));
            const parsed = JSON.parse(jsonPart);
            if (parsed.message) {
              errMsg = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
            }
          } catch (e) {
            // ignore
          }
        }
        setErrorMsg(errMsg);
      }
    }

    accept();
  }, [token, router]);

  return (
    <div className="p-8 border rounded shadow-md max-w-md w-full bg-white text-center">
      <h1 className="text-2xl font-bold mb-4">Accepting Invitation...</h1>
      {status === 'loading' && <p>Please wait...</p>}
      {status === 'success' && <p className="text-green-600">Invitation accepted successfully! Redirecting...</p>}
      {status === 'error' && (
        <div className="text-red-600">
          <p>{errorMsg}</p>
          <button 
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => router.push('/protected')}
          >
            Go to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
