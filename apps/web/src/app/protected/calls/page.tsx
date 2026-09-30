'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PhoneCall, Search, X, Play, AlertCircle } from 'lucide-react';

interface CallLog {
  id: string;
  created_at: string;
  from_number: string;
  to_number: string;
  state: string;
  duration_secs?: number | null;
  talkDurationSecs?: number | null;
  totalDurationSecs?: number | null;
  campaign?: { name: string } | null;
  recordings?: { id: string; status: string }[];
}

function formatDuration(secs: number | null | undefined): string {
  if (secs === null || secs === undefined) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function InlineRecordingPlayer({ workspaceId, recordingId }: { workspaceId: string, recordingId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/workspaces/${workspaceId}/recordings/${recordingId}/download`);
      if (res.url) {
        setUrl(res.url);
      } else {
        setError('Failed');
      }
    } catch (e) {
      setError('Error');
    } finally {
      setLoading(false);
    }
  };

  if (url) {
    return (
      <audio controls autoPlay src={url} className="h-8 max-w-[150px] sm:max-w-[200px]" aria-label="Call recording audio player">
        Browser does not support audio.
      </audio>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button 
        variant="outline" 
        size="sm" 
        onClick={handlePlay} 
        disabled={loading}
        className="h-8 px-3"
        aria-label="Play recording"
      >
        <Play className="w-3.5 h-3.5 mr-1" />
        {loading ? '...' : 'Play'}
      </Button>
      {error && <span className="text-red-500 text-xs font-medium" title={error}><AlertCircle className="w-4 h-4 inline" /></span>}
    </div>
  );
}

export default function CallsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Dropdowns data
  const [phoneNumbers, setPhoneNumbers] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    callerNumber: '',
    status: '',
    campaignId: '',
    buyerId: '',
    trackingNumber: '',
    durationType: '',
    minDurationSecs: '',
    maxDurationSecs: '',
  });

  useEffect(() => {
    async function loadDropdowns() {
      if (!workspaceId) return;
      try {
        const [phoneData, campData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/phone-numbers`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/campaigns`).catch(() => [])
        ]);
        setPhoneNumbers(Array.isArray(phoneData) ? phoneData : phoneData?.items || []);
        setCampaigns(Array.isArray(campData) ? campData : campData?.items || []);
      } catch (e) {
        console.error('Failed to load dropdowns', e);
      }
    }
    loadDropdowns();
  }, [workspaceId]);

  useEffect(() => {
    async function loadCalls() {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (filters.startDate) query.set('startDate', filters.startDate);
        if (filters.endDate) query.set('endDate', filters.endDate);
        if (filters.callerNumber) query.set('callerNumber', filters.callerNumber);
        if (filters.status) query.set('status', filters.status);
        if (filters.campaignId) query.set('campaignId', filters.campaignId);
        if (filters.buyerId) query.set('buyerId', filters.buyerId);
        if (filters.trackingNumber) query.set('trackingNumber', filters.trackingNumber);
        
        if (filters.minDurationSecs || filters.maxDurationSecs) {
          if (filters.durationType) query.set('durationType', filters.durationType);
          if (filters.minDurationSecs) query.set('minDurationSecs', filters.minDurationSecs);
          if (filters.maxDurationSecs) query.set('maxDurationSecs', filters.maxDurationSecs);
        }
        
        const data = await apiFetch(`/workspaces/${workspaceId}/calls?${query.toString()}`);
        setCalls(data.items || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadCalls();
    }
  }, [workspaceId, filters]);

  const clearFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      callerNumber: '',
      status: '',
      campaignId: '',
      buyerId: '',
      trackingNumber: '',
      durationType: '',
      minDurationSecs: '',
      maxDurationSecs: '',
    });
  };

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

  if (!workspaceId) return <div className="p-6 text-muted-foreground">Select a workspace first.</div>;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Calls</h1>
          <p className="text-muted-foreground">Operational call logs and routing history.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="trackingNumber">Tracking Number</Label>
              <select 
                id="trackingNumber"
                value={filters.trackingNumber} 
                onChange={e => setFilters({...filters, trackingNumber: e.target.value})} 
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">All Numbers</option>
                {phoneNumbers.map(n => <option key={n.id} value={n.phone_number}>{n.phone_number}</option>)}
              </select>
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="campaignId">Campaign</Label>
              <select 
                id="campaignId"
                value={filters.campaignId} 
                onChange={e => setFilters({...filters, campaignId: e.target.value})} 
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">All Campaigns</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="callerNumber">Caller Number</Label>
              <Input 
                id="callerNumber"
                type="text" 
                value={filters.callerNumber} 
                onChange={e => setFilters({...filters, callerNumber: e.target.value})} 
                placeholder="+1..." 
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select 
                id="status"
                value={filters.status} 
                onChange={e => setFilters({...filters, status: e.target.value})} 
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="NO_ANSWER">No Answer</option>
                <option value="FAILED">Failed</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="durationType">Duration Type</Label>
              <select 
                id="durationType"
                value={filters.durationType} 
                onChange={e => setFilters({...filters, durationType: e.target.value})} 
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">None</option>
                <option value="talk">Talk Time</option>
                <option value="total">Total Time</option>
              </select>
            </div>

            <div className="space-y-1.5 flex gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="minDurationSecs">Min (s)</Label>
                <Input 
                  id="minDurationSecs"
                  type="number"
                  min="0"
                  value={filters.minDurationSecs} 
                  onChange={e => setFilters({...filters, minDurationSecs: e.target.value})} 
                  placeholder="Min"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="maxDurationSecs">Max (s)</Label>
                <Input 
                  id="maxDurationSecs"
                  type="number"
                  min="0"
                  value={filters.maxDurationSecs} 
                  onChange={e => setFilters({...filters, maxDurationSecs: e.target.value})} 
                  placeholder="Max"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start Date</Label>
              <Input 
                id="startDate"
                type="date" 
                value={filters.startDate} 
                onChange={e => setFilters({...filters, startDate: e.target.value})} 
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End Date</Label>
              <Input 
                id="endDate"
                type="date" 
                value={filters.endDate} 
                onChange={e => setFilters({...filters, endDate: e.target.value})} 
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">Time</TableHead>
                <TableHead className="min-w-[130px]">Caller</TableHead>
                <TableHead className="min-w-[130px]">Tracking No.</TableHead>
                <TableHead className="min-w-[130px]">Campaign</TableHead>
                <TableHead className="min-w-[100px]" title="Talk Time = connected/answered time through final hangup.">Talk Time</TableHead>
                <TableHead className="min-w-[100px]" title="Total Time = tracking number call start through final hangup.">Total Time</TableHead>
                <TableHead className="min-w-[100px]">Status</TableHead>
                <TableHead className="min-w-[120px]">Recording</TableHead>
                <TableHead className="text-right min-w-[90px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Loading calls...
                    </div>
                  </TableCell>
                </TableRow>
              ) : calls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center">
                    <EmptyState 
                      icon={<PhoneCall className="w-8 h-8" />}
                      title="No calls found"
                      description="No calls match the current filter criteria."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                calls.map(call => {
                  const playableRec = call.recordings?.find(r => r.status === 'COMPLETED');
                  return (
                    <TableRow key={call.id} className="group hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium whitespace-nowrap text-sm">
                        {new Date(call.created_at).toLocaleString(undefined, { 
                          month: 'short', 
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{call.from_number}</TableCell>
                      <TableCell className="font-mono text-xs">{call.to_number}</TableCell>
                      <TableCell className="text-sm">{call.campaign?.name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono" title="Talk Time = connected/answered time through final hangup.">
                        {formatDuration(call.talkDurationSecs)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono" title="Total Time = tracking number call start through final hangup.">
                        {formatDuration(call.totalDurationSecs)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(call.state)}>
                          {call.state}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {playableRec ? (
                          <InlineRecordingPlayer workspaceId={workspaceId} recordingId={playableRec.id} />
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link 
                          href={`/protected/calls/${call.id}?workspace=${workspaceId}`}
                          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-secondary hover:text-foreground h-8 px-3"
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
