'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { Play, AlertCircle } from 'lucide-react';

export interface InlineRecordingPlayerProps {
  workspaceId?: string | null;
  recordingId?: string | null;
  callWorkspaceId?: string | null;
  recordings?: { id: string; status: string }[] | null;
  className?: string;
}

export function InlineRecordingPlayer({
  workspaceId,
  recordingId,
  callWorkspaceId,
  recordings,
  className = '',
}: InlineRecordingPlayerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Authoritative target recording ID
  const effectiveRecId =
    recordingId ||
    recordings?.find((r) => r.status === 'COMPLETED' || r.status === 'READY')?.id ||
    recordings?.[0]?.id;

  // Authoritative target workspace ID (prefers active context, falls back to call's own workspace)
  const effectiveWsId = workspaceId || callWorkspaceId;

  // Reset state when recording ID or workspace ID changes (e.g. pagination or filter change)
  useEffect(() => {
    setUrl(null);
    setError(null);
    setLoading(false);
  }, [effectiveRecId, effectiveWsId]);

  if (!effectiveRecId) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const handlePlay = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (!effectiveWsId) {
      setError('Workspace not resolved');
      return;
    }

    // If audio is already loaded and paused, resume playback
    if (url && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {
          fetchUrlAndPlay();
        });
      } else {
        audioRef.current.pause();
      }
      return;
    }

    await fetchUrlAndPlay();
  };

  const fetchUrlAndPlay = async () => {
    if (loading) return; // Prevent duplicate requests
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(
        `/workspaces/${effectiveWsId}/recordings/${effectiveRecId}/download`
      );

      if (res && res.url) {
        setUrl(res.url);
      } else {
        setError('Unavailable');
      }
    } catch (err: any) {
      const msg = err?.message || 'Error';
      if (msg.includes('403')) {
        setError('Unauthorized');
      } else if (msg.includes('404')) {
        setError('Not Found');
      } else {
        setError('Playback failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAudioError = () => {
    // If the audio source fails to play (e.g., expired signed URL), reset and allow retry
    setError('Expired URL. Click to retry.');
    setUrl(null);
  };

  if (url) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
        <audio
          ref={audioRef}
          controls
          autoPlay
          src={url}
          onError={handleAudioError}
          className="h-8 max-w-[150px] sm:max-w-[200px]"
          aria-label="Call recording audio player"
        >
          Your browser does not support audio playback.
        </audio>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handlePlay}
        disabled={loading || !effectiveWsId}
        className="h-7 px-2.5 text-xs font-medium"
        aria-label="Play recording"
      >
        <Play className="w-3.5 h-3.5 mr-1 text-primary" />
        {loading ? 'Loading...' : 'Play'}
      </Button>
      {error && (
        <span
          className="inline-flex items-center text-destructive text-xs cursor-pointer hover:underline"
          title={`${error} (click to retry)`}
          onClick={handlePlay}
        >
          <AlertCircle className="w-3.5 h-3.5 text-destructive mr-0.5" />
          <span className="text-[11px] font-medium">{error === 'Unauthorized' ? 'Denied' : 'Retry'}</span>
        </span>
      )}
    </div>
  );
}
