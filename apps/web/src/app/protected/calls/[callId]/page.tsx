'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Phone, Calendar, Clock, Hash, MapPin, Play, Download, AlertCircle, Info, FileAudio } from 'lucide-react';

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

export default function CallDetailPage({ params }: { params: Promise<{ callId: string }> | { callId: string } }) {
  const unwrappedParams = params instanceof Promise ? use(params) : params as { callId: string };
  const callId = unwrappedParams.callId;
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
        const data = await apiFetch(`/workspaces/${workspaceId}/calls/${callId}`);
        setCall(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Call not found or access denied.');
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId && callId) {
      loadCall();
    }
  }, [workspaceId, callId]);

  async function handleFetchRecordingUrl(action: 'play' | 'download') {
    if (!workspaceId || !call?.recordings?.[0]?.id) return;
    
    setLoadingRecording(true);
    setRecordingError(null);
    try {
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
    } catch {
      setRecordingError('Failed to access recording safely.');
    } finally {
      setLoadingRecording(false);
    }
  }

  const getStatusBadgeVariant = (state: string) => {
    switch (state?.toUpperCase()) {
      case 'COMPLETED':
      case 'ANSWERED':
        return 'success';
      case 'NO_ANSWER':
      case 'FAILED':
        return 'error';
      case 'BLOCKED':
        return 'error';
      case 'ROUTING':
      case 'RINGING':
      case 'ACTIVE':
        return 'warning';
      default:
        return 'default';
    }
  };

  if (!workspaceId) {
    return <div className="p-8 text-muted-foreground">Please select a workspace first.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
        Loading call details...
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md border border-error/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error || 'Call not found.'}</p>
        </div>
        <Link 
          href={`/protected/calls?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors border border-border bg-surface hover:bg-muted hover:text-foreground h-10 px-4 py-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Call Logs
        </Link>
      </div>
    );
  }

  const answeredAttempt = call.attempts.find(a => a.state === 'COMPLETED' || a.state === 'ANSWERED' || a.state.toLowerCase() === 'connected');
  const finalBuyer = call.buyer?.name || answeredAttempt?.buyer?.name || '-';

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-2">
            <Link 
              href={`/protected/calls?workspace=${workspaceId}`}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 w-10 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="sr-only">Back</span>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Call Details</h1>
            <Badge variant={getStatusBadgeVariant(call.state)} className="ml-2">
              {call.state}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground ml-11">
            <span className="font-mono text-xs">{call.id}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Summary & Metadata */}
        <div className="lg:col-span-2 space-y-6">
          
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Call Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" /> Caller
                  </span>
                  <p className="font-mono text-base font-medium">{call.from_number}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5" /> Tracking Number
                  </span>
                  <p className="font-mono text-base font-medium">{call.to_number}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Campaign
                  </span>
                  <p className="font-medium text-base">{call.campaign?.name || '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Final Buyer
                  </span>
                  <p className="font-medium text-base">{finalBuyer}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Date & Time
                  </span>
                  <p className="font-medium text-base">
                    {new Date(call.created_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'medium'
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Duration
                  </span>
                  <p className="font-medium text-base">
                    {call.duration_secs != null ? `${call.duration_secs} seconds` : '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-primary" />
                Recording
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {(!call.recordings || call.recordings.length === 0) ? (
                <div className="text-sm text-muted-foreground text-center py-4 bg-secondary/50 rounded-md border border-dashed border-border">
                  No recording available for this call.
                </div>
              ) : (
                <div className="space-y-4">
                  {call.recordings[0].status !== 'COMPLETED' ? (
                    <div className="text-sm text-muted-foreground bg-warning-muted text-warning-muted-foreground px-4 py-3 rounded-md border border-warning/20">
                      Recording status: <span className="font-semibold">{call.recordings[0].status}</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {recordingError && (
                        <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {recordingError}
                        </div>
                      )}
                      
                      {showPlayer && recordingUrl && (
                        <div className="w-full bg-secondary p-4 rounded-md border border-border">
                          <audio controls autoPlay src={recordingUrl} className="w-full">
                            Your browser does not support the audio element.
                          </audio>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3">
                        {!showPlayer && (
                          <Button 
                            onClick={() => handleFetchRecordingUrl('play')} 
                            disabled={loadingRecording}
                            className="w-full sm:w-auto"
                          >
                            <Play className="w-4 h-4 mr-2" />
                            {loadingRecording ? 'Loading...' : 'Play Recording'}
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          onClick={() => handleFetchRecordingUrl('download')} 
                          disabled={loadingRecording}
                          className="w-full sm:w-auto"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Routing Timeline */}
        <div className="space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                Routing Timeline
              </CardTitle>
              <CardDescription>
                Sequence of buyer attempts.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex-1">
              {call.attempts.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No routing attempts recorded.
                </div>
              ) : (
                <div className="relative border-l-2 border-border ml-3 space-y-8 pb-4">
                  {call.attempts.map((attempt, index) => {
                    const isLast = index === call.attempts.length - 1;
                    const variant = getStatusBadgeVariant(attempt.state);
                    
                    return (
                      <div key={attempt.id} className="relative pl-6">
                        <div className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-surface flex items-center justify-center
                          ${variant === 'success' ? 'bg-success' : 
                            variant === 'error' ? 'bg-error' : 
                            'bg-muted-foreground'}`
                        } />
                        
                        <div className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {attempt.buyer?.name || 'Unknown Buyer'}
                            </span>
                            <Badge variant={variant} className="text-[10px] h-5 px-1.5">
                              {attempt.state}
                            </Badge>
                          </div>
                          
                          <div className="flex items-center text-xs text-muted-foreground gap-3">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {attempt.duration_secs != null ? `${attempt.duration_secs}s` : '0s'}
                            </span>
                            <span>
                              {new Date(attempt.created_at).toLocaleTimeString(undefined, { 
                                hour: '2-digit', 
                                minute: '2-digit',
                                second: '2-digit'
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Final Status node */}
                  <div className="relative pl-6 mt-8">
                    <div className="absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-surface flex items-center justify-center bg-primary" />
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">Final Status</span>
                      <span className="text-xs text-muted-foreground">{call.state}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
