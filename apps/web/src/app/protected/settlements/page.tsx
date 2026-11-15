'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Receipt,
  Eye,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Filter,
  PlusCircle,
  X,
  FileText,
  Clock,
  ArrowRight
} from 'lucide-react';

export interface SettlementBatchItem {
  id: string;
  batch_number: string;
  workspace_id: string;
  participant_type: 'BUYER' | 'VENDOR';
  buyer_id?: string | null;
  vendor_id?: string | null;
  currency: string;
  period_start: string;
  period_end: string;
  gross_amount: string | number;
  adjustments_amount: string | number;
  net_amount: string | number;
  item_count: number;
  settlement_status: string;
  payment_status: string;
  reconciliation_status: string;
  finalized_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  buyer?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
}

export interface SettlementLineItem {
  id: string;
  settlement_batch_id: string;
  call_commercial_id: string;
  participant_type: 'BUYER' | 'VENDOR';
  amount: string | number;
  currency: string;
  created_at: string;
  commercial?: {
    id: string;
    call_id: string;
    revenue?: number;
    payout?: number;
    status: string;
    qualified: boolean;
    converted: boolean;
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

function formatPeriodDate(isoString: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

export default function SettlementsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);
  const requestGenRef = useRef(0);

  // Batches state
  const [batches, setBatches] = useState<SettlementBatchItem[]>([]);
  const [totalBatches, setTotalBatches] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    requestGenRef.current++;
    setBatches([]);
    setTotalBatches(0);
    setSelectedBatch(null);
    setBatchItems([]);
    setError(null);
    setItemsError(null);
  }, [workspaceId]);

  // Filters state
  const [filterParticipantType, setFilterParticipantType] = useState<string>('');
  const [filterSettlementStatus, setFilterSettlementStatus] = useState<string>('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<string>('');
  const [filterReconciliationStatus, setFilterReconciliationStatus] = useState<string>('');
  const [filterPeriodStart, setFilterPeriodStart] = useState<string>('');
  const [filterPeriodEnd, setFilterPeriodEnd] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // Selected batch for detail modal/sheet
  const [selectedBatch, setSelectedBatch] = useState<SettlementBatchItem | null>(null);
  const [batchItems, setBatchItems] = useState<SettlementLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // User role context
  const [userRole, setUserRole] = useState<{ role: string; participant_type?: string | null } | null>(null);

  // Generation modal state (OWNER-only)
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateParticipantType, setGenerateParticipantType] = useState<'BUYER' | 'VENDOR'>('BUYER');
  const [generatePeriodStart, setGeneratePeriodStart] = useState('');
  const [generatePeriodEnd, setGeneratePeriodEnd] = useState('');
  const [generateParticipantId, setGenerateParticipantId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);

  // Determine user workspace role & participant type
  useEffect(() => {
    async function checkRole() {
      if (!workspaceId) return;
      try {
        const workspaces = await apiFetch('/workspaces');
        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === workspaceId)
          : null;
        if (currentWs) {
          setUserRole({
            role: currentWs.role,
            participant_type: currentWs.participant_type || null,
          });
        }
      } catch {
        // Fall back gracefully
      }
    }
    checkRole();
  }, [workspaceId]);

  // Load settlement batches with active filters
  const loadBatches = useCallback(async () => {
    if (!workspaceId) return;
    const targetWs = workspaceId;
    const currentGen = ++requestGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();
      query.set('limit', String(limit));
      query.set('offset', String(offset));

      if (filterParticipantType) query.set('participant_type', filterParticipantType);
      if (filterSettlementStatus) query.set('settlement_status', filterSettlementStatus);
      if (filterPaymentStatus) query.set('payment_status', filterPaymentStatus);
      if (filterReconciliationStatus) query.set('reconciliation_status', filterReconciliationStatus);
      if (filterPeriodStart) query.set('period_start', new Date(filterPeriodStart).toISOString());
      if (filterPeriodEnd) query.set('period_end', new Date(filterPeriodEnd).toISOString());

      const data = await apiFetch(`/workspaces/${workspaceId}/settlements/batches?${query.toString()}`);
      if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
        return;
      }
      setBatches(data?.batches || data?.items || []);
      setTotalBatches(data?.total || 0);
    } catch (err: any) {
      if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
        return;
      }
      setError(err?.message || 'Failed to load settlement batches.');
    } finally {
      if (currentGen === requestGenRef.current && targetWs === currentWorkspaceIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    workspaceId,
    limit,
    offset,
    filterParticipantType,
    filterSettlementStatus,
    filterPaymentStatus,
    filterReconciliationStatus,
    filterPeriodStart,
    filterPeriodEnd
  ]);

  useEffect(() => {
    if (workspaceId) {
      loadBatches();
    }
  }, [workspaceId, loadBatches]);

  // Load items when a batch is selected
  async function handleSelectBatch(batch: SettlementBatchItem) {
    if (!workspaceId) return;
    const targetWs = workspaceId;
    setSelectedBatch(batch);
    setLoadingItems(true);
    setItemsError(null);
    setBatchItems([]);

    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/settlements/batches/${batch.id}/items?limit=100`);
      if (targetWs === currentWorkspaceIdRef.current) {
        setBatchItems(data?.items || []);
      }
    } catch (err: any) {
      if (targetWs === currentWorkspaceIdRef.current) {
        setItemsError(err?.message || 'Failed to load settlement items.');
      }
    } finally {
      if (targetWs === currentWorkspaceIdRef.current) {
        setLoadingItems(false);
      }
    }
  }

  // Handle Owner settlement generation submission
  async function handleGenerateBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;

    if (!generatePeriodStart || !generatePeriodEnd) {
      setGenerateError('Both period start and period end are required.');
      return;
    }

    const startDate = new Date(generatePeriodStart);
    const endDate = new Date(generatePeriodEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setGenerateError('Invalid date format for period boundaries.');
      return;
    }

    if (startDate >= endDate) {
      setGenerateError('Period start must be before period end.');
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(null);

    const body: any = {
      participant_type: generateParticipantType,
      period_start: startDate.toISOString(),
      period_end: endDate.toISOString(),
    };

    if (generateParticipantId.trim()) {
      if (generateParticipantType === 'BUYER') {
        body.buyer_id = generateParticipantId.trim();
      } else {
        body.vendor_id = generateParticipantId.trim();
      }
    }

    try {
      const result = await apiFetch(`/workspaces/${workspaceId}/settlements/batches/generate`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const batchCount = result?.batches?.length ?? 1;
      setGenerateSuccess(`Settlement generation completed successfully (${batchCount} batch(es) processed).`);
      setShowGenerateModal(false);
      setGeneratePeriodStart('');
      setGeneratePeriodEnd('');
      setGenerateParticipantId('');
      await loadBatches();
    } catch (err: any) {
      setGenerateError(err?.message || 'Failed to generate settlement batch.');
    } finally {
      setIsGenerating(false);
    }
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'CLOSED':
      case 'SUCCEEDED':
      case 'RECONCILED':
        return 'success';
      case 'PENDING':
      case 'PROCESSING':
      case 'DRAFT':
        return 'warning';
      case 'FAILED':
      case 'DISCREPANCY':
        return 'error';
      default:
        return 'outline';
    }
  };

  // OWNER-only generation rule: Owner role required regardless of permission assignment
  const canGenerate = userRole?.role === 'OWNER';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Settlements</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Review commercial settlement batches, financial periods, and line items.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadBatches}
            disabled={loading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {canGenerate && (
            <Button
              size="sm"
              onClick={() => {
                setShowGenerateModal(true);
                setGenerateError(null);
                setGenerateSuccess(null);
              }}
              className="h-8 text-xs"
            >
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
              Generate Batch
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {generateSuccess && (
        <div className="bg-success-muted text-success-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{generateSuccess}</span>
          </div>
          <button onClick={() => setGenerateSuccess(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            Batch Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Participant Type (Only if user is Owner/Admin) */}
            {userRole?.role === 'OWNER' || userRole?.role === 'ADMIN' ? (
              <div className="space-y-1">
                <Label htmlFor="filter-participant-type" className="text-xs">Participant Type</Label>
                <select
                  id="filter-participant-type"
                  value={filterParticipantType}
                  onChange={(e) => {
                    setFilterParticipantType(e.target.value);
                    setOffset(0);
                  }}
                  className="w-full text-xs h-8 rounded-md border border-border bg-surface px-2.5"
                >
                  <option value="">All Types</option>
                  <option value="BUYER">Buyer</option>
                  <option value="VENDOR">Vendor</option>
                </select>
              </div>
            ) : null}

            {/* Settlement Status */}
            <div className="space-y-1">
              <Label htmlFor="filter-settlement-status" className="text-xs">Settlement Status</Label>
              <select
                id="filter-settlement-status"
                value={filterSettlementStatus}
                onChange={(e) => {
                  setFilterSettlementStatus(e.target.value);
                  setOffset(0);
                }}
                className="w-full text-xs h-8 rounded-md border border-border bg-surface px-2.5"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PENDING">Pending</option>
                <option value="FINALIZED">Finalized</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>

            {/* Payment Status */}
            <div className="space-y-1">
              <Label htmlFor="filter-payment-status" className="text-xs">Payment Status</Label>
              <select
                id="filter-payment-status"
                value={filterPaymentStatus}
                onChange={(e) => {
                  setFilterPaymentStatus(e.target.value);
                  setOffset(0);
                }}
                className="w-full text-xs h-8 rounded-md border border-border bg-surface px-2.5"
              >
                <option value="">All Payment States</option>
                <option value="UNPROCESSED">Unprocessed</option>
                <option value="PROCESSING">Processing</option>
                <option value="SUCCEEDED">Succeeded</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>

            {/* Reconciliation Status */}
            <div className="space-y-1">
              <Label htmlFor="filter-reconciliation-status" className="text-xs">Reconciliation Status</Label>
              <select
                id="filter-reconciliation-status"
                value={filterReconciliationStatus}
                onChange={(e) => {
                  setFilterReconciliationStatus(e.target.value);
                  setOffset(0);
                }}
                className="w-full text-xs h-8 rounded-md border border-border bg-surface px-2.5"
              >
                <option value="">All Reconciliation States</option>
                <option value="UNRECONCILED">Unreconciled</option>
                <option value="RECONCILED">Reconciled</option>
                <option value="DISCREPANCY">Discrepancy</option>
              </select>
            </div>

            {/* Period Start */}
            <div className="space-y-1">
              <Label htmlFor="filter-period-start" className="text-xs">Period Start</Label>
              <Input
                id="filter-period-start"
                type="date"
                value={filterPeriodStart}
                onChange={(e) => {
                  setFilterPeriodStart(e.target.value);
                  setOffset(0);
                }}
                className="h-8 text-xs"
              />
            </div>

            {/* Period End */}
            <div className="space-y-1">
              <Label htmlFor="filter-period-end" className="text-xs">Period End</Label>
              <Input
                id="filter-period-end"
                type="date"
                value={filterPeriodEnd}
                onChange={(e) => {
                  setFilterPeriodEnd(e.target.value);
                  setOffset(0);
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settlement Batches Table */}
      <Card>
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Settlement Batches</CardTitle>
          <span className="text-xs text-muted-foreground">{totalBatches} total batch(es)</span>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading settlement batches...
            </div>
          ) : error ? null : batches.length === 0 ? (
            <EmptyState
              title="No settlement batches found"
              description="No settlement batches have been generated or matched the selected filters."
              icon={<Receipt className="h-6 w-6" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Batch Number</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Gross Amount</TableHead>
                  <TableHead className="text-right">Net Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs font-medium">
                      {batch.batch_number}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">
                          {batch.participant_type === 'BUYER' ? 'Buyer Settlement' : 'Vendor Settlement'}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {batch.buyer_id ? `Buyer: ${batch.buyer_id.slice(0, 8)}...` : batch.vendor_id ? `Vendor: ${batch.vendor_id.slice(0, 8)}...` : 'Workspace-wide'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex flex-col font-mono text-[11px]">
                        <span>From: {new Date(batch.period_start).toLocaleDateString()}</span>
                        <span>To: {new Date(batch.period_end).toLocaleDateString()}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={getStatusBadgeVariant(batch.settlement_status)} className="text-[10px] w-fit">
                          {batch.settlement_status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          Pay: {batch.payment_status}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">
                      {batch.item_count}
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono text-muted-foreground">
                      {formatCurrency(batch.gross_amount, batch.currency)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold text-foreground">
                      {formatCurrency(batch.net_amount, batch.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleSelectBatch(batch)}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        View Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination Controls */}
          {totalBatches > limit && (
            <div className="flex items-center justify-between border-t border-border pt-4 mt-4 text-xs text-muted-foreground">
              <span>
                Showing {offset + 1} to {Math.min(offset + limit, totalBatches)} of {totalBatches}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="h-7 text-xs"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + limit >= totalBatches}
                  onClick={() => setOffset(offset + limit)}
                  className="h-7 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settlement Detail Modal / Drawer */}
      {selectedBatch && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl animate-in fade-in duration-200">
            <CardHeader className="border-b border-border flex flex-row items-center justify-between py-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-primary" />
                  <CardTitle className="text-base font-bold">
                    Batch: {selectedBatch.batch_number}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  {selectedBatch.participant_type} settlement period details and attached line items
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setSelectedBatch(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>

            <div className="overflow-y-auto p-6 space-y-6 flex-1">
              {/* Batch Summary Header Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">Gross Settlement</span>
                  <p className="text-base font-mono font-bold text-foreground mt-1">
                    {formatCurrency(selectedBatch.gross_amount, selectedBatch.currency)}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">Adjustments</span>
                  <p className="text-base font-mono font-bold text-foreground mt-1">
                    {formatCurrency(selectedBatch.adjustments_amount, selectedBatch.currency)}
                  </p>
                </div>
                <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">Net Settlement</span>
                  <p className="text-base font-mono font-bold text-emerald-600 mt-1">
                    {formatCurrency(selectedBatch.net_amount, selectedBatch.currency)}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">Line Items</span>
                  <p className="text-base font-mono font-bold text-foreground mt-1">
                    {selectedBatch.item_count} items
                  </p>
                </div>
              </div>

              {/* Canonical Period & Status Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border border-border rounded-lg p-4 bg-muted/10">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Period Boundaries [start, end)</span>
                  </div>
                  <p className="font-mono text-foreground">
                    Start: {formatPeriodDate(selectedBatch.period_start)}
                  </p>
                  <p className="font-mono text-foreground">
                    End: {formatPeriodDate(selectedBatch.period_end)}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-muted-foreground font-medium">Lifecycle States</span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant={getStatusBadgeVariant(selectedBatch.settlement_status)} className="text-[10px]">
                      Settlement: {selectedBatch.settlement_status}
                    </Badge>
                    <Badge variant={getStatusBadgeVariant(selectedBatch.payment_status)} className="text-[10px]">
                      Payment: {selectedBatch.payment_status}
                    </Badge>
                    <Badge variant={getStatusBadgeVariant(selectedBatch.reconciliation_status)} className="text-[10px]">
                      Reconciliation: {selectedBatch.reconciliation_status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Settlement Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Settlement Line Items
                  </h4>
                  <span className="text-xs text-muted-foreground">{batchItems.length} loaded</span>
                </div>

                {loadingItems ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    Loading settlement line items...
                  </div>
                ) : itemsError ? (
                  <div className="py-6 text-center text-xs text-destructive flex items-center justify-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span>{itemsError}</span>
                  </div>
                ) : batchItems.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground bg-muted/20 rounded-md border border-dashed border-border">
                    No individual line items found in this settlement batch.
                  </div>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[140px]">Item ID</TableHead>
                          <TableHead>Call / Commercial</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Settlement Amount</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {batchItems.map((item) => (
                          <TableRow key={item.id} className="text-xs">
                            <TableCell className="font-mono text-muted-foreground">
                              {item.id.slice(0, 8)}...
                            </TableCell>
                            <TableCell className="font-mono">
                              {item.commercial?.call_id ? (
                                <Link
                                  href={`/protected/calls/${item.commercial.call_id}?workspace=${workspaceId}`}
                                  className="text-primary hover:underline"
                                >
                                  Call: {item.commercial.call_id.slice(0, 8)}...
                                </Link>
                              ) : (
                                item.call_commercial_id.slice(0, 8) + '...'
                              )}
                            </TableCell>
                            <TableCell>
                              {item.commercial?.status ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {item.commercial.status}
                                </Badge>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold">
                              {formatCurrency(item.amount, item.currency)}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.commercial?.call_id && (
                                <Link
                                  href={`/protected/calls/${item.commercial.call_id}?workspace=${workspaceId}`}
                                  className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </Link>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-border flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedBatch(null)}
                className="h-8 text-xs"
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Owner-Only Settlement Generation Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg shadow-xl animate-in fade-in duration-200">
            <CardHeader className="border-b border-border flex flex-row items-center justify-between py-4">
              <div className="space-y-1">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <PlusCircle className="w-4 h-4 text-primary" />
                  Generate Settlement Batch
                </CardTitle>
                <CardDescription className="text-xs">
                  Generate periodic settlements for finalized commercial calls (Owner exclusive).
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setShowGenerateModal(false)}
                disabled={isGenerating}
              >
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>

            <form onSubmit={handleGenerateBatch}>
              <CardContent className="pt-4 space-y-4">
                {generateError && (
                  <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{generateError}</span>
                  </div>
                )}

                {/* Participant Type */}
                <div className="space-y-1.5">
                  <Label htmlFor="gen-type" className="text-xs font-semibold">Participant Type *</Label>
                  <select
                    id="gen-type"
                    value={generateParticipantType}
                    onChange={(e) => setGenerateParticipantType(e.target.value as 'BUYER' | 'VENDOR')}
                    disabled={isGenerating}
                    className="w-full text-xs h-8 rounded-md border border-border bg-surface px-2.5"
                  >
                    <option value="BUYER">Buyer Settlements</option>
                    <option value="VENDOR">Vendor Settlements</option>
                  </select>
                </div>

                {/* Period Start */}
                <div className="space-y-1.5">
                  <Label htmlFor="gen-start" className="text-xs font-semibold">Period Start (UTC) *</Label>
                  <Input
                    id="gen-start"
                    type="datetime-local"
                    value={generatePeriodStart}
                    onChange={(e) => setGeneratePeriodStart(e.target.value)}
                    disabled={isGenerating}
                    required
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">Inclusive start boundary of the settlement period.</p>
                </div>

                {/* Period End */}
                <div className="space-y-1.5">
                  <Label htmlFor="gen-end" className="text-xs font-semibold">Period End (UTC) *</Label>
                  <Input
                    id="gen-end"
                    type="datetime-local"
                    value={generatePeriodEnd}
                    onChange={(e) => setGeneratePeriodEnd(e.target.value)}
                    disabled={isGenerating}
                    required
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">Exclusive end boundary of the settlement period.</p>
                </div>

                {/* Specific Participant ID (Optional) */}
                <div className="space-y-1.5">
                  <Label htmlFor="gen-id" className="text-xs font-semibold">
                    {generateParticipantType === 'BUYER' ? 'Buyer ID (Optional)' : 'Vendor ID (Optional)'}
                  </Label>
                  <Input
                    id="gen-id"
                    placeholder="Leave empty to generate across all workspace participants"
                    value={generateParticipantId}
                    onChange={(e) => setGenerateParticipantId(e.target.value)}
                    disabled={isGenerating}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </CardContent>

              <div className="p-4 border-t border-border flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGenerateModal(false)}
                  disabled={isGenerating}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  isLoading={isGenerating}
                  disabled={isGenerating}
                  className="h-8 text-xs"
                >
                  Confirm Generate
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
