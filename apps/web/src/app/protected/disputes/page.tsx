'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Scale, Check, X, Eye, AlertCircle, CheckCircle, ShieldAlert, RefreshCw, Filter } from 'lucide-react';

export interface DisputeItem {
  id: string;
  call_id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reason: string;
  description?: string | null;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  created_at: string;
  buyer?: { id: string; name: string } | null;
  revenue?: number | null;
  currency?: string;
  adjustment?: {
    id: string;
    original_revenue: number;
    adjusted_revenue: number;
    original_payout?: number;
    adjusted_payout?: number;
    reason?: string;
  } | null;
}

function formatCurrency(amount: number | null | undefined, currency: string = 'USD'): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export default function DisputesPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Role detection
  const [userRole, setUserRole] = useState<{ role: string; isVendor: boolean } | null>(null);

  // Resolution modal state
  const [resolvingDispute, setResolvingDispute] = useState<DisputeItem | null>(null);
  const [resolveAction, setResolveAction] = useState<'ACCEPTED' | 'REJECTED' | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isSubmittingResolution, setIsSubmittingResolution] = useState(false);

  // Check user role in the workspace
  useEffect(() => {
    async function checkRole() {
      if (!workspaceId) return;
      try {
        const workspaces = await apiFetch('/workspaces');
        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === workspaceId)
          : null;
        if (currentWs) {
          // If role is VIEWER or other, track it
          setUserRole({
            role: currentWs.role,
            isVendor: currentWs.role === 'MEMBER' && currentWs.participant_type === 'VENDOR',
          });
        }
      } catch {
        // Continue if workspace query fails
      }
    }
    checkRole();
  }, [workspaceId]);

  const loadDisputes = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setActionError(null);

    try {
      // Calls API provides calls with their commercial and dispute data
      // This respects role-based filtering automatically (Vendors receive 403 on dispute data, Buyers see only own)
      const data = await apiFetch(`/workspaces/${workspaceId}/calls?limit=100`);
      const items = data?.items || [];

      // Extract all calls that have commercial dispute records
      const disputeList: DisputeItem[] = [];
      for (const call of items) {
        if (call.commercial?.disputeStatus) {
          disputeList.push({
            id: call.commercial.dispute?.id || `disp-${call.id}`,
            call_id: call.id,
            status: call.commercial.disputeStatus as 'PENDING' | 'ACCEPTED' | 'REJECTED',
            reason: call.commercial.disputeReason || 'Unspecified',
            description: call.commercial.dispute?.description || null,
            resolution_notes: call.commercial.dispute?.resolution_notes || null,
            resolved_at: call.commercial.dispute?.resolved_at || null,
            created_at: call.commercial.dispute?.created_at || call.created_at,
            buyer: call.commercial.buyer || null,
            revenue: call.commercial.revenue ?? null,
            currency: call.commercial.currency || 'USD',
            adjustment: call.commercial.adjustment || null,
          });
        }
      }

      setDisputes(disputeList);
    } catch (err: any) {
      if (err?.message?.includes('403') || err?.message?.toLowerCase().includes('forbidden')) {
        setError('Access denied: You do not have permission to view commercial disputes.');
      } else {
        setError(err?.message || 'Failed to load disputes.');
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      loadDisputes();
    }
  }, [workspaceId, loadDisputes]);

  async function handleConfirmResolution() {
    if (!workspaceId || !resolvingDispute || !resolveAction) return;

    setIsSubmittingResolution(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/disputes/${resolvingDispute.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          status: resolveAction,
          resolution_notes: resolutionNotes.trim() || undefined,
        }),
      });

      setActionSuccess(`Dispute for call ${resolvingDispute.call_id.slice(0, 8)} successfully ${resolveAction.toLowerCase()}.`);
      setResolvingDispute(null);
      setResolveAction(null);
      setResolutionNotes('');
      await loadDisputes();
    } catch (err: any) {
      setActionError(err?.message || `Failed to ${resolveAction.toLowerCase()} dispute.`);
    } finally {
      setIsSubmittingResolution(false);
    }
  }

  const filteredDisputes = useMemo(() => {
    if (statusFilter === 'ALL') return disputes;
    return disputes.filter((d) => d.status === statusFilter);
  }, [disputes, statusFilter]);

  // If vendor role detected or 403 error explicitly returned
  if (userRole?.isVendor || (error && error.includes('Access denied'))) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Scale className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Disputes</h1>
        </div>
        <Card className="border-error/20 bg-error-muted/20">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-destructive" />
              <CardTitle className="text-base text-destructive">Access Restricted</CardTitle>
            </div>
            <CardDescription className="text-foreground/80 pt-2">
              Vendor participants are strictly isolated from buyer commercial disputes. You do not have permission to view or manage disputes in this workspace.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Commercial Disputes</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Review, file, and resolve commercial disputes on buyer call records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadDisputes}
            disabled={loading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="bg-success-muted text-success-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <Card>
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Filter by Status</span>
          </div>
          <div className="flex items-center gap-1">
            {(['ALL', 'PENDING', 'ACCEPTED', 'REJECTED'] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={statusFilter === status ? 'primary' : 'ghost'}
                className="h-7 text-xs px-2.5"
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading commercial disputes...
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-destructive flex flex-col items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          ) : filteredDisputes.length === 0 ? (
            <EmptyState
              title={statusFilter === 'ALL' ? 'No disputes found' : `No ${statusFilter.toLowerCase()} disputes`}
              description={
                statusFilter === 'ALL'
                  ? 'No commercial disputes have been filed in this workspace yet.'
                  : `There are currently no disputes with status ${statusFilter}.`
              }
              icon={<Scale className="h-6 w-6" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Call ID</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Filed Date</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDisputes.map((dispute) => (
                  <TableRow key={dispute.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/protected/calls/${dispute.call_id}?workspace=${workspaceId}`}
                        className="text-primary hover:underline"
                        title={dispute.call_id}
                      >
                        {dispute.call_id.slice(0, 8)}...
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {dispute.buyer?.name || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          dispute.status === 'ACCEPTED'
                            ? 'error'
                            : dispute.status === 'PENDING'
                            ? 'warning'
                            : 'outline'
                        }
                        className="text-[10px]"
                      >
                        {dispute.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={dispute.reason}>
                      {dispute.reason}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(dispute.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">
                      {formatCurrency(dispute.revenue, dispute.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/protected/calls/${dispute.call_id}?workspace=${workspaceId}`}
                          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          View
                        </Link>

                        {dispute.status === 'PENDING' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label="Accept dispute"
                              className="h-7 px-2 text-xs text-emerald-600 border-emerald-500/30 hover:bg-emerald-50"
                              onClick={() => {
                                setResolvingDispute(dispute);
                                setResolveAction('ACCEPTED');
                                setResolutionNotes('');
                                setActionError(null);
                              }}
                              disabled={isSubmittingResolution}
                            >
                              <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label="Reject dispute"
                              className="h-7 px-2 text-xs text-rose-600 border-rose-500/30 hover:bg-rose-50"
                              onClick={() => {
                                setResolvingDispute(dispute);
                                setResolveAction('REJECTED');
                                setResolutionNotes('');
                                setActionError(null);
                              }}
                              disabled={isSubmittingResolution}
                            >
                              <X className="w-3.5 h-3.5 mr-1 text-rose-600" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Resolution */}
      <ConfirmDialog
        open={resolvingDispute !== null && resolveAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResolvingDispute(null);
            setResolveAction(null);
            setResolutionNotes('');
          }
        }}
        title={resolveAction === 'ACCEPTED' ? 'Accept Dispute' : 'Reject Dispute'}
        description={
          <div className="space-y-3 pt-2">
            <p className="text-sm text-foreground">
              {resolveAction === 'ACCEPTED'
                ? `Accepting dispute for call ${resolvingDispute?.call_id.slice(0, 8)} will reverse revenue and payout via a financial adjustment record.`
                : `Rejecting dispute for call ${resolvingDispute?.call_id.slice(0, 8)} will maintain original commercial accounting.`}
            </p>
            <div className="space-y-1">
              <Label htmlFor="res-notes" className="text-xs font-medium">Resolution Notes (Optional)</Label>
              <Input
                id="res-notes"
                placeholder="Internal notes or explanation for this resolution"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                disabled={isSubmittingResolution}
                className="h-8 text-xs"
              />
            </div>
          </div>
        }
        confirmText={resolveAction === 'ACCEPTED' ? 'Accept Dispute' : 'Reject Dispute'}
        cancelText="Cancel"
        onConfirm={handleConfirmResolution}
        isLoading={isSubmittingResolution}
        destructive={resolveAction === 'REJECTED'}
      />
    </div>
  );
}
