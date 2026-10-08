'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArrowLeft, Phone, Calendar, Clock, Hash, MapPin, Play, Download, AlertCircle, Info, FileAudio, DollarSign, TrendingUp, CheckCircle, Copy, Scale, Check, X } from 'lucide-react';

interface Attempt {
  id: string;
  created_at: string;
  buyer_id: string;
  state: string;
  duration_secs?: number | null;
  started_at?: string | null;
  answered_at?: string | null;
  ended_at?: string | null;
  buyer?: { name: string } | null;
}

interface CallDetail {
  id: string;
  provider_call_id: string;
  from_number: string;
  to_number: string;
  state: string;
  duration_secs?: number | null;
  started_at?: string | null;
  answered_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  campaign?: { name: string } | null;
  buyer?: { name: string } | null;
  recordings?: { id: string; status: string }[];
  attempts: Attempt[];
  commercial?: {
    id: string;
    status: string;
    qualified: boolean;
    converted: boolean;
    duplicate: boolean;
    duplicate_of_call_id?: string | null;
    revenue: number | string;
    payout: number | string;
    cost: number | string;
    profit: number | string;
    currency: string;
    vendor?: { id: string; name: string } | null;
    buyer?: { id: string; name: string } | null;
    dispute?: {
      id: string;
      status: string;
      reason: string;
      description?: string | null;
      resolved_at?: string | null;
      resolution_notes?: string | null;
    } | null;
    adjustment?: {
      id: string;
      original_revenue: number | string;
      original_payout: number | string;
      adjusted_revenue: number | string;
      adjusted_payout: number | string;
      reason: string;
      created_at: string;
    } | null;
  } | null;
}

function formatCurrency(amount: number | string | null | undefined, currency: string = 'USD'): string {
  if (amount === null || amount === undefined) return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num);
}

