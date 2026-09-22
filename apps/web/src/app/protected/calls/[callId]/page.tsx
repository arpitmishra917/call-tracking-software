'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';

interface Attempt {
  id: string;
  created_at: string;
  buyer_id: string;
  state: string;
  duration_secs?: number | null;
  buyer?: { name: string } | null;
}

interface CallDetail {
  id: string;
  provider_call_id: string;
  from_number: string;
  to_number: string;
  state: string;
  duration_secs?: number | null;
  created_at: string;
  campaign?: { name: string } | null;
  recordings?: { id: string; status: string }[];
  attempts: Attempt[];
}

export default function CallDetailPage({ params }: { params: { callId: string } }) {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCall() {
      setLoading(true);
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/calls/${params.callId}`);
        setCall(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId && params.callId) {
      loadCall();
    }
  }, [workspaceId, params.callId]);

  if (!workspaceId) return <div className="p-6">Select a workspace first.</div>;

  if (loading) return <div className="p-6">Loading call details...</div>;
  if (!call) return <div className="p-6">Call not found.</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Call Details</h1>
        <Link href={`/protected/calls?workspace=${workspaceId}`} className="text-blue-600 hover:underline">
          &larr; Back to Call Logs
        </Link>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-gray-100 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-gray-500 block text-sm">Call ID</span><span className="font-medium">{call.id}</span></div>
          <div><span className="text-gray-500 block text-sm">Provider ID</span><span className="font-medium">{call.provider_call_id}</span></div>
          <div><span className="text-gray-500 block text-sm">Caller Number</span><span className="font-medium">{call.from_number}</span></div>
          <div><span className="text-gray-500 block text-sm">Tracking Number</span><span className="font-medium">{call.to_number}</span></div>
          <div><span className="text-gray-500 block text-sm">Campaign</span><span className="font-medium">{call.campaign?.name || '-'}</span></div>
          <div><span className="text-gray-500 block text-sm">Status</span><span className="font-medium">{call.state}</span></div>
          <div><span className="text-gray-500 block text-sm">Duration</span><span className="font-medium">{call.duration_secs ? `${call.duration_secs}s` : '-'}</span></div>
          <div><span className="text-gray-500 block text-sm">Started At</span><span className="font-medium">{new Date(call.created_at).toLocaleString()}</span></div>
        </div>

        {call.recordings && call.recordings.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <h3 className="font-bold text-lg mb-2">Recording</h3>
            <div className="flex items-center space-x-4">
              <span className="text-sm">Status: {call.recordings[0].status}</span>
              {call.recordings[0].status === 'COMPLETED' && (
                <button 
                  onClick={async () => {
                    const res = await apiFetch(`/workspaces/${workspaceId}/recordings/${call.recordings?.[0]?.id}/download`);
                    if (res.url) window.open(res.url, '_blank');
                  }}
                  className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-sm hover:bg-blue-200"
                >
                  Listen / Download
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">Attempt History</h2>
        <div className="bg-white rounded shadow-sm border overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">Buyer</th>
                <th className="p-3">Status</th>
                <th className="p-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {call.attempts.length === 0 ? (
                <tr><td colSpan={4} className="p-4 text-center">No routing attempts recorded.</td></tr>
              ) : (
                call.attempts.map((attempt: Attempt) => (
                  <tr key={attempt.id} className="border-b">
                    <td className="p-3">{new Date(attempt.created_at).toLocaleString()}</td>
                    <td className="p-3">{attempt.buyer?.name || attempt.buyer_id}</td>
                    <td className="p-3">{attempt.state}</td>
                    <td className="p-3">{attempt.duration_secs ? `${attempt.duration_secs}s` : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
