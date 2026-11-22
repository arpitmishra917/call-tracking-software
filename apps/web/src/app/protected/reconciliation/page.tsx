'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import {
  ReconciliationRun,
  listReconciliationRuns,
  runWorkspaceReconciliation,
  runBatchReconciliation,
} from '@/lib/reconciliation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import {
  FileCheck2,
  RefreshCw,
  Filter,
  Eye,
  Play,
  Layers,
  AlertCircle,
  CheckCircle,
  X,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react';

function formatDate(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

export default function ReconciliationPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);

  // Clear previous workspace state immediately when workspace changes
  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    setRuns([]);
    setTotalCount(0);
    setError(null);
    setForbiddenError(null);
    setSuccessMessage(null);
    setUserRole(null);
  }, [workspaceId]);

  // Authorization and role state
  const [userRole, setUserRole] = useState<{
    role: string;
    participant_type?: string | null;
    permissions?: string[];
  } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // Data state
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Render-time workspace identity guard: eliminate stale data rendering during workspace transitions
  const isWorkspaceStale = currentWorkspaceIdRef.current !== workspaceId;
  const activeRuns = isWorkspaceStale ? [] : runs;
  const activeTotalCount = isWorkspaceStale ? 0 : totalCount;
  const isLoading = loading || isWorkspaceStale;

  // Filters
  const [filterRunType, setFilterRunType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // Workspace reconciliation confirmation modal state (OWNER only)
  const [showWorkspaceReconModal, setShowWorkspaceReconModal] = useState(false);
  const [isExecutingWorkspaceRecon, setIsExecutingWorkspaceRecon] = useState(false);

  // Batch reconciliation modal state (OWNER only)
  const [showBatchReconModal, setShowBatchReconModal] = useState(false);
  const [batchIdToReconcile, setBatchIdToReconcile] = useState('');
  const [isExecutingBatchRecon, setIsExecutingBatchRecon] = useState(false);
  const [batchReconError, setBatchReconError] = useState<string | null>(null);

  // Check workspace & user role authorization
  useEffect(() => {
    async function checkRole() {
      if (!workspaceId) {
        setAuthChecking(false);
        return;
      }
      const targetWsId = workspaceId;
      setAuthChecking(true);
      setForbiddenError(null);
      try {
        const workspaces = await apiFetch('/workspaces');
        if (currentWorkspaceIdRef.current !== targetWsId) return;

        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === targetWsId)
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
          setForbiddenError('403 Forbidden: Participants do not have access to reconciliation resources.');
          return;
        }

        // VIEWER denied
        if (role === 'VIEWER') {
          setForbiddenError('403 Forbidden: Viewers do not have access to reconciliation resources.');
          return;
        }

        // MEMBER only if explicitly authorized
        if (role === 'MEMBER' && !permissions.includes('reconciliation:read')) {
          setForbiddenError('403 Forbidden: You do not have permission to view reconciliation.');
          return;
        }

        setUserRole({
          role,
          participant_type: participantType || null,
          permissions,
        });
      } catch (err: any) {
        if (currentWorkspaceIdRef.current !== targetWsId) return;
        setForbiddenError(err?.message || 'Access denied.');
      } finally {
        if (currentWorkspaceIdRef.current === targetWsId) {
          setAuthChecking(false);
        }
      }
    }

    checkRole();
  }, [workspaceId]);

  // Load reconciliation runs
  const loadRuns = useCallback(async () => {
    if (!workspaceId || forbiddenError) return;
    const targetWsId = workspaceId;
    setLoading(true);
    setError(null);

    try {
      const data = await listReconciliationRuns(targetWsId, {
        limit,
        offset,
        run_type: filterRunType || undefined,
        status: filterStatus || undefined,
      });
      if (currentWorkspaceIdRef.current !== targetWsId) return;

      setRuns(data.items || []);
      setTotalCount(data.total || 0);
    } catch (err: any) {
      if (currentWorkspaceIdRef.current !== targetWsId) return;
      if (err?.message?.includes('403') || err?.status === 403) {
        setForbiddenError('403 Forbidden: You do not have permission to view reconciliation.');
      } else {
        setError(err?.message || 'Failed to load reconciliation runs.');
      }
    } finally {
      if (currentWorkspaceIdRef.current === targetWsId) {
        setLoading(false);
      }
    }
  }, [workspaceId, forbiddenError, limit, offset, filterRunType, filterStatus]);

  useEffect(() => {
    if (!authChecking && !forbiddenError && workspaceId) {
      loadRuns();
    }
  }, [authChecking, forbiddenError, workspaceId, loadRuns]);

  // Handle Run Workspace Reconciliation (OWNER only)
  async function handleConfirmWorkspaceRecon() {
    if (!workspaceId || isExecutingWorkspaceRecon) return;
    setIsExecutingWorkspaceRecon(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const run = await runWorkspaceReconciliation(workspaceId);
      setSuccessMessage(
        `Workspace reconciliation completed. Status: ${run.status}. Checked: ${run.items_checked}, Discrepancies: ${run.discrepancy_count}.`
      );
      setShowWorkspaceReconModal(false);
      await loadRuns();
    } catch (err: any) {
      setError(err?.message || 'Failed to run workspace reconciliation.');
    } finally {
      setIsExecutingWorkspaceRecon(false);
    }
  }

  // Handle Run Batch Reconciliation (OWNER only)
  async function handleSubmitBatchRecon(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !batchIdToReconcile.trim() || isExecutingBatchRecon) return;
    setIsExecutingBatchRecon(true);
    setBatchReconError(null);
    setError(null);
    setSuccessMessage(null);

    try {
      const run = await runBatchReconciliation(workspaceId, batchIdToReconcile.trim());
      setSuccessMessage(
        `Batch reconciliation completed for batch ${batchIdToReconcile.trim()}. Status: ${run.status}. Discrepancies: ${run.discrepancy_count}.`
      );
      setShowBatchReconModal(false);
      setBatchIdToReconcile('');
      await loadRuns();
    } catch (err: any) {
      setBatchReconError(err?.message || 'Failed to run batch reconciliation.');
    } finally {
      setIsExecutingBatchRecon(false);
    }
  }

  const isOwner = userRole?.role === 'OWNER';

  const getStatusBadgeVariant = (status: string): "default" | "success" | "warning" | "error" | "info" | "outline" => {
    switch (status) {
      case 'RECONCILED':
        return 'success';
      case 'UNRECONCILED':
        return 'warning';
      case 'DISCREPANCY':
        return 'error';
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
            <FileCheck2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Reconciliation</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Audit commercial accounting integrity against settlement batches and payment disbursements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadRuns}
            disabled={isLoading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* OWNER-only controls */}
          {isOwner && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowBatchReconModal(true);
                  setBatchReconError(null);
                }}
                className="h-8 text-xs"
              >
                <Layers className="w-3.5 h-3.5 mr-1.5" />
                Run Batch Reconciliation
              </Button>

              <Button
                size="sm"
                onClick={() => setShowWorkspaceReconModal(true)}
                className="h-8 text-xs"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Run Workspace Reconciliation
              </Button>
            </>
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

      {/* Filter Toolbar */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            Filter Reconciliation Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Run Type</label>
            <select
              value={filterRunType}
              onChange={(e) => {
                setFilterRunType(e.target.value);
                setOffset(0);
              }}
              className="w-full text-xs rounded-md border border-input bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Types</option>
              <option value="BATCH_LEVEL">BATCH_LEVEL</option>
              <option value="WORKSPACE_LEVEL">WORKSPACE_LEVEL</option>
            </select>
          </div>

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
              <option value="RECONCILED">RECONCILED</option>
              <option value="DISCREPANCY">DISCREPANCY</option>
              <option value="UNRECONCILED">UNRECONCILED</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Runs Table */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="text-sm font-semibold">
            Reconciliation Runs ({activeTotalCount})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && activeRuns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Loading reconciliation runs...
            </div>
          ) : activeRuns.length === 0 ? (
            <EmptyState
              icon={<FileCheck2 className="w-6 h-6" />}
              title="No reconciliation runs"
              description="No reconciliation runs found for this workspace."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Settlement Batch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Items Checked</TableHead>
                    <TableHead>Discrepancies</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        <Link
                          href={`/protected/reconciliation/${run.id}${workspaceId ? `?workspace=${workspaceId}` : ''}`}
                          className="text-primary hover:underline"
                        >
                          {run.id}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{run.run_type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {run.settlement_batch?.batch_number || run.settlement_batch_id || '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={getStatusBadgeVariant(run.status)}>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {run.items_checked}
                      </TableCell>
                      <TableCell className="text-xs">
                        {run.discrepancy_count > 0 ? (
                          <span className="text-error font-semibold inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {run.discrepancy_count}
                          </span>
                        ) : (
                          <span className="text-success font-medium">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(run.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/protected/reconciliation/${run.id}${workspaceId ? `?workspace=${workspaceId}` : ''}`}
                        >
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            Details
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal for Workspace Reconciliation (OWNER only) */}
      <ConfirmDialog
        open={showWorkspaceReconModal}
        onOpenChange={(open) => {
          if (!open && !isExecutingWorkspaceRecon) setShowWorkspaceReconModal(false);
        }}
        title="Trigger Workspace Reconciliation"
        description={
          <span className="space-y-2 block text-left">
            <span className="block text-foreground">
              Are you sure you want to run workspace-level reconciliation?
            </span>
            <span className="block text-xs text-muted-foreground">
              This will perform an exhaustive mathematical integrity audit across all finalized settlement batches, call commercials, and payment records in this workspace.
            </span>
          </span>
        }
        confirmText="Run Audit"
        cancelText="Cancel"
        onConfirm={handleConfirmWorkspaceRecon}
        isLoading={isExecutingWorkspaceRecon}
        destructive={false}
      />

      {/* Batch Reconciliation Modal (OWNER only) */}
      {showBatchReconModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg animate-in fade-in zoom-in-95 duration-200">
            <CardHeader>
              <CardTitle>Run Batch Reconciliation</CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Trigger a focused audit for a specific settlement batch.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmitBatchRecon}>
              <CardContent className="space-y-4 pt-2">
                {batchReconError && (
                  <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-error" />
                    <span>{batchReconError}</span>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Settlement Batch ID
                  </label>
                  <Input
                    placeholder="Enter settlement batch ID..."
                    value={batchIdToReconcile}
                    onChange={(e) => setBatchIdToReconcile(e.target.value)}
                    required
                    className="text-xs font-mono"
                    disabled={isExecutingBatchRecon}
                  />
                </div>
              </CardContent>
              <div className="flex justify-end gap-3 p-4 border-t border-border mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBatchReconModal(false)}
                  disabled={isExecutingBatchRecon}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!batchIdToReconcile.trim() || isExecutingBatchRecon}
                  isLoading={isExecutingBatchRecon}
                >
                  Run Batch Audit
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
