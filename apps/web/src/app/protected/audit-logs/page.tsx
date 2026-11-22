'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import {
  SecurityAuditLog,
  listAuditLogs,
  sanitizeMetadata,
} from '@/lib/audit-logs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge, BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ScrollText,
  RefreshCw,
  Filter,
  ShieldAlert,
  AlertCircle,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Lock,
} from 'lucide-react';

function formatDate(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function truncateId(id?: string | null): string {
  if (!id) return '—';
  if (id.length <= 16) return id;
  return `${id.substring(0, 8)}...${id.substring(id.length - 6)}`;
}

function getActionBadgeVariant(action: string): BadgeProps['variant'] {
  const act = action.toUpperCase();
  if (act.includes('ASSIGN') || act.includes('CREATE') || act.includes('ADD')) {
    return 'success';
  }
  if (act.includes('REVOKE') || act.includes('REMOVE') || act.includes('DELETE')) {
    return 'error';
  }
  if (act.includes('UPDATE') || act.includes('MODIFY') || act.includes('CHANGE')) {
    return 'info';
  }
  return 'outline';
}

export default function AuditLogsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);

  // Authorization state
  const [authChecking, setAuthChecking] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // Data state
  const [logs, setLogs] = useState<SecurityAuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render-time workspace identity guard: eliminate stale data rendering during workspace transitions
  const isWorkspaceStale = currentWorkspaceIdRef.current !== workspaceId;
  const activeLogs = isWorkspaceStale ? [] : logs;
  const activeTotalCount = isWorkspaceStale ? 0 : totalCount;
  const isLoading = loading || isWorkspaceStale;

  // Pagination
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [targetIdFilter, setTargetIdFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Selected Log Details Modal
  const [selectedLog, setSelectedLog] = useState<SecurityAuditLog | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Verify workspace access and permissions
  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    // Immediately clear previous workspace state upon workspace change
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogs([]);
    setTotalCount(0);
    setError(null);
    setOffset(0);
    setSelectedLog(null);

    if (!workspaceId) {
      setAuthChecking(false);
      return;
    }

    setAuthChecking(true);
    setForbiddenError(null);

    let isCancelled = false;

    async function checkAuthorization() {
      try {
        const workspaces = await apiFetch('/workspaces');
        if (isCancelled || currentWorkspaceIdRef.current !== workspaceId) return;

        const currentWs = Array.isArray(workspaces)
          ? workspaces.find(
              (w: {
                id: string;
                role: string;
                participant_type?: string;
                permissions?: string[];
              }) => w.id === workspaceId,
            )
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
          setForbiddenError('403 Forbidden: Participants do not have access to audit logs.');
          return;
        }

        // VIEWER denied
        if (role === 'VIEWER') {
          setForbiddenError('403 Forbidden: Viewers do not have access to audit logs.');
          return;
        }

        // MEMBER only if explicitly authorized with audit_log:read
        if (role === 'MEMBER' && !permissions.includes('audit_log:read')) {
          setForbiddenError('403 Forbidden: You do not have permission to view audit logs.');
          return;
        }
      } catch (err: unknown) {
        if (isCancelled || currentWorkspaceIdRef.current !== workspaceId) return;
        setForbiddenError(err instanceof Error ? err.message : 'Access denied.');
      } finally {
        if (!isCancelled && currentWorkspaceIdRef.current === workspaceId) {
          setAuthChecking(false);
        }
      }
    }

    checkAuthorization();

    return () => {
      isCancelled = true;
    };
  }, [workspaceId]);

  // Fetch audit logs from backend
  const fetchAuditLogs = useCallback(async () => {
    if (!workspaceId || forbiddenError) return;

    const targetWsId = workspaceId;
    setLoading(true);
    setError(null);

    try {
      const data = await listAuditLogs(targetWsId, {
        limit,
        offset,
        action: actionFilter.trim() || undefined,
        targetType: targetTypeFilter.trim() || undefined,
        targetId: targetIdFilter.trim() || undefined,
        startDate: startDateFilter ? new Date(startDateFilter).toISOString() : undefined,
        endDate: endDateFilter ? new Date(endDateFilter).toISOString() : undefined,
      });

      // Guard against race conditions where active workspace changed
      if (currentWorkspaceIdRef.current !== targetWsId) return;

      setLogs(data.items || []);
      setTotalCount(data.total || 0);
    } catch (err: unknown) {
      // Guard against race conditions where active workspace changed
      if (currentWorkspaceIdRef.current !== targetWsId) return;

      // Clear stale records and totals before showing error
      setLogs([]);
      setTotalCount(0);

      const message = err instanceof Error ? err.message : 'Failed to fetch audit logs.';
      if (message.includes('403') || message.includes('Forbidden')) {
        setForbiddenError('403 Forbidden: Insufficient permission to view audit logs.');
      } else {
        setError(message);
      }
    } finally {
      if (currentWorkspaceIdRef.current === targetWsId) {
        setLoading(false);
      }
    }
  }, [
    workspaceId,
    forbiddenError,
    limit,
    offset,
    actionFilter,
    targetTypeFilter,
    targetIdFilter,
    startDateFilter,
    endDateFilter,
  ]);

  // Trigger fetch when workspace, limit, or offset changes (and auth check passes)
  useEffect(() => {
    if (!authChecking && !forbiddenError && workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAuditLogs();
    }
  }, [authChecking, forbiddenError, workspaceId, offset, limit, fetchAuditLogs]);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    fetchAuditLogs();
  };

  const handleResetFilters = () => {
    setActionFilter('');
    setTargetTypeFilter('');
    setTargetIdFilter('');
    setStartDateFilter('');
    setEndDateFilter('');
    setOffset(0);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Pagination helpers
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(activeTotalCount / limit));
  const hasPrev = offset > 0;
  const hasNext = offset + limit < activeTotalCount;

  // Render: No workspace selected
  if (!workspaceId) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Select a Workspace</CardTitle>
            <CardDescription>
              Please select a workspace from the header dropdown to view its audit logs.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Render: Authorization loading state
  if (authChecking) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto py-8" data-testid="audit-logs-auth-loading">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render: Forbidden state
  if (forbiddenError) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto py-8">
        <Card className="border-error/20 bg-error/5">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-8 w-8 text-error shrink-0" />
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
            <ScrollText className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Logs</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Immutable workspace security event history and administrative actions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAuditLogs}
            disabled={isLoading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-error" />
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAuditLogs}
              className="h-7 text-xs px-2"
            >
              Retry
            </Button>
            <button
              onClick={() => setError(null)}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Filters Toolbar */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            Filter Audit Events
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleApplyFilters} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Action
                </label>
                <Input
                  type="text"
                  placeholder="e.g. PERMISSION_ASSIGNED"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Target Type
                </label>
                <select
                  value={targetTypeFilter}
                  onChange={(e) => setTargetTypeFilter(e.target.value)}
                  className="w-full h-8 text-xs rounded-md border border-border bg-surface px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">All Types</option>
                  <option value="WORKSPACE">WORKSPACE</option>
                  <option value="WORKSPACE_MEMBER">WORKSPACE_MEMBER</option>
                  <option value="WORKSPACE_INVITATION">WORKSPACE_INVITATION</option>
                  <option value="CAMPAIGN">CAMPAIGN</option>
                  <option value="PHONE_NUMBER">PHONE_NUMBER</option>
                  <option value="BUYER">BUYER</option>
                  <option value="VENDOR">VENDOR</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Target ID
                </label>
                <Input
                  type="text"
                  placeholder="Specific resource UUID"
                  value={targetIdFilter}
                  onChange={(e) => setTargetIdFilter(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Date Range
                </label>
                <div className="flex items-center gap-1">
                  <Input
                    type="date"
                    value={startDateFilter}
                    onChange={(e) => setStartDateFilter(e.target.value)}
                    className="h-8 text-xs"
                    title="Start Date"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={endDateFilter}
                    onChange={(e) => setEndDateFilter(e.target.value)}
                    className="h-8 text-xs"
                    title="End Date"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" className="h-8 text-xs">
                  Apply Filters
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-8 text-xs"
                >
                  Reset
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Per page:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setOffset(0);
                  }}
                  className="h-8 text-xs rounded-md border border-border bg-surface px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Timestamp</TableHead>
                <TableHead className="w-56">Action</TableHead>
                <TableHead className="w-44">Actor</TableHead>
                <TableHead className="w-48">Target</TableHead>
                <TableHead>Metadata Summary</TableHead>
                <TableHead className="w-20 text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-${idx}`}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : activeLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <EmptyState
                      icon={<ScrollText className="h-8 w-8" />}
                      title="No audit logs found"
                      description="No audit events matched the selected filter criteria."
                      action={
                        (actionFilter || targetTypeFilter || targetIdFilter || startDateFilter || endDateFilter) ? (
                          <Button variant="outline" size="sm" onClick={handleResetFilters}>
                            Clear Filters
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                activeLogs.map((log) => {
                  const safeMeta = sanitizeMetadata(log.metadata);
                  return (
                    <TableRow key={log.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log.action)}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.actor_user_id ? (
                          <span className="font-mono" title={`User ID: ${log.actor_user_id}`}>
                            {truncateId(log.actor_user_id)}
                          </span>
                        ) : log.actor_member_id ? (
                          <span className="font-mono" title={`Member ID: ${log.actor_member_id}`}>
                            {truncateId(log.actor_member_id)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">System</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.target_type ? (
                          <div>
                            <span className="font-semibold text-foreground">
                              {log.target_type}
                            </span>
                            {log.target_id && (
                              <div className="font-mono text-muted-foreground text-[11px] flex items-center gap-1 mt-0.5">
                                <span>{truncateId(log.target_id)}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(log.target_id!, `target-${log.id}`)}
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Copy Target ID"
                                >
                                  {copiedId === `target-${log.id}` ? (
                                    <Check className="w-3 h-3 text-success" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate">
                        {safeMeta && Object.keys(safeMeta).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(safeMeta).slice(0, 3).map(([k, v]) => (
                              <span
                                key={k}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-secondary text-secondary-foreground"
                              >
                                {k}={typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            ))}
                            {Object.keys(safeMeta).length > 3 && (
                              <span className="text-[11px] text-muted-foreground self-center">
                                +{Object.keys(safeMeta).length - 3} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLog(log)}
                          className="h-7 w-7 p-0"
                          title="View Full Event Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        {/* Pagination Footer */}
        {activeTotalCount > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-border gap-4">
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-medium text-foreground">{offset + 1}</span> to{' '}
              <span className="font-medium text-foreground">
                {Math.min(offset + limit, activeTotalCount)}
              </span>{' '}
              of <span className="font-medium text-foreground">{activeTotalCount}</span> events
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground mr-2">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={!hasPrev || isLoading}
                className="h-8 text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(offset + limit)}
                disabled={!hasNext || isLoading}
                className="h-8 text-xs"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Safe Event Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-lg animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant={getActionBadgeVariant(selectedLog.action)}>
                    {selectedLog.action}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDate(selectedLog.created_at)}
                  </span>
                </div>
                <CardTitle className="text-lg mt-1">Audit Event Details</CardTitle>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </CardHeader>

            <CardContent className="overflow-y-auto p-6 space-y-4 flex-1">
              {/* Event Core Information */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <span className="text-muted-foreground font-medium">Log ID</span>
                  <div className="font-mono bg-secondary p-2 rounded flex items-center justify-between">
                    <span className="truncate">{selectedLog.id}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedLog.id, 'modal-log-id')}
                      className="ml-2 text-muted-foreground hover:text-foreground shrink-0"
                      title="Copy Log ID"
                    >
                      {copiedId === 'modal-log-id' ? (
                        <Check className="w-3 h-3 text-success" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-medium">Workspace ID</span>
                  <div className="font-mono bg-secondary p-2 rounded truncate">
                    {selectedLog.workspace_id}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-medium">Actor User ID</span>
                  <div className="font-mono bg-secondary p-2 rounded truncate">
                    {selectedLog.actor_user_id || '— (System)'}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-medium">Actor Member ID</span>
                  <div className="font-mono bg-secondary p-2 rounded truncate">
                    {selectedLog.actor_member_id || '—'}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-medium">Target Type</span>
                  <div className="bg-secondary p-2 rounded font-semibold text-foreground">
                    {selectedLog.target_type || '—'}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-medium">Target ID</span>
                  <div className="font-mono bg-secondary p-2 rounded flex items-center justify-between">
                    <span className="truncate">{selectedLog.target_id || '—'}</span>
                    {selectedLog.target_id && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedLog.target_id!, 'modal-target-id')}
                        className="ml-2 text-muted-foreground hover:text-foreground shrink-0"
                        title="Copy Target ID"
                      >
                        {copiedId === 'modal-target-id' ? (
                          <Check className="w-3 h-3 text-success" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Redaction Notice */}
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-secondary/60 text-muted-foreground text-xs border border-border">
                <Lock className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span>
                  Sensitive credentials, secret keys, passwords, and tokens are protected and redacted.
                </span>
              </div>

              {/* Metadata Viewer */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-foreground">
                  Sanitized Metadata
                </span>
                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 ? (
                  <pre className="p-3 bg-secondary rounded-md text-xs font-mono text-foreground overflow-x-auto max-h-60 border border-border">
                    {JSON.stringify(sanitizeMetadata(selectedLog.metadata), null, 2)}
                  </pre>
                ) : (
                  <div className="p-3 bg-secondary rounded-md text-xs text-muted-foreground italic border border-border">
                    No metadata associated with this event.
                  </div>
                )}
              </div>
            </CardContent>

            <div className="p-4 border-t border-border flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedLog(null)}
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
