'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import {
  ReconciliationRun,
  ReconciliationIssue,
  getReconciliationRun,
  listReconciliationIssues,
} from '@/lib/reconciliation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FileCheck2,
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  Layers,
  FileText,
  Clock,
  ShieldCheck,
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

export default function ReconciliationDetailPage() {
  const searchParams = useSearchParams();
  const params = useParams();

  const workspaceId = searchParams.get('workspace');
  const runId = params.runId as string;

  // Authorization and role state
  const [userRole, setUserRole] = useState<{
    role: string;
    participant_type?: string | null;
    permissions?: string[];
  } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // Data state
  const [run, setRun] = useState<ReconciliationRun | null>(null);
  const [issues, setIssues] = useState<ReconciliationIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setForbiddenError(err?.message || 'Access denied.');
      } finally {
        setAuthChecking(false);
      }
    }

    checkRole();
  }, [workspaceId]);

  // Load run details and issues
  const loadRunData = useCallback(async () => {
    if (!workspaceId || !runId || forbiddenError) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const [runData, issuesData] = await Promise.all([
        getReconciliationRun(workspaceId, runId),
        listReconciliationIssues(workspaceId, runId),
      ]);
      setRun(runData);
      setIssues(issuesData || []);
    } catch (err: any) {
      if (err?.message?.includes('403') || err?.status === 403) {
        setForbiddenError('403 Forbidden: You do not have permission to view reconciliation.');
      } else if (err?.message?.includes('404') || err?.status === 404) {
        setNotFound(true);
      } else {
        setError(err?.message || 'Failed to load reconciliation run details.');
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, runId, forbiddenError]);

  useEffect(() => {
    if (!authChecking && !forbiddenError && workspaceId && runId) {
      loadRunData();
    }
  }, [authChecking, forbiddenError, workspaceId, runId, loadRunData]);

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

  const getIssueBadgeVariant = (issueType: string) => {
    switch (issueType) {
      case 'SUM_MISMATCH':
      case 'CURRENCY_MISMATCH':
        return 'error';
      case 'DUPLICATE_CALL':
      case 'MISSING_PAYMENT':
        return 'warning';
      default:
        return 'outline';
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
            <CardTitle className="text-xl">Reconciliation Run Not Found</CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Reconciliation run with ID &quot;{runId}&quot; does not exist in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/protected/reconciliation${workspaceId ? `?workspace=${workspaceId}` : ''}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Reconciliation
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
          href={`/protected/reconciliation${workspaceId ? `?workspace=${workspaceId}` : ''}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Reconciliation
        </Link>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadRunData}
            disabled={loading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-error" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Run Summary Card */}
      {run && (
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg font-bold font-mono">
                    {run.id}
                  </CardTitle>
                  <Badge variant={getStatusBadgeVariant(run.status)}>
                    {run.status}
                  </Badge>
                  <Badge variant="outline">{run.run_type}</Badge>
                </div>
                {run.settlement_batch_id && (
                  <CardDescription className="text-xs text-muted-foreground mt-1">
                    Settlement Batch:{' '}
                    <span className="font-mono font-medium text-foreground">
                      {run.settlement_batch?.batch_number || run.settlement_batch_id}
                    </span>
                  </CardDescription>
                )}
              </div>

              <div className="flex items-center gap-6 text-right">
                <div>
                  <span className="text-xs text-muted-foreground block">Items Checked</span>
                  <span className="text-xl font-bold text-foreground">{run.items_checked}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Discrepancies</span>
                  <span
                    className={`text-xl font-bold ${
                      run.discrepancy_count > 0 ? 'text-error' : 'text-success'
                    }`}
                  >
                    {run.discrepancy_count}
                  </span>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block">Run Type</span>
              <span className="font-semibold text-foreground">{run.run_type}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Audit Status</span>
              <span className="font-semibold text-foreground">{run.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Created At</span>
              <span className="text-foreground">{formatDate(run.created_at)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Updated At</span>
              <span className="text-foreground">{formatDate(run.updated_at)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discrepancies / Issues Card */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                Audit Issues ({issues.length})
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Exact discrepancies identified by mathematical and transactional integrity rules.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && issues.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Loading issues...
            </div>
          ) : issues.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <ShieldCheck className="w-10 h-10 text-success mx-auto" />
              <div className="text-sm font-semibold text-foreground">
                No discrepancies detected
              </div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                All checked items satisfied mathematical equality and transaction consistency. Run reconciled cleanly.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Call Commercial ID</TableHead>
                    <TableHead>Expected Amount</TableHead>
                    <TableHead>Actual Amount</TableHead>
                    <TableHead>Recorded At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {issue.id}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={getIssueBadgeVariant(issue.issue_type)}>
                          {issue.issue_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-xs break-words">
                        {issue.description}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {issue.call_commercial_id || '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {issue.expected_amount !== null && issue.expected_amount !== undefined
                          ? formatCurrency(issue.expected_amount)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {issue.actual_amount !== null && issue.actual_amount !== undefined
                          ? formatCurrency(issue.actual_amount)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(issue.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
