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
  buyer?: { name: string } | null;
  recordings?: { id: string; status: string }[];
  attempts: Attempt[];
}

export default function CallDetailPage({ params }: { params: { callId: string } }) {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [loadingRecording, setLoadingRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);

  useEffect(() => {
    async function loadCall() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/calls/${params.callId}`);
        setCall(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Call not found or access denied.');
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId && params.callId) {
      loadCall();
    }
  }, [workspaceId, params.callId]);

  async function handleFetchRecordingUrl(action: 'play' | 'download') {
    if (!workspaceId || !call?.recordings?.[0]?.id) return;
    
    setLoadingRecording(true);
    setRecordingError(null);
    try {
      // Use existing secure endpoint which enforces authorization
      const res = await apiFetch(`/workspaces/${workspaceId}/recordings/${call.recordings[0].id}/download`);
      
      if (res.url) {
        if (action === 'download') {
          window.open(res.url, '_blank');
        } else {
          setRecordingUrl(res.url);
          setShowPlayer(true);
        }
      } else {
        throw new Error('Recording URL not returned');
      }
    } catch (e: unknown) {
      setRecordingError('Failed to access recording safely.');
    } finally {
      setLoadingRecording(false);
    }
  }

  if (!workspaceId) {
    return <div className="p-8 text-gray-500">Please select a workspace first.</div>;
  }

  if (loading) {
    return <div className="p-8 text-gray-500">Loading call details...</div>;
  }

  if (error || !call) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-red-50 text-red-600 p-4 rounded shadow-sm">
          {error || 'Call not found.'}
        </div>
        <Link href={`/protected/calls?workspace=${workspaceId}`} className="mt-4 inline-block text-blue-600 hover:underline">
          &larr; Back to Call Logs
        </Link>
      </div>
    );
  }

  // Identify successful buyer based on attempts (if not returned at top level)
  const answeredAttempt = call.attempts.find(a => a.state === 'COMPLETED' || a.state === 'ANSWERED' || a.state === 'connected');
  const finalBuyer = call.buyer?.name || answeredAttempt?.buyer?.name || '-';

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Call Details</h1>
          <p className="text-gray-600 mt-1">Status: <span className="font-semibold text-gray-900">{call.state}</span></p>
        </div>
        <Link href={`/protected/calls?workspace=${workspaceId}`} className="text-blue-600 hover:underline">
          &larr; Back to Call Logs
        </Link>
      </div>

      <div className="bg-white rounded shadow p-6 border border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <span className="text-sm text-gray-500 block mb-1">Caller</span>
            <span className="font-mono text-lg">{call.from_number}</span>
          </div>
          <div>
            <span className="text-sm text-gray-500 block mb-1">Tracking Number</span>
            <span className="font-mono text-lg">{call.to_number}</span>
          </div>
          <div>
            <span className="text-sm text-gray-500 block mb-1">Campaign</span>
            <span className="font-medium">{call.campaign?.name || '-'}</span>
          </div>
          <div>
            <span className="text-sm text-gray-500 block mb-1">Buyer</span>
            <span className="font-medium">{finalBuyer}</span>
          </div>
          <div>
            <span className="text-sm text-gray-500 block mb-1">Duration</span>
            <span className="font-medium">{call.duration_secs != null ? `${call.duration_secs} seconds` : '-'}</span>
          </div>
          <div>
            <span className="text-sm text-gray-500 block mb-1">Date & Time</span>
            <span className="font-medium">{new Date(call.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow p-6 border border-gray-100">
        <h2 className="text-xl font-bold mb-4">Buyer Attempts</h2>
        {call.attempts.length === 0 ? (
          <p className="text-gray-500">No routing attempts recorded.</p>
        ) : (
          <div className="space-y-4">
            {call.attempts.map((attempt, index) => (
              <div key={attempt.id} className="flex flex-col p-4 bg-gray-50 rounded border border-gray-100">
                <div className="font-medium mb-1">
                  {index + 1}. {attempt.buyer?.name || 'Unknown Buyer'}
                </div>
                <div className="text-sm text-gray-600 flex gap-4">
                  <span>Status: <span className="font-semibold text-gray-900">{attempt.state}</span></span>
                  {attempt.duration_secs != null && (
                    <span>Duration: <span className="font-semibold text-gray-900">{attempt.duration_secs}s</span></span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded shadow p-6 border border-gray-100">
        <h2 className="text-xl font-bold mb-4">Recording</h2>
        
        {(!call.recordings || call.recordings.length === 0) ? (
          <p className="text-gray-500">Recording not available.</p>
        ) : (
          <div className="space-y-4">
            {call.recordings[0].status !== 'COMPLETED' ? (
              <p className="text-gray-500">Recording status: {call.recordings[0].status}</p>
            ) : (
              <div className="space-y-4">
                {recordingError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
                    {recordingError}
                  </div>
                )}
                
                {showPlayer && recordingUrl ? (
                  <div className="w-full">
                    <audio controls autoPlay src={recordingUrl} className="w-full mb-4">
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                ) : null}

                <div className="flex gap-3">
                  {!showPlayer && (
                    <button
                      onClick={() => handleFetchRecordingUrl('play')}
                      disabled={loadingRecording}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center"
                    >
                      {loadingRecording ? 'Loading...' : '▶ Play Recording'}
                    </button>
                  )}
                  <button
                    onClick={() => handleFetchRecordingUrl('download')}
                    disabled={loadingRecording}
                    className="px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    Download
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
