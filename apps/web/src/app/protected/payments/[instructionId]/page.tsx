'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import {
  PaymentInstruction,
  PaymentExecution,
  getPaymentInstruction,
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
  ArrowLeft,
  RefreshCw,
  Play,
  RotateCcw,
  AlertCircle,
  CheckCircle,
  X,
  ShieldAlert,
  History,
  FileText,
  Clock,
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

export default function PaymentDetailPage() {
  const searchParams = useSearchParams();
  const params = useParams();
  const router = useRouter();

  const workspaceId = searchParams.get('workspace');
  const instructionId = params.instructionId as string;

  // Authorization & user role state
  const [userRole, setUserRole] = useState<{
    role: string;
    participant_type?: string | null;
    permissions?: string[];
  } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // Instruction data state
  const [instruction, setInstruction] = useState<PaymentInstruction | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // OWNER action modals
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'manual' | 'wire' | 'mock'>('mock');
  const [isExecuting, setIsExecuting] = useState(false);

  const [showRetryModal, setShowRetryModal] = useState(false);
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

  // Load instruction details
  const loadInstruction = useCallback(async () => {
    if (!workspaceId || !instructionId || forbiddenError) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const data = await getPaymentInstruction(workspaceId, instructionId);
      setInstruction(data);
    } catch (err: any) {
      if (err?.message?.includes('403') || err?.status === 403) {
        setForbiddenError('403 Forbidden: You do not have permission to view payments.');
      } else if (err?.message?.includes('404') || err?.status === 404) {
        setNotFound(true);
      } else {
        setError(err?.message || 'Failed to load payment instruction.');
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, instructionId, forbiddenError]);

  useEffect(() => {
    if (!authChecking && !forbiddenError && workspaceId && instructionId) {
      loadInstruction();
    }
  }, [authChecking, forbiddenError, workspaceId, instructionId, loadInstruction]);

  // Execute payment handler (OWNER only)
  async function handleConfirmExecute() {
    if (!workspaceId || !instruction || isExecuting) return;
    setIsExecuting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await createPaymentExecution(workspaceId, instruction.id, {
        provider: selectedProvider,
      });
      setSuccessMessage('Payment execution recorded successfully.');
      setShowExecuteModal(false);
      await loadInstruction();
    } catch (err: any) {
      setError(err?.message || 'Failed to execute payment.');
    } finally {
      setIsExecuting(false);
    }
  }

  // Retry payment handler (OWNER only)
  async function handleConfirmRetry() {
    if (!workspaceId || !instruction || isRetrying) return;
    setIsRetrying(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await retryPaymentExecution(workspaceId, instruction.id, {
        provider: retryProvider,
      });
      setSuccessMessage('Payment retry initiated successfully.');
      setShowRetryModal(false);
      await loadInstruction();
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
      case 'INITIATED':
        return 'warning';
      case 'FAILED':
        return 'error';
      case 'CANCELED':
        return 'outline';
      default:
        return 'default';
    }
  };

  // Forbidden State
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

  // Not Found State
  if (notFound) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Payment Instruction Not Found</CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Payment instruction with ID &quot;{instructionId}&quot; does not exist in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/protected/payments${workspaceId ? `?workspace=${workspaceId}` : ''}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Payments
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href={`/protected/payments${workspaceId ? `?workspace=${workspaceId}` : ''}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Payments
        </Link>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadInstruction}
            disabled={loading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* OWNER Actions */}
          {isOwner && instruction?.status === 'CREATED' && (
            <Button
              size="sm"
              onClick={() => setShowExecuteModal(true)}
              disabled={isExecuting}
              className="h-8 text-xs"
            >
              <Play className="w-3.5 h-3.5 mr-1.5" />
              Execute Payment
            </Button>
          )}

          {isOwner && instruction?.status === 'FAILED' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRetryModal(true)}
              disabled={isRetrying}
              className="h-8 text-xs text-error border-error/30 hover:bg-error/10"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Retry Payment
            </Button>
          )}
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

      {/* Instruction Header Card */}
      {instruction && (
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg font-bold font-mono">
                    {instruction.id}
                  </CardTitle>
                  <Badge variant={getStatusBadgeVariant(instruction.status)}>
                    {instruction.status}
                  </Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground mt-1">
                  Settlement Batch:{' '}
                  <span className="font-mono font-medium text-foreground">
                    {instruction.settlement_batch?.batch_number || instruction.settlement_batch_id}
                  </span>
                </CardDescription>
              </div>

              <div className="text-right">
                <div className="text-2xl font-bold text-foreground">
                  {formatCurrency(instruction.amount, instruction.currency)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {instruction.currency} &bull; {instruction.direction}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block">Participant Type</span>
              <span className="font-semibold text-foreground">{instruction.participant_type}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Direction</span>
              <span className="font-semibold text-foreground">{instruction.direction}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Created At</span>
              <span className="text-foreground">{formatDate(instruction.created_at)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Updated At</span>
              <span className="text-foreground">{formatDate(instruction.updated_at)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution History (Append-Only Attempts) */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">
              Execution History ({instruction?.executions?.length || 0} attempts)
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            Append-only audit trail of all payment execution attempts for this instruction.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!instruction?.executions || instruction.executions.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No execution attempts recorded for this payment instruction yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Initiated At</TableHead>
                    <TableHead>Completed At</TableHead>
                    {isOwner && <TableHead>Provider Reference</TableHead>}
                    <TableHead>Details / Failure Code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instruction.executions.map((exec, idx) => (
                    <TableRow key={exec.id || idx}>
                      <TableCell className="font-medium text-xs">
                        #{exec.attempt_number || idx + 1}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{exec.provider}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={getStatusBadgeVariant(exec.status)}>
                          {exec.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(exec.initiated_at || exec.created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(exec.completed_at)}
                      </TableCell>
                      {isOwner && (
                        <TableCell className="text-xs font-mono">
                          {exec.provider_transaction_id || '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-muted-foreground">
                        {exec.failure_code ? (
                          <span className="text-error font-medium">
                            [{exec.failure_code}] {exec.error_message || ''}
                          </span>
                        ) : exec.error_message ? (
                          <span className="text-error">{exec.error_message}</span>
                        ) : (
                          '—'
                        )}
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
      {instruction && (
        <ConfirmDialog
          open={showExecuteModal}
          onOpenChange={(open) => {
            if (!open && !isExecuting) setShowExecuteModal(false);
          }}
          title="Confirm Payment Execution"
          description={
            <span className="space-y-3 block text-left">
              <span className="block text-foreground">
                You are about to execute disbursement for batch{' '}
                <strong className="font-mono">
                  {instruction.settlement_batch?.batch_number || instruction.settlement_batch_id}
                </strong>
                .
              </span>
              <span className="block text-xs text-muted-foreground">
                Participant: <strong>{instruction.participant_type}</strong>
                <br />
                Direction: <strong>{instruction.direction}</strong>
                <br />
                Authoritative Amount:{' '}
                <strong className="text-foreground">
                  {formatCurrency(instruction.amount, instruction.currency)}
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
      {instruction && (
        <ConfirmDialog
          open={showRetryModal}
          onOpenChange={(open) => {
            if (!open && !isRetrying) setShowRetryModal(false);
          }}
          title="Confirm Payment Retry"
          description={
            <span className="space-y-3 block text-left">
              <span className="block text-foreground">
                Retry execution for instruction{' '}
                <strong className="font-mono">{instruction.id}</strong>.
              </span>
              <span className="block text-xs text-muted-foreground">
                Amount:{' '}
                <strong className="text-foreground">
                  {formatCurrency(instruction.amount, instruction.currency)}
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
