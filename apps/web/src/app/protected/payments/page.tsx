'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import {
  PaymentInstruction,
  listPaymentInstructions,
  createPaymentExecution,
  retryPaymentExecution,
} from '@/lib/payments';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  BadgeDollarSign,
  RefreshCw,
  Filter,
  Eye,
  Play,
  RotateCcw,
  AlertCircle,
  CheckCircle,
  X,
  ShieldAlert,
  ArrowUpDown,
} from 'lucide-react';

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

function formatDate(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  // Role and authorization state
  const [userRole, setUserRole] = useState<{
    role: string;
    participant_type?: string | null;
    permissions?: string[];
  } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // Data state
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterParticipantType, setFilterParticipantType] = useState<string>('');
  const [filterDirection, setFilterDirection] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // Execute confirmation modal state (OWNER only)
  const [executingInstruction, setExecutingInstruction] = useState<PaymentInstruction | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'manual' | 'wire' | 'mock'>('mock');
  const [isExecuting, setIsExecuting] = useState(false);

  // Retry confirmation modal state (OWNER only)
  const [retryingInstruction, setRetryingInstruction] = useState<PaymentInstruction | null>(null);
  const [retryProvider, setRetryProvider] = useState<'manual' | 'wire' | 'mock'>('mock');
  const [isRetrying, setIsRetrying] = useState(false);

  // Check workspace & user role authorization
  useEffect(() => {
    async function checkRole() {
      if (!workspaceId) {
        setAuthChecking(false);
        return;
      }
      setAuthChecking(true);
      setForbiddenError(null);
      try {
        const workspaces = await apiFetch('/workspaces');
        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === workspaceId)
          : null;

        if (!currentWs) {
          setForbiddenError('Workspace not found or access denied.');
          return;
        }

        const role = currentWs.role;
        const participantType = currentWs.participant_type;
        const permissions: string[] = currentWs.permissions || [];

        // BUYER and VENDOR participants strictly denied
        if (participantType === 'BUYER' || participantType === 'VENDOR') {
          setForbiddenError('403 Forbidden: Participants do not have access to payment resources.');
          return;
        }

        // VIEWER denied
        if (role === 'VIEWER') {
          setForbiddenError('403 Forbidden: Viewers do not have access to payment resources.');
          return;
        }

        // MEMBER only if explicitly authorized
        if (role === 'MEMBER' && !permissions.includes('payment:read')) {
          setForbiddenError('403 Forbidden: You do not have permission to view payments.');
          return;
        }

        setUserRole({
          role,
          participant_type: participantType || null,
          permissions,
        });
      } catch (err: any) {
        setForbiddenError(err?.message || 'Access denied.');
      } finally {
        setAuthChecking(false);
      }
    }

    checkRole();
  }, [workspaceId]);

  // Load instructions
  const loadInstructions = useCallback(async () => {
    if (!workspaceId || forbiddenError) return;
    setLoading(true);
    setError(null);

    try {
      const data = await listPaymentInstructions(workspaceId, {
        limit,
        offset,
        status: filterStatus || undefined,
        participant_type: filterParticipantType || undefined,
        direction: filterDirection || undefined,
      });

      setInstructions(data.items || []);
      setTotalCount(data.total || 0);
    } catch (err: any) {
      if (err?.message?.includes('403') || err?.status === 403) {
        setForbiddenError('403 Forbidden: You do not have permission to view payments.');
      } else {
        setError(err?.message || 'Failed to load payment instructions.');
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, forbiddenError, limit, offset, filterStatus, filterParticipantType, filterDirection]);

  useEffect(() => {
    if (!authChecking && !forbiddenError && workspaceId) {
      loadInstructions();
    }
  }, [authChecking, forbiddenError, workspaceId, loadInstructions]);

  // Handle Execute Payment (OWNER only)
  async function handleConfirmExecute() {
    if (!workspaceId || !executingInstruction || isExecuting) return;
    setIsExecuting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await createPaymentExecution(workspaceId, executingInstruction.id, {
        provider: selectedProvider,
      });
      setSuccessMessage(`Payment executed successfully for instruction ${executingInstruction.id}.`);
      setExecutingInstruction(null);
      await loadInstructions();
    } catch (err: any) {
      setError(err?.message || 'Failed to execute payment.');
    } finally {
      setIsExecuting(false);
    }
  }

  // Handle Retry Payment (OWNER only)
  async function handleConfirmRetry() {
    if (!workspaceId || !retryingInstruction || isRetrying) return;
    setIsRetrying(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await retryPaymentExecution(workspaceId, retryingInstruction.id, {
        provider: retryProvider,
      });
      setSuccessMessage(`Payment retry initiated for instruction ${retryingInstruction.id}.`);
      setRetryingInstruction(null);
      await loadInstructions();
    } catch (err: any) {
      setError(err?.message || 'Failed to retry payment execution.');
    } finally {
      setIsRetrying(false);
    }
  }

  const isOwner = userRole?.role === 'OWNER';

  const getStatusBadgeVariant = (status: string): "default" | "success" | "warning" | "error" | "info" | "outline" => {
    switch (status) {
      case 'SUCCEEDED':
        return 'success';
      case 'PROCESSING':
      case 'CREATED':
        return 'warning';
      case 'FAILED':
        return 'error';
      case 'CANCELED':
        return 'outline';
      default:
        return 'default';
    }
  };

  // Render Forbidden state
  if (forbiddenError) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto py-8">
        <Card className="border-error/20 bg-error/5">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-8 w-8 text-error" />
              <div>
                <CardTitle className="text-xl text-error">Access Forbidden</CardTitle>
                <CardDescription className="text-muted-foreground mt-1">
                  {forbiddenError}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BadgeDollarSign className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Payments</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Internal payment instruction lifecycle and settlement disbursement tracking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadInstructions}
            disabled={loading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="bg-success-muted text-success-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 text-success" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-error" />
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
            Filter Instructions
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setOffset(0);
              }}
              className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Statuses</option>
              <option value="CREATED">CREATED</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="SUCCEEDED">SUCCEEDED</option>
              <option value="FAILED">FAILED</option>
              <option value="CANCELED">CANCELED</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Participant Type</label>
            <select
              value={filterParticipantType}
              onChange={(e) => {
                setFilterParticipantType(e.target.value);
                setOffset(0);
              }}
              className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Participants</option>
              <option value="BUYER">BUYER</option>
              <option value="VENDOR">VENDOR</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Direction</label>
            <select
              value={filterDirection}
              onChange={(e) => {
                setFilterDirection(e.target.value);
                setOffset(0);
              }}
              className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Directions</option>
              <option value="COLLECTION">COLLECTION</option>
              <option value="PAYOUT">PAYOUT</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Instructions Table */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Payment Instructions ({totalCount})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && instructions.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Loading payment instructions...
            </div>
          ) : instructions.length === 0 ? (
            <EmptyState
              icon={<BadgeDollarSign className="w-6 h-6" />}
              title="No payment instructions"
              description="No payment instructions found matching the selected criteria."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instruction ID</TableHead>
                    <TableHead>Settlement Batch</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instructions.map((inst) => (
                    <TableRow key={inst.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        <Link
                          href={`/protected/payments/${inst.id}${workspaceId ? `?workspace=${workspaceId}` : ''}`}
                          className="text-primary hover:underline"
                        >
                          {inst.id}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {inst.settlement_batch?.batch_number || inst.settlement_batch_id}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">
                          {inst.participant_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant={inst.direction === 'COLLECTION' ? 'info' : 'default'}
                        >
                          {inst.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {formatCurrency(inst.amount, inst.currency)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={getStatusBadgeVariant(inst.status)}>
                          {inst.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(inst.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/protected/payments/${inst.id}${workspaceId ? `?workspace=${workspaceId}` : ''}`}
                          >
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              Details
                            </Button>
                          </Link>

                          {/* OWNER-only execution button when CREATED */}
                          {isOwner && inst.status === 'CREATED' && (
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setExecutingInstruction(inst)}
                              disabled={isExecuting}
                            >
                              <Play className="w-3.5 h-3.5 mr-1" />
                              Execute
                            </Button>
                          )}

                          {/* OWNER-only retry button when FAILED */}
                          {isOwner && inst.status === 'FAILED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-error border-error/30 hover:bg-error/10"
                              onClick={() => setRetryingInstruction(inst)}
                              disabled={isRetrying}
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              Retry
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal for Execute Payment (OWNER only) */}
      {executingInstruction && (
        <ConfirmDialog
          open={!!executingInstruction}
          onOpenChange={(open) => {
            if (!open && !isExecuting) setExecutingInstruction(null);
          }}
          title="Execute Payment Instruction"
          description={
            <span className="space-y-3 block text-left">
              <span className="block text-foreground">
                Confirm execution for settlement batch{' '}
                <strong className="font-mono">
                  {executingInstruction.settlement_batch?.batch_number || executingInstruction.settlement_batch_id}
                </strong>
                .
              </span>
              <span className="block text-xs text-muted-foreground">
                Participant: <strong>{executingInstruction.participant_type}</strong>
                <br />
                Direction: <strong>{executingInstruction.direction}</strong>
                <br />
                Amount:{' '}
                <strong className="text-foreground">
                  {formatCurrency(executingInstruction.amount, executingInstruction.currency)}
                </strong>
              </span>
              <span className="block pt-2">
                <label className="block text-xs font-medium text-foreground mb-1">
                  Internal Provider Mode:
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as any)}
                  className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="mock">mock (Internal Mock Provider)</option>
                  <option value="manual">manual (Manual Settlement Record)</option>
                  <option value="wire">wire (Simulated Wire Transfer)</option>
                </select>
              </span>
            </span>
          }
          confirmText="Confirm Execution"
          cancelText="Cancel"
          onConfirm={handleConfirmExecute}
          isLoading={isExecuting}
          destructive={false}
        />
      )}

      {/* Confirmation Modal for Retry Payment (OWNER only) */}
      {retryingInstruction && (
        <ConfirmDialog
          open={!!retryingInstruction}
          onOpenChange={(open) => {
            if (!open && !isRetrying) setRetryingInstruction(null);
          }}
          title="Retry Failed Payment"
          description={
            <span className="space-y-3 block text-left">
              <span className="block text-foreground">
                Retry payment execution for instruction{' '}
                <strong className="font-mono">{retryingInstruction.id}</strong>.
              </span>
              <span className="block text-xs text-muted-foreground">
                Amount:{' '}
                <strong className="text-foreground">
                  {formatCurrency(retryingInstruction.amount, retryingInstruction.currency)}
                </strong>
              </span>
              <span className="block pt-2">
                <label className="block text-xs font-medium text-foreground mb-1">
                  Internal Provider:
                </label>
                <select
                  value={retryProvider}
                  onChange={(e) => setRetryProvider(e.target.value as any)}
                  className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="mock">mock</option>
                  <option value="manual">manual</option>
                  <option value="wire">wire</option>
                </select>
              </span>
            </span>
          }
          confirmText="Retry Payment"
          cancelText="Cancel"
          onConfirm={handleConfirmRetry}
          isLoading={isRetrying}
          destructive={false}
        />
      )}
    </div>
  );
}
