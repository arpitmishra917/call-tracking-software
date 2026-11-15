'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InviteUserDialog } from '@/components/invite-user-dialog';
import {
  Building2,
  Plus,
  Search,
  AlertCircle,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  Edit2,
  UserPlus,
  Power,
  Copy,
  Check,
  Calendar,
  CheckCircle2,
} from 'lucide-react';

interface Vendor {
  id: string;
  name: string;
  status: string;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export default function VendorsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  // Role and authorization states
  const [authChecking, setAuthChecking] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);
  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);
  const [isViewer, setIsViewer] = useState(false);
  const [invitingVendor, setInvitingVendor] = useState<Vendor | null>(null);

  // Data states
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const limit = 10;

  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createValidationError, setCreateValidationError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Edit Modal
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [editName, setEditName] = useState('');
  const [editValidationError, setEditValidationError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Deactivate Modal
  const [deactivatingVendor, setDeactivatingVendor] = useState<Vendor | null>(null);
  const [isSubmittingDeactivate, setIsSubmittingDeactivate] = useState(false);

  // Activate loading
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // Check role authorization on load
  useEffect(() => {
    async function checkAuthorization() {
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
        setIsOwnerOrAdmin(role === 'OWNER' || role === 'ADMIN');
        const participantType = currentWs.participant_type;
        const permissions: string[] = currentWs.permissions || [];

        // Check if external participant (BUYER or VENDOR)
        if (participantType === 'BUYER' || participantType === 'VENDOR') {
          setForbiddenError('Participants do not have access to vendor management.');
          return;
        }

        // Check internal roles
        if (role === 'VIEWER') {
          setForbiddenError('Viewers do not have permission to manage vendors.');
          setIsViewer(true);
          return;
        }

        if (role === 'MEMBER' && !permissions.includes('vendor:read')) {
          setForbiddenError('Missing vendor:read permission for vendor management.');
          return;
        }
      } catch (err: any) {
        setForbiddenError('Failed to verify workspace permissions.');
      } finally {
        setAuthChecking(false);
      }
    }

    checkAuthorization();
  }, [workspaceId]);

  // Load vendors list
  const loadVendors = useCallback(async () => {
    if (!workspaceId || forbiddenError) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String((page - 1) * limit),
      });

      if (search.trim()) {
        params.append('search', search.trim());
      }

      if (statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }

      const res = await apiFetch(`/workspaces/${workspaceId}/vendors?${params.toString()}`);
      if (res && Array.isArray(res.items)) {
        setVendors(res.items);
        setTotalCount(res.total ?? res.items.length);
      } else if (Array.isArray(res)) {
        setVendors(res);
        setTotalCount(res.length);
      } else {
        setVendors([]);
        setTotalCount(0);
      }
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
      setVendors([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, page, search, statusFilter, forbiddenError]);

  useEffect(() => {
    if (!authChecking && !forbiddenError && workspaceId) {
      loadVendors();
    }
  }, [authChecking, forbiddenError, workspaceId, loadVendors]);

  // Copy helper
  function handleCopyId(id: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  // Create vendor handler
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;

    if (!createName.trim()) {
      setCreateValidationError('Vendor name is required.');
      return;
    }

    setCreateValidationError(null);
    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors`, {
        method: 'POST',
        body: JSON.stringify({ name: createName.trim() }),
      });
      setSuccess('Vendor created successfully.');
      setCreateName('');
      setIsCreateOpen(false);
      setPage(1);
      loadVendors();
    } catch (err: any) {
      setError(`Failed to create vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCreating(false);
    }
  }

  // Open edit modal
  function openEditModal(vendor: Vendor) {
    setEditingVendor(vendor);
    setEditName(vendor.name);
    setEditValidationError(null);
  }

  // Edit submit handler
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !editingVendor) return;

    if (!editName.trim()) {
      setEditValidationError('Vendor name is required.');
      return;
    }

    setEditValidationError(null);
    setIsSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors/${editingVendor.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim() }),
      });
      setSuccess('Vendor updated successfully.');
      setEditingVendor(null);
      loadVendors();
    } catch (err: any) {
      setError(`Failed to update vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  // Deactivate submit handler (archive)
  async function handleDeactivateSubmit() {
    if (!workspaceId || !deactivatingVendor) return;
    setIsSubmittingDeactivate(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors/${deactivatingVendor.id}/archive`, {
        method: 'POST',
      });
      setSuccess(`Vendor "${deactivatingVendor.name}" deactivated successfully.`);
      setDeactivatingVendor(null);
      loadVendors();
    } catch (err: any) {
      setError(`Failed to deactivate vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingDeactivate(false);
    }
  }

  // Activate handler
  async function handleActivate(vendor: Vendor) {
    if (!workspaceId) return;
    setActivatingId(vendor.id);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors/${vendor.id}/activate`, {
        method: 'POST',
      });
      setSuccess(`Vendor "${vendor.name}" activated successfully.`);
      loadVendors();
    } catch (err: any) {
      setError(`Failed to activate vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActivatingId(null);
    }
  }

  // Initial / Auth loading state
  if (authChecking) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm font-medium">Verifying permissions...</span>
      </div>
    );
  }

  // Forbidden / Access Denied State
  if (forbiddenError) {
    return (
      <div className="max-w-2xl mx-auto mt-8 p-6">
        <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-destructive" />
              <CardTitle className="text-destructive font-bold">Access Denied</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground/80 leading-relaxed">{forbiddenError}</p>
            <Button variant="outline" onClick={() => window.history.back()}>
              Return to Previous Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Missing Workspace State
  if (!workspaceId) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">Please select a workspace to manage vendors.</p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const activeCount = vendors.filter((v) => v.status === 'ACTIVE').length;
  const inactiveCount = vendors.filter((v) => v.status === 'INACTIVE').length;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-12 w-full max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Building2 className="h-6 w-6 text-primary" />
            Vendors
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage traffic partner vendors and assignable routing resources.
          </p>
        </div>

        {isOwnerOrAdmin && (
          <Button
            onClick={() => {
              setCreateValidationError(null);
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-2 self-start sm:self-auto shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Vendor
          </Button>
        )}
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Vendors</span>
          <span className="text-2xl font-bold tracking-tight text-foreground mt-1">{totalCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active on Page</span>
          <span className="text-2xl font-bold tracking-tight text-success mt-1">{activeCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inactive on Page</span>
          <span className="text-2xl font-bold tracking-tight text-warning mt-1">{inactiveCount}</span>
        </Card>
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md text-sm border border-error-muted flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-success-muted text-success-muted-foreground p-4 rounded-md text-sm border border-success-muted flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Search and Status Filters Toolbar */}
      <Card className="border-border shadow-xs">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search vendors by name..."
                className="pl-9 h-10"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                Status:
              </span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadVendors()}
                title="Refresh list"
                className="h-10 px-3"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Table / Empty / Loading */}
      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          <span className="text-sm font-medium">Loading vendors...</span>
        </div>
      ) : vendors.length === 0 ? (
        <EmptyState
          title="No vendors found"
          description={
            search || statusFilter !== 'ALL'
              ? 'No vendors match your current search or status filter.'
              : 'Add a vendor partner to start tracking inbound traffic sources.'
          }
        />
      ) : (
        <Card className="overflow-hidden border-border shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="min-w-[200px]">Vendor Name</TableHead>
                  <TableHead className="min-w-[160px]">Vendor ID</TableHead>
                  <TableHead className="min-w-[130px]">Created At</TableHead>
                  <TableHead className="text-right min-w-[100px]">Status</TableHead>
                  <TableHead className="text-right min-w-[280px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="font-semibold text-foreground">
                      <Link
                        href={`/protected/vendors/${v.id}?workspace=${workspaceId}`}
                        className="hover:underline hover:text-primary transition-colors flex items-center gap-1.5"
                      >
                        {v.name}
                        <ExternalLink className="h-3 w-3 opacity-40 hover:opacity-100" />
                      </Link>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 bg-muted/60 px-2 py-1 rounded-md border border-border/50">
                        {v.id.length > 14 ? `${v.id.substring(0, 14)}...` : v.id}
                        <button
                          onClick={() => handleCopyId(v.id)}
                          title="Copy Vendor ID"
                          className="hover:text-foreground transition-colors cursor-pointer"
                        >
                          {copiedId === v.id ? (
                            <Check className="h-3 w-3 text-success" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-60 hover:opacity-100" />
                          )}
                        </button>
                      </span>
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" />
                        {v.created_at ? new Date(v.created_at).toLocaleDateString() : '—'}
                      </span>
                    </TableCell>

                    <TableCell className="text-right">
                      <Badge variant={v.status === 'ACTIVE' ? 'success' : 'warning'}>
                        {v.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <Link
                          href={`/protected/vendors/${v.id}?workspace=${workspaceId}`}
                          className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-secondary transition-colors"
                        >
                          View Details
                        </Link>

                        <button
                          onClick={() => openEditModal(v)}
                          className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-secondary text-foreground transition-colors cursor-pointer"
                        >
                          <Edit2 className="h-3 w-3 mr-1" />
                          Edit
                        </button>

                        {isOwnerOrAdmin && (
                          <button
                            onClick={() => setInvitingVendor(v)}
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-secondary text-primary font-semibold transition-colors cursor-pointer"
                          >
                            <UserPlus className="h-3 w-3 mr-1" />
                            Invite User
                          </button>
                        )}

                        {v.status === 'ACTIVE' ? (
                          <button
                            onClick={() => setDeactivatingVendor(v)}
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-destructive/30 bg-destructive/10 text-destructive px-2.5 py-1.5 hover:bg-destructive/20 transition-colors cursor-pointer"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivate(v)}
                            disabled={activatingId === v.id}
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-success/30 bg-success/10 text-success px-2.5 py-1.5 hover:bg-success/20 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Power className="h-3 w-3 mr-1" />
                            {activatingId === v.id ? 'Activating...' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface text-sm text-muted-foreground">
            <div>
              Showing {Math.min((page - 1) * limit + 1, totalCount)} to{' '}
              {Math.min(page * limit, totalCount)} of {totalCount} vendors
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-xs font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-background border-border shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Add New Vendor
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="createVendorName" className="text-sm font-medium">
                    Vendor Name
                  </Label>
                  <Input
                    id="createVendorName"
                    type="text"
                    value={createName}
                    onChange={(e) => {
                      setCreateName(e.target.value);
                      if (createValidationError) setCreateValidationError(null);
                    }}
                    placeholder="e.g. Acme Traffic Partner"
                    className={createValidationError ? 'border-destructive focus:ring-destructive' : ''}
                    required
                    autoFocus
                  />
                  {createValidationError && (
                    <p className="text-xs text-destructive mt-1">{createValidationError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Assign a distinct business or traffic network name.
                  </p>
                </div>
                <div className="flex justify-end gap-2.5 mt-4 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsCreateOpen(false);
                      setCreateName('');
                      setCreateValidationError(null);
                    }}
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={isCreating}>
                    Create Vendor
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Modal */}
      {editingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-background border-border shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-primary" />
                Edit Vendor
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editVendorName" className="text-sm font-medium">
                    Vendor Name
                  </Label>
                  <Input
                    id="editVendorName"
                    type="text"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      if (editValidationError) setEditValidationError(null);
                    }}
                    className={editValidationError ? 'border-destructive focus:ring-destructive' : ''}
                    required
                    autoFocus
                  />
                  {editValidationError && (
                    <p className="text-xs text-destructive mt-1">{editValidationError}</p>
                  )}
                </div>
                <div className="flex justify-end gap-2.5 mt-4 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingVendor(null);
                      setEditValidationError(null);
                    }}
                    disabled={isSubmittingEdit}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={isSubmittingEdit}>
                    Save Changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Accessible Deactivation Confirm Dialog */}
      <ConfirmDialog
        open={!!deactivatingVendor}
        onOpenChange={(open) => {
          if (!open) setDeactivatingVendor(null);
        }}
        title="Deactivate Vendor"
        description={
          deactivatingVendor ? (
            <span>
              Are you sure you want to deactivate <strong>{deactivatingVendor.name}</strong>? This
              will archive the vendor and suspend associated inbound traffic routing.
            </span>
          ) : (
            ''
          )
        }
        confirmText="Deactivate"
        destructive={true}
        isLoading={isSubmittingDeactivate}
        onConfirm={handleDeactivateSubmit}
      />

      {/* Invite User Dialog */}
      {invitingVendor && (
        <InviteUserDialog
          workspaceId={workspaceId}
          isOpen={!!invitingVendor}
          onClose={() => setInvitingVendor(null)}
          participantType="VENDOR"
          entityId={invitingVendor.id}
          entityName={invitingVendor.name}
        />
      )}
    </div>
  );
}
