'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
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
  UserSquare2,
  Plus,
  Search,
  Phone,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Edit2,
  UserPlus,
  Power,
  ShieldAlert,
  Mail,
  Layers,
} from 'lucide-react';

export interface BuyerDestinationNumber {
  id: string;
  destination_number: string;
  name?: string | null;
  status: string;
  timeout?: number;
  max_concurrent_calls?: number;
}

export interface Buyer {
  id: string;
  name: string;
  email?: string | null;
  destination_number?: string | null;
  status: string;
  timeout?: number | null;
  max_concurrent_calls?: number | null;
  created_at?: string;
  destination_numbers?: BuyerDestinationNumber[];
}

export default function BuyersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);
  const requestGenRef = useRef(0);

  // Role and authorization states
  const [authChecking, setAuthChecking] = useState(true);
  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);
  const [isViewer, setIsViewer] = useState(false);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // Data states
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    requestGenRef.current++;
    setBuyers([]);
    setError(null);
    setForbiddenError(null);
    setSuccess(null);
  }, [workspaceId]);

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Create Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [timeout, setTimeoutVal] = useState(30);
  const [maxConcurrentCalls, setMaxConcurrentCalls] = useState<number | string>(1);
  const [isCreating, setIsCreating] = useState(false);
  const [createValidationErrors, setCreateValidationErrors] = useState<{
    name?: string;
    email?: string;
    destination?: string;
    timeout?: string;
    maxConcurrentCalls?: string;
  }>({});

  // Edit Modal state
  const [editingBuyer, setEditingBuyer] = useState<Buyer | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTimeout, setEditTimeout] = useState(30);
  const [editMaxConcurrentCalls, setEditMaxConcurrentCalls] = useState<number | string>(1);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editValidationErrors, setEditValidationErrors] = useState<{
    name?: string;
    email?: string;
    timeout?: string;
    maxConcurrentCalls?: string;
  }>({});

  // Deactivate Confirmation state
  const [deactivatingBuyer, setDeactivatingBuyer] = useState<Buyer | null>(null);
  const [isSubmittingDeactivate, setIsSubmittingDeactivate] = useState(false);

  // Activate state
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // Invite Modal state
  const [invitingBuyer, setInvitingBuyer] = useState<Buyer | null>(null);

  // Initial load & authorization check
  useEffect(() => {
    async function initPage() {
      if (!workspaceId) {
        setAuthChecking(false);
        setLoading(false);
        return;
      }

      const targetWs = workspaceId;
      const currentGen = ++requestGenRef.current;
      setAuthChecking(true);
      setForbiddenError(null);

      try {
        const [data, workspaces] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/buyers`),
          apiFetch('/workspaces').catch(() => null),
        ]);

        if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
          return;
        }

        if (Array.isArray(workspaces)) {
          const ws = workspaces.find((w: any) => w.id === workspaceId);
          if (!ws) {
            setForbiddenError('Workspace not found or access denied.');
            return;
          }

          if (ws.participant_type === 'VENDOR') {
            setForbiddenError('Vendor participants do not have access to buyer management.');
            return;
          }

          const role = ws.role;
          setIsOwnerOrAdmin(role === 'OWNER' || role === 'ADMIN');
          setIsViewer(role === 'VIEWER');
        }

        setBuyers(data?.items || []);
      } catch (err: unknown) {
        if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
          setForbiddenError('You do not have permission to access buyer management.');
        } else {
          setError('Failed to load buyers.');
        }
      } finally {
        if (currentGen === requestGenRef.current && targetWs === currentWorkspaceIdRef.current) {
          setAuthChecking(false);
          setLoading(false);
        }
      }
    }

    initPage();
  }, [workspaceId]);

  async function refreshBuyers() {
    if (!workspaceId) return;
    const targetWs = workspaceId;
    const currentGen = requestGenRef.current;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/buyers`);
      if (currentGen === requestGenRef.current && targetWs === currentWorkspaceIdRef.current) {
        setBuyers(data?.items || []);
      }
    } catch (err: unknown) {
      console.error(err);
    }
  }

  // Phone number format validation (E.164-compatible: optional +, followed by 7-15 digits)
  function validatePhoneNumber(phone: string): boolean {
    const cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    return /^\+?[1-9]\d{6,14}$/.test(cleaned);
  }

  // Email format validation
  function validateEmail(emailStr: string): boolean {
    const trimmed = emailStr.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  // Timeout range validation (5 to 300 seconds)
  function validateTimeout(t: number): boolean {
    return Number.isInteger(t) && t >= 5 && t <= 300;
  }

  // Max concurrent calls validation (1 to 1000)
  function validateMaxConcurrentCalls(val: any): boolean {
    if (val === undefined || val === null || val === '') return false;
    const num = Number(val);
    return Number.isInteger(num) && num >= 1 && num <= 1000;
  }

  // Handle Create validation and submission
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;

    const errors: { name?: string; email?: string; destination?: string; timeout?: string; maxConcurrentCalls?: string } = {};
    if (!name.trim()) errors.name = 'Buyer Organization name is required.';
    if (!email.trim()) {
      errors.email = 'Organization email is required.';
    } else if (!validateEmail(email)) {
      errors.email = 'Please enter a valid email address (e.g. buyer@example.com).';
    }

    if (destination.trim() && !validatePhoneNumber(destination)) {
      errors.destination = 'Please enter a valid E.164 phone number (e.g. +1234567890).';
    }
    if (!validateTimeout(timeout)) {
      errors.timeout = 'Timeout must be an integer between 5 and 300 seconds.';
    }
    if (!validateMaxConcurrentCalls(maxConcurrentCalls)) {
      errors.maxConcurrentCalls = 'Max concurrent calls is mandatory and must be an integer between 1 and 1000.';
    }

    if (Object.keys(errors).length > 0) {
      setCreateValidationErrors(errors);
      return;
    }

    setCreateValidationErrors({});
    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: any = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        timeout,
        max_concurrent_calls: Number(maxConcurrentCalls),
      };

      if (destination.trim()) {
        payload.destinationNumber = destination.trim();
      }

      await apiFetch(`/workspaces/${workspaceId}/buyers`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setName('');
      setEmail('');
      setDestination('');
      setDestinationLabel('');
      setTimeoutVal(30);
      setMaxConcurrentCalls(1);
      setIsCreateOpen(false);
      setSuccess('Buyer Organization created successfully.');
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to create buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCreating(false);
    }
  }

  // Open edit modal
  function openEditModal(buyer: Buyer) {
    setEditingBuyer(buyer);
    setEditName(buyer.name);
    setEditEmail(buyer.email || '');
    setEditTimeout(buyer.timeout ?? 30);
    setEditMaxConcurrentCalls(buyer.max_concurrent_calls ?? 1);
    setEditValidationErrors({});
  }

  // Handle Edit validation and submission
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !editingBuyer) return;

    const errors: { name?: string; email?: string; timeout?: string; maxConcurrentCalls?: string } = {};
    if (!editName.trim()) errors.name = 'Buyer Organization name is required.';
    if (editEmail.trim() && !validateEmail(editEmail)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!validateTimeout(editTimeout)) {
      errors.timeout = 'Timeout must be an integer between 5 and 300 seconds.';
    }
    if (!validateMaxConcurrentCalls(editMaxConcurrentCalls)) {
      errors.maxConcurrentCalls = 'Max concurrent calls must be an integer between 1 and 1000.';
    }

    if (Object.keys(errors).length > 0) {
      setEditValidationErrors(errors);
      return;
    }

    setEditValidationErrors({});
    setIsSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${editingBuyer.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          ...(editEmail.trim() ? { email: editEmail.trim().toLowerCase() } : {}),
          timeout: editTimeout,
          max_concurrent_calls: Number(editMaxConcurrentCalls),
        }),
      });
      setSuccess(`Buyer Organization "${editName}" updated successfully.`);
      setEditingBuyer(null);
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to update buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  // Handle Activate
  async function handleActivate(id: string) {
    if (!workspaceId) return;
    setActivatingId(id);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${id}/activate`, {
        method: 'POST',
      });
      setSuccess('Buyer Organization activated successfully.');
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to activate buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActivatingId(null);
    }
  }

  // Handle Deactivate (Archive)
  async function handleDeactivateSubmit() {
    if (!workspaceId || !deactivatingBuyer) return;
    setIsSubmittingDeactivate(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${deactivatingBuyer.id}/archive`, {
        method: 'POST',
      });
      setSuccess(`Buyer Organization "${deactivatingBuyer.name}" deactivated successfully.`);
      setDeactivatingBuyer(null);
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to deactivate buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingDeactivate(false);
    }
  }

  // Filtered buyers computation
  const filteredBuyers = useMemo(() => {
    return buyers.filter((b) => {
      const q = search.toLowerCase();
      const matchesSearch =
        search === '' ||
        b.name.toLowerCase().includes(q) ||
        (b.email && b.email.toLowerCase().includes(q)) ||
        (b.destination_number && b.destination_number.toLowerCase().includes(q)) ||
        (b.destination_numbers &&
          b.destination_numbers.some(
            (dn) =>
              dn.destination_number.toLowerCase().includes(q) ||
              (dn.name && dn.name.toLowerCase().includes(q)),
          ));

      const matchesStatus =
        statusFilter === 'ALL' || b.status?.toUpperCase() === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [buyers, search, statusFilter]);

  // Metric counts
  const totalCount = buyers.length;
  const activeCount = buyers.filter((b) => b.status === 'ACTIVE').length;
  const inactiveCount = buyers.filter((b) => b.status === 'INACTIVE').length;
  const totalDestinationCount = buyers.reduce((sum, b) => {
    const count = b.destination_numbers?.length ?? (b.destination_number ? 1 : 0);
    return sum + count;
  }, 0);

  // Render auth checking
  if (authChecking) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm font-medium">Verifying permissions...</span>
      </div>
    );
  }

  // Render workspace missing
  if (!workspaceId) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">Select a workspace to manage buyers.</p>
      </div>
    );
  }

  // Render forbidden state
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

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-12 w-full max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <UserSquare2 className="h-6 w-6 text-primary" />
            Buyer Organizations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Buyer Organizations, independent destination number endpoints, and ring timeout rules.
          </p>
        </div>

        {isOwnerOrAdmin && (
          <Button
            onClick={() => {
              setCreateValidationErrors({});
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-2 self-start sm:self-auto shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Buyer
          </Button>
        )}
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Organizations</span>
          <span className="text-2xl font-bold tracking-tight text-foreground mt-1">{totalCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Orgs</span>
          <span className="text-2xl font-bold tracking-tight text-success mt-1">{activeCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inactive Orgs</span>
          <span className="text-2xl font-bold tracking-tight text-warning mt-1">{inactiveCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-primary" /> Total Endpoints
          </span>
          <span className="text-2xl font-bold tracking-tight text-foreground mt-1">{totalDestinationCount}</span>
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

      {/* Search and Status Toolbar */}
      <Card className="border-border shadow-xs">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organizations or endpoints..."
                className="pl-9 h-10"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                Status:
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshBuyers()}
                title="Refresh list"
                className="h-10 px-3"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Buyer Table / States */}
      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          <span className="text-sm font-medium">Loading buyers...</span>
        </div>
      ) : filteredBuyers.length === 0 ? (
        <EmptyState
          title="No buyers found"
          description={
            search || statusFilter !== 'ALL'
              ? 'No buyers match your current search or status filter.'
              : 'Add a Buyer Organization to start routing and receiving calls.'
          }
        />
      ) : (
        <Card className="overflow-hidden border-border shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="min-w-[180px]">Organization Name</TableHead>
                  <TableHead className="min-w-[180px]">Email</TableHead>
                  <TableHead className="min-w-[150px]">Destination Endpoints</TableHead>
                  <TableHead className="min-w-[120px]">Ring Timeout</TableHead>
                  <TableHead className="min-w-[130px]">Concurrency Limit</TableHead>
                  <TableHead className="text-right min-w-[90px]">Status</TableHead>
                  <TableHead className="text-right min-w-[280px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBuyers.map((b) => {
                  const dnCount = b.destination_numbers?.length ?? (b.destination_number ? 1 : 0);
                  const primaryDn = b.destination_numbers?.[0]?.destination_number || b.destination_number;

                  return (
                    <TableRow key={b.id} className="hover:bg-muted/20 transition-colors">
                      <TableCell className="font-semibold text-foreground">
                        <Link
                          href={`/protected/buyers/${b.id}?workspace=${workspaceId}`}
                          className="hover:underline hover:text-primary transition-colors flex items-center gap-1.5"
                        >
                          {b.name}
                          <ExternalLink className="h-3 w-3 opacity-40 hover:opacity-100" />
                        </Link>
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {b.email ? (
                          <span className="flex items-center gap-1.5 text-foreground/90 font-mono text-xs">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            {b.email}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-sm">
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/protected/buyers/${b.id}?workspace=${workspaceId}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                          >
                            <Layers className="h-3 w-3" />
                            {dnCount} endpoint{dnCount === 1 ? '' : 's'}
                          </Link>
                          {primaryDn && (
                            <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {primaryDn}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-xs font-mono">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {b.timeout ?? 30}s
                        </span>
                      </TableCell>

                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">
                          {b.max_concurrent_calls ?? 1} call{(b.max_concurrent_calls ?? 1) === 1 ? '' : 's'} max
                        </span>
                      </TableCell>

                      <TableCell className="text-right">
                        <Badge
                          variant={
                            b.status === 'ACTIVE'
                              ? 'success'
                              : b.status === 'INACTIVE'
                              ? 'warning'
                              : 'default'
                          }
                        >
                          {b.status}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Link
                            href={`/protected/buyers/${b.id}?workspace=${workspaceId}`}
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-secondary transition-colors"
                          >
                            Manage
                          </Link>

                          {isOwnerOrAdmin && (
                            <button
                              onClick={() => openEditModal(b)}
                              className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-secondary text-foreground transition-colors cursor-pointer"
                            >
                              <Edit2 className="h-3 w-3 mr-1" />
                              Edit
                            </button>
                          )}

                          {isOwnerOrAdmin && (
                            <button
                              onClick={() => setInvitingBuyer(b)}
                              className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-secondary text-primary font-semibold transition-colors cursor-pointer"
                            >
                              <UserPlus className="h-3 w-3 mr-1" />
                              Invite User
                            </button>
                          )}

                          {isOwnerOrAdmin && (
                            b.status === 'ACTIVE' ? (
                              <button
                                onClick={() => setDeactivatingBuyer(b)}
                                className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-destructive/10 text-destructive transition-colors cursor-pointer"
                                title="Deactivate Buyer Organization"
                              >
                                <Power className="h-3 w-3 mr-1" />
                                Deactivate
                              </button>
                            ) : (
                              <button
                                onClick={() => handleActivate(b.id)}
                                disabled={activatingId === b.id}
                                className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-border bg-surface px-2.5 py-1.5 hover:bg-success/10 text-success transition-colors cursor-pointer disabled:opacity-50"
                                title="Activate Buyer Organization"
                              >
                                {activatingId === b.id ? (
                                  <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                                ) : (
                                  <Power className="h-3 w-3 mr-1" />
                                )}
                                Activate
                              </button>
                            )
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Create Buyer Organization Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-foreground">Create Buyer Organization</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Add a new purchasing organization. You can configure destination number endpoints now or later.
            </p>

            <form onSubmit={handleCreate} className="space-y-4 mt-5">
              <div className="space-y-1.5">
                <Label htmlFor="buyer-name" className="text-xs font-semibold">
                  Organization Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="buyer-name"
                  type="text"
                  placeholder="e.g. Acme Healthcare Partners"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (createValidationErrors.name) {
                      setCreateValidationErrors((prev) => ({ ...prev, name: undefined }));
                    }
                  }}
                  className={createValidationErrors.name ? 'border-destructive' : ''}
                />
                {createValidationErrors.name && (
                  <p className="text-xs text-destructive mt-1">{createValidationErrors.name}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="buyer-email" className="text-xs font-semibold">
                  Organization Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="buyer-email"
                  type="email"
                  placeholder="e.g. ops@acmehealthcare.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (createValidationErrors.email) {
                      setCreateValidationErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  className={createValidationErrors.email ? 'border-destructive' : ''}
                />
                {createValidationErrors.email && (
                  <p className="text-xs text-destructive mt-1">{createValidationErrors.email}</p>
                )}
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Initial Endpoint (Optional)
                </span>
                <p className="text-xs text-muted-foreground">
                  You can specify an initial phone endpoint now, or add multiple endpoints from the buyer details page.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="buyer-destination" className="text-xs font-medium">
                    Destination Phone Number
                  </Label>
                  <Input
                    id="buyer-destination"
                    type="text"
                    placeholder="e.g. +15551234567"
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      if (createValidationErrors.destination) {
                        setCreateValidationErrors((prev) => ({ ...prev, destination: undefined }));
                      }
                    }}
                    className={createValidationErrors.destination ? 'border-destructive' : ''}
                  />
                  {createValidationErrors.destination && (
                    <p className="text-xs text-destructive mt-1">{createValidationErrors.destination}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="buyer-timeout" className="text-xs font-medium">
                      Ring Timeout (sec)
                    </Label>
                    <Input
                      id="buyer-timeout"
                      type="number"
                      min={5}
                      max={300}
                      value={timeout}
                      onChange={(e) => {
                        setTimeoutVal(parseInt(e.target.value, 10) || 0);
                        if (createValidationErrors.timeout) {
                          setCreateValidationErrors((prev) => ({ ...prev, timeout: undefined }));
                        }
                      }}
                      className={createValidationErrors.timeout ? 'border-destructive' : ''}
                    />
                    {createValidationErrors.timeout && (
                      <p className="text-xs text-destructive mt-1">{createValidationErrors.timeout}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="buyer-concurrency" className="text-xs font-medium">
                      Concurrency Limit <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="buyer-concurrency"
                      type="number"
                      min={1}
                      max={1000}
                      value={maxConcurrentCalls}
                      onChange={(e) => {
                        setMaxConcurrentCalls(e.target.value);
                        if (createValidationErrors.maxConcurrentCalls) {
                          setCreateValidationErrors((prev) => ({ ...prev, maxConcurrentCalls: undefined }));
                        }
                      }}
                      className={createValidationErrors.maxConcurrentCalls ? 'border-destructive' : ''}
                    />
                    {createValidationErrors.maxConcurrentCalls && (
                      <p className="text-xs text-destructive mt-1">{createValidationErrors.maxConcurrentCalls}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? (
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Creating...
                    </span>
                  ) : (
                    'Create Organization'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Buyer Organization Modal */}
      {editingBuyer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-foreground">Edit Buyer Organization</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Update organization identity, corporate email, and organization-level capacity.
            </p>

            <form onSubmit={handleEditSubmit} className="space-y-4 mt-5">
              <div className="space-y-1.5">
                <Label htmlFor="edit-buyer-name" className="text-xs font-semibold">
                  Organization Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-buyer-name"
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    if (editValidationErrors.name) {
                      setEditValidationErrors((prev) => ({ ...prev, name: undefined }));
                    }
                  }}
                  className={editValidationErrors.name ? 'border-destructive' : ''}
                />
                {editValidationErrors.name && (
                  <p className="text-xs text-destructive mt-1">{editValidationErrors.name}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-buyer-email" className="text-xs font-semibold">
                  Corporate Email
                </Label>
                <Input
                  id="edit-buyer-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => {
                    setEditEmail(e.target.value);
                    if (editValidationErrors.email) {
                      setEditValidationErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  placeholder="e.g. contact@buyer.com"
                  className={editValidationErrors.email ? 'border-destructive' : ''}
                />
                {editValidationErrors.email && (
                  <p className="text-xs text-destructive mt-1">{editValidationErrors.email}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-buyer-timeout" className="text-xs font-semibold">
                    Ring Timeout (sec)
                  </Label>
                  <Input
                    id="edit-buyer-timeout"
                    type="number"
                    min={5}
                    max={300}
                    value={editTimeout}
                    onChange={(e) => {
                      setEditTimeout(parseInt(e.target.value, 10) || 0);
                      if (editValidationErrors.timeout) {
                        setEditValidationErrors((prev) => ({ ...prev, timeout: undefined }));
                      }
                    }}
                    className={editValidationErrors.timeout ? 'border-destructive' : ''}
                  />
                  {editValidationErrors.timeout && (
                    <p className="text-xs text-destructive mt-1">{editValidationErrors.timeout}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-buyer-concurrency" className="text-xs font-semibold">
                    Org Concurrency Limit
                  </Label>
                  <Input
                    id="edit-buyer-concurrency"
                    type="number"
                    min={1}
                    max={1000}
                    value={editMaxConcurrentCalls}
                    onChange={(e) => {
                      setEditMaxConcurrentCalls(e.target.value);
                      if (editValidationErrors.maxConcurrentCalls) {
                        setEditValidationErrors((prev) => ({ ...prev, maxConcurrentCalls: undefined }));
                      }
                    }}
                    className={editValidationErrors.maxConcurrentCalls ? 'border-destructive' : ''}
                  />
                  {editValidationErrors.maxConcurrentCalls && (
                    <p className="text-xs text-destructive mt-1">{editValidationErrors.maxConcurrentCalls}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingBuyer(null)}
                  disabled={isSubmittingEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmittingEdit}>
                  {isSubmittingEdit ? (
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving...
                    </span>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate ConfirmDialog */}
      <ConfirmDialog
        open={Boolean(deactivatingBuyer)}
        onOpenChange={(open) => !open && setDeactivatingBuyer(null)}
        title="Deactivate Buyer Organization"
        description={`Are you sure you want to deactivate "${deactivatingBuyer?.name}"? All destination numbers under this organization will be skipped during campaign call routing.`}
        confirmText="Deactivate"
        destructive
        isLoading={isSubmittingDeactivate}
        onConfirm={handleDeactivateSubmit}
      />

      {/* Invite User Dialog */}
      {invitingBuyer && workspaceId && (
        <InviteUserDialog
          isOpen={Boolean(invitingBuyer)}
          onClose={() => setInvitingBuyer(null)}
          workspaceId={workspaceId}
          participantType="BUYER"
          entityId={invitingBuyer.id}
          entityName={invitingBuyer.name}
          onSuccess={() => {
            setSuccess(`Invitation link generated for ${invitingBuyer.name}.`);
          }}
        />
      )}
    </div>
  );
}