export default function CallDetailPage({ params }: { params: Promise<{ callId: string }> | { callId: string } }) {
  const unwrappedParams = params instanceof Promise ? use(params) : params as { callId: string };
  const callId = unwrappedParams.callId;
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const returnTo = searchParams.get('returnTo');
  
  let backUrl = `/protected/calls?workspace=${workspaceId}`;
  if (returnTo === 'reporting') {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('returnTo');
    backUrl = `/protected/reporting?${sp.toString()}`;
  }
  
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [loadingRecording, setLoadingRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);

  // Dispute actions state
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeActionError, setDisputeActionError] = useState<string | null>(null);
  const [disputeActionSuccess, setDisputeActionSuccess] = useState<string | null>(null);

  // Resolution actions state
  const [showResolveModal, setShowResolveModal] = useState<'ACCEPTED' | 'REJECTED' | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolvingDispute, setResolvingDispute] = useState(false);
  const [isVendorWorkspace, setIsVendorWorkspace] = useState(false);

  useEffect(() => {
    async function checkVendorRole() {
      if (!workspaceId) return;
      try {
        const workspaces = await apiFetch('/workspaces');
        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === workspaceId)
          : null;
        if (currentWs) {
          setIsVendorWorkspace(currentWs.participant_type === 'VENDOR');
        }
      } catch {
        // Continue if workspace query fails
      }
    }
    checkVendorRole();
  }, [workspaceId]);

  const isVendor = isVendorWorkspace;

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

  useEffect(() => {
    if (workspaceId && callId) {
      loadCall();
    }
  }, [workspaceId, callId]);

  async function handleCreateDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !call?.commercial?.id) return;
    if (!disputeReason.trim()) {
      setDisputeActionError('Dispute reason is required.');
      return;
    }

    setDisputeSubmitting(true);
    setDisputeActionError(null);
    setDisputeActionSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/call-commercials/${call.commercial.id}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reason: disputeReason.trim(),
          description: disputeDescription.trim() || undefined,
        }),
      });
      setDisputeActionSuccess('Dispute submitted successfully.');
      setShowDisputeForm(false);
      setDisputeReason('');
      setDisputeDescription('');
      await loadCall();
    } catch (err: any) {
      setDisputeActionError(err?.message || 'Failed to submit dispute.');
    } finally {
      setDisputeSubmitting(false);
    }
  }

  async function handleResolveDispute(status: 'ACCEPTED' | 'REJECTED') {
    if (!workspaceId || !call?.commercial?.dispute?.id) return;

    setResolvingDispute(true);
    setDisputeActionError(null);
    setDisputeActionSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/disputes/${call.commercial.dispute.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          resolution_notes: resolutionNotes.trim() || undefined,
        }),
      });
      setDisputeActionSuccess(`Dispute ${status.toLowerCase()} successfully.`);
      setShowResolveModal(null);
      setResolutionNotes('');
      await loadCall();
    } catch (err: any) {
      setDisputeActionError(err?.message || `Failed to ${status.toLowerCase()} dispute.`);
    } finally {
      setResolvingDispute(false);
    }
  }

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
          href={backUrl}
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
              href={backUrl}
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
                {!isVendor && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Final Buyer
                    </span>
                    <p className="font-medium text-base">{finalBuyer || 'No successful destination'}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Started At
                  </span>
                  <p className="font-medium text-base">
                    {call.started_at ? new Date(call.started_at).toLocaleString() : '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Answered At
                  </span>
                  <p className="font-medium text-base">
                    {call.answered_at ? new Date(call.answered_at).toLocaleString() : '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Ended At
                  </span>
                  <p className="font-medium text-base">
                    {call.ended_at ? new Date(call.ended_at).toLocaleString() : '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Talk Duration
                  </span>
                  <p className="font-medium text-base">
                    {call.ended_at && call.answered_at ? `${Math.floor((new Date(call.ended_at).getTime() - new Date(call.answered_at).getTime()) / 1000)} seconds` : '—'}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Total Duration
                  </span>
                  <p className="font-medium text-base">
                    {call.ended_at && call.started_at ? `${Math.floor((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000)} seconds` : '—'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Commercial Economics Snapshot */}
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  Commercial Economics
                </div>
                {call.commercial && (
                  <Badge variant={call.commercial.status === 'ADJUSTED' ? 'warning' : 'outline'} className="text-[10px]">
                    Status: {call.commercial.status}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {!call.commercial ? (
                <div className="text-sm text-muted-foreground text-center py-4 bg-secondary/50 rounded-md border border-dashed border-border">
                  Commercial evaluation not available for this call.
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Financial Dimensions Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {call.commercial.revenue !== undefined && (
                      <div className="p-3 bg-muted/30 rounded-lg" data-testid="detail-revenue">
                        <span className="text-xs text-muted-foreground uppercase font-medium">Revenue</span>
                        <p className="text-lg font-bold text-foreground mt-1">
                          {formatCurrency(call.commercial.revenue, call.commercial.currency)}
                        </p>
                      </div>
                    )}
                    {call.commercial.payout !== undefined && (
                      <div className="p-3 bg-muted/30 rounded-lg" data-testid="detail-payout">
                        <span className="text-xs text-muted-foreground uppercase font-medium">Payout</span>
                        <p className="text-lg font-bold text-foreground mt-1">
                          {formatCurrency(call.commercial.payout, call.commercial.currency)}
                        </p>
                      </div>
                    )}
                    {call.commercial.cost !== undefined && (
                      <div className="p-3 bg-muted/30 rounded-lg" data-testid="detail-cost">
                        <span className="text-xs text-muted-foreground uppercase font-medium">Cost</span>
                        <p className="text-lg font-bold text-foreground mt-1">
                          {formatCurrency(call.commercial.cost, call.commercial.currency)}
                        </p>
                      </div>
                    )}
                    {call.commercial.profit !== undefined && (
                      <div className="p-3 bg-muted/30 rounded-lg" data-testid="detail-profit">
                        <span className="text-xs text-muted-foreground uppercase font-medium">Profit</span>
                        <p className={`text-lg font-bold mt-1 ${Number(call.commercial.profit) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {formatCurrency(call.commercial.profit, call.commercial.currency)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t pt-4 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">Currency</span>
                      <p className="font-semibold text-foreground">{call.commercial.currency || 'USD'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Classification</span>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {call.commercial.converted ? (
                          <Badge variant="success" className="text-[10px]">Converted</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Unconverted</Badge>
                        )}
                        {call.commercial.qualified ? (
                          <Badge variant="success" className="text-[10px]">Qualified</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Unqualified</Badge>
                        )}
                        {call.commercial.duplicate && (
                          <Badge variant="warning" className="text-[10px]">Duplicate</Badge>
                        )}
                      </div>
                    </div>
                    {!isVendor && call.commercial.buyer && (
                      <div>
                        <span className="text-xs text-muted-foreground">Commercial Buyer</span>
                        <p className="font-semibold text-foreground">{call.commercial.buyer?.name || '—'}</p>
                      </div>
                    )}
                    {call.commercial.vendor && (
                      <div>
                        <span className="text-xs text-muted-foreground">Commercial Vendor</span>
                        <p className="font-semibold text-foreground">{call.commercial.vendor?.name || '—'}</p>
                      </div>
                    )}
                  </div>

                  {/* Dispute Section */}
                  {!isVendor && (
                    <>
                      {call.commercial.dispute ? (
                        <div className="border border-border/80 rounded-md p-4 bg-muted/20 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Buyer Dispute</span>
                            <Badge variant={call.commercial.dispute.status === 'ACCEPTED' ? 'error' : call.commercial.dispute.status === 'PENDING' ? 'warning' : 'outline'} className="text-[10px]">
                              {call.commercial.dispute.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-foreground"><span className="text-muted-foreground font-medium">Reason:</span> {call.commercial.dispute.reason}</p>
                          {call.commercial.dispute.description && (
                            <p className="text-xs text-foreground"><span className="text-muted-foreground font-medium">Description:</span> {call.commercial.dispute.description}</p>
                          )}
                          {call.commercial.dispute.resolution_notes && (
                            <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Resolution Notes:</span> {call.commercial.dispute.resolution_notes}</p>
                          )}

                          {call.commercial.dispute.status === 'PENDING' && (
                            <div className="pt-2 border-t border-border flex flex-wrap gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs text-emerald-600 border-emerald-500/30 hover:bg-emerald-50"
                                onClick={() => {
                                  setShowResolveModal('ACCEPTED');
                                  setResolutionNotes('');
                                  setDisputeActionError(null);
                                }}
                                disabled={resolvingDispute}
                              >
                                <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                                Accept Dispute
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs text-rose-600 border-rose-500/30 hover:bg-rose-50"
                                onClick={() => {
                                  setShowResolveModal('REJECTED');
                                  setResolutionNotes('');
                                  setDisputeActionError(null);
                                }}
                                disabled={resolvingDispute}
                              >
                                <X className="w-3.5 h-3.5 mr-1 text-rose-600" />
                                Reject Dispute
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pt-2 flex justify-end">
                          {!showDisputeForm ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => {
                                setShowDisputeForm(true);
                                setDisputeActionError(null);
                                setDisputeActionSuccess(null);
                              }}
                            >
                              <Scale className="w-3.5 h-3.5 mr-1" />
                              File Dispute
                            </Button>
                          ) : (
                            <form onSubmit={handleCreateDispute} className="w-full border border-border rounded-md p-4 bg-muted/10 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">File Buyer Dispute</span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-muted-foreground"
                                  onClick={() => {
                                    setShowDisputeForm(false);
                                    setDisputeActionError(null);
                                  }}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                              
                              <div className="space-y-1">
                                <Label htmlFor="dispute-reason" className="text-xs font-medium">Reason *</Label>
                                <Input
                                  id="dispute-reason"
                                  placeholder="e.g. Call dropped under qualified threshold, invalid lead"
                                  value={disputeReason}
                                  onChange={(e) => setDisputeReason(e.target.value)}
                                  disabled={disputeSubmitting}
                                  required
                                  className="h-8 text-xs"
                                />
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor="dispute-desc" className="text-xs font-medium">Description (Optional)</Label>
                                <Input
                                  id="dispute-desc"
                                  placeholder="Additional details regarding the dispute"
                                  value={disputeDescription}
                                  onChange={(e) => setDisputeDescription(e.target.value)}
                                  disabled={disputeSubmitting}
                                  className="h-8 text-xs"
                                />
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={disputeSubmitting}
                                  onClick={() => setShowDisputeForm(false)}
                                  className="h-8 text-xs"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  isLoading={disputeSubmitting}
                                  disabled={disputeSubmitting || !disputeReason.trim()}
                                  className="h-8 text-xs"
                                >
                                  Submit Dispute
                                </Button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Feedback message banner */}
                  {!isVendor && disputeActionError && (
                    <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{disputeActionError}</span>
                    </div>
                  )}
                  {!isVendor && disputeActionSuccess && (
                    <div className="bg-success-muted text-success-muted-foreground p-3 rounded-md text-xs flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>{disputeActionSuccess}</span>
                    </div>
                  )}

                  {call.commercial.adjustment && (
                    <div className="border border-emerald-500/30 rounded-md p-4 bg-emerald-50/20 dark:bg-emerald-950/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider">Financial Adjustment</span>
                        <Badge variant="success" className="text-[10px]">Reversed</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {call.commercial.adjustment.original_revenue !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Original Revenue:</span>
                            <p className="font-mono">{formatCurrency(call.commercial.adjustment.original_revenue, call.commercial.currency)}</p>
                          </div>
                        )}
                        {call.commercial.adjustment.adjusted_revenue !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Adjusted Revenue:</span>
                            <p className="font-mono text-emerald-600">{formatCurrency(call.commercial.adjustment.adjusted_revenue, call.commercial.currency)}</p>
                          </div>
                        )}
                        {call.commercial.adjustment.original_payout !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Original Payout:</span>
                            <p className="font-mono">{formatCurrency(call.commercial.adjustment.original_payout, call.commercial.currency)}</p>
                          </div>
                        )}
                        {call.commercial.adjustment.adjusted_payout !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Adjusted Payout:</span>
                            <p className="font-mono text-emerald-600">{formatCurrency(call.commercial.adjustment.adjusted_payout, call.commercial.currency)}</p>
                          </div>
                        )}
                      </div>
                      {call.commercial.adjustment.reason && (
                        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Reason:</span> {call.commercial.adjustment.reason}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
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
                {isVendor ? 'Sequence of routing attempts.' : 'Sequence of buyer attempts.'}
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
                    const variant = getStatusBadgeVariant(attempt.state);
                    const talkDuration = (attempt.ended_at && attempt.answered_at) ? Math.floor((new Date(attempt.ended_at).getTime() - new Date(attempt.answered_at).getTime()) / 1000) : null;
                    
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
                              {isVendor ? `Attempt #${index + 1}` : `${index + 1}. ${attempt.buyer?.name || 'Unknown Buyer'}`}
                            </span>
                            <Badge variant={variant} className="text-[10px] h-5 px-1.5">
                              {attempt.state}
                            </Badge>
                          </div>
                          
                          <div className="flex flex-col text-xs text-muted-foreground mt-1">
                            {attempt.started_at && (
                              <div className="flex items-center justify-between">
                                <span>Started:</span>
                                <span>{new Date(attempt.started_at).toLocaleTimeString()}</span>
                              </div>
                            )}
                            {attempt.answered_at && (
                              <div className="flex items-center justify-between">
                                <span>Answered:</span>
                                <span>{new Date(attempt.answered_at).toLocaleTimeString()}</span>
                              </div>
                            )}
                            {attempt.ended_at && (
                              <div className="flex items-center justify-between">
                                <span>Ended:</span>
                                <span>{new Date(attempt.ended_at).toLocaleTimeString()}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between mt-1 pt-1 border-t">
                              <span className="font-medium text-foreground">Talk Duration:</span>
                              <span className="font-mono">{talkDuration != null ? `${talkDuration}s` : '—'}</span>
                            </div>
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

      {/* Resolve Dispute Confirmation Dialog */}
      <ConfirmDialog
        open={showResolveModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShowResolveModal(null);
            setResolutionNotes('');
          }
        }}
        title={showResolveModal === 'ACCEPTED' ? 'Accept Dispute' : 'Reject Dispute'}
        description={
          <div className="space-y-3 pt-2">
            <p className="text-sm text-foreground">
              {showResolveModal === 'ACCEPTED'
                ? 'Are you sure you want to accept this dispute? A financial adjustment will automatically be recorded to reverse revenue and payout.'
                : 'Are you sure you want to reject this dispute? No financial adjustment will be made and the dispute will be marked as rejected.'}
            </p>
            <div className="space-y-1">
              <Label htmlFor="resolution-notes" className="text-xs font-medium">Resolution Notes (Optional)</Label>
              <Input
                id="resolution-notes"
                placeholder="Add optional internal context or explanation"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                disabled={resolvingDispute}
                className="h-8 text-xs"
              />
            </div>
          </div>
        }
        confirmText={showResolveModal === 'ACCEPTED' ? 'Accept Dispute' : 'Reject Dispute'}
        cancelText="Cancel"
        onConfirm={() => {
          if (showResolveModal) {
            handleResolveDispute(showResolveModal);
          }
        }}
        isLoading={resolvingDispute}
        destructive={showResolveModal === 'REJECTED'}
      />
    </div>
  );
}
