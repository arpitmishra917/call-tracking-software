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
import {
  ArrowLeft,
  UserSquare2,
  Phone,
  AlertCircle,
  Info,
  Target,
  Clock,
  Mail,
  Users,
  Edit2,
  Power,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  Plus,
  Trash2,
  Layers,
  PhoneCall,
  ExternalLink,
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InviteUserDialog } from '@/components/invite-user-dialog';

export interface DestinationNumberDetail {
  id: string;
  destination_number: string;
  name?: string | null;
  status: string;
  timeout: number;
  max_concurrent_calls: number;
  created_at: string;
  campaign_destinations?: Array<{
    id: string;
    priority: number;
    weight: number;
    campaign: {
      id: string;
      name: string;
      status: string;
    };
  }>;
}

export interface BuyerDetail {
  id: string;
  name: string;
  email?: string | null;
  destination_number?: string | null;
  status: string;
  timeout?: number | null;
  max_concurrent_calls?: number | null;
  created_at: string;
  destination_numbers?: DestinationNumberDetail[];
  campaigns?: Array<{
    id: string;
    priority: number;
    campaign: {
      id: string;
      name: string;
      status: string;
    };
  }>;
}

export interface BuyerInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export default function BuyerDetailPage({
  params,
}: {
  params: Promise<{ buyerId: string }> | { buyerId: string };
}) {
  const unwrappedParams = params instanceof Promise ? use(params) : (params as { buyerId: string });
  const buyerId = unwrappedParams.buyerId;
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [destinationNumbers, setDestinationNumbers] = useState<DestinationNumberDetail[]>([]);
  const [invitations, setInvitations] = useState<BuyerInvitation[]>([]);
  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Edit Org State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTimeout, setEditTimeout] = useState(30);
  const [editMaxConcurrentCalls, setEditMaxConcurrentCalls] = useState<number | string>(1);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editErrors, setEditErrors] = useState<{ name?: string; email?: string; timeout?: string; maxConcurrentCalls?: string }>({});

  // Org Deactivate State
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isSubmittingDeactivate, setIsSubmittingDeactivate] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  // Destination Numbers Management State (B2)
  const [isCreateDnOpen, setIsCreateDnOpen] = useState(false);
  const [dnNumber, setDnNumber] = useState('');
  const [dnName, setDnName] = useState('');
  const [dnTimeout, setDnTimeout] = useState(30);
  const [dnMaxConcurrentCalls, setDnMaxConcurrentCalls] = useState<number | string>(1);
  const [isSubmittingDnCreate, setIsSubmittingDnCreate] = useState(false);
  const [dnCreateErrors, setDnCreateErrors] = useState<{ destinationNumber?: string; timeout?: string; maxConcurrentCalls?: string }>({});

  // Edit Destination Number State
  const [editingDn, setEditingDn] = useState<DestinationNumberDetail | null>(null);
  const [editDnName, setEditDnName] = useState('');
  const [editDnTimeout, setEditDnTimeout] = useState(30);
  const [editDnMaxConcurrentCalls, setEditDnMaxConcurrentCalls] = useState<number | string>(1);
  const [isSubmittingDnEdit, setIsSubmittingDnEdit] = useState(false);
  const [editDnErrors, setEditDnErrors] = useState<{ timeout?: string; maxConcurrentCalls?: string }>({});

  // Delete Destination Number State
  const [deletingDn, setDeletingDn] = useState<DestinationNumberDetail | null>(null);
  const [isSubmittingDnDelete, setIsSubmittingDnDelete] = useState(false);

  // Toggle Destination Status State
  const [togglingDnId, setTogglingDnId] = useState<string | null>(null);

  // Phone validation (E.164 format)
  function validatePhoneNumber(phone: string): boolean {
    const cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    return /^\+?[1-9]\d{6,14}$/.test(cleaned);
  }

  function validateEmail(emailStr: string): boolean {
    const trimmed = emailStr.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  useEffect(() => {
    async function loadBuyerAndContext() {
      setLoading(true);
      setError(null);
      try {
        const [buyerData, dnsData, workspaces, invData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}`),
          apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}/destination-numbers`).catch(() => []),
          apiFetch('/workspaces').catch(() => null),
          apiFetch(`/workspaces/${workspaceId}/invitations`).catch(() => []),
        ]);

        setBuyer(buyerData);
        setEditName(buyerData.name);
        setEditEmail(buyerData.email || '');
        setEditTimeout(buyerData.timeout ?? 30);
        setEditMaxConcurrentCalls(buyerData.max_concurrent_calls ?? 1);

        const dns = Array.isArray(dnsData) ? dnsData : buyerData.destination_numbers || [];
        setDestinationNumbers(dns);

        if (Array.isArray(workspaces)) {
          const ws = workspaces.find((w: any) => w.id === workspaceId);
          setIsOwnerOrAdmin(ws?.role === 'OWNER' || ws?.role === 'ADMIN');
        }

        const allInvs = Array.isArray(invData) ? invData : invData?.items || [];
        setInvitations(allInvs.filter((inv: any) => inv.buyer_id === buyerId));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Buyer Organization not found or access denied.');
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId && buyerId) {
      loadBuyerAndContext();
    }
  }, [workspaceId, buyerId]);

  async function refreshDestinationNumbers() {
    if (!workspaceId || !buyerId) return;
    try {
      const dns = await apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}/destination-numbers`);
      setDestinationNumbers(Array.isArray(dns) ? dns : []);
    } catch {
      // ignore
    }
  }

  async function refreshBuyer() {
    if (!workspaceId || !buyerId) return;
    try {
      const buyerData = await apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}`);
      setBuyer(buyerData);
      setEditName(buyerData.name);
      setEditEmail(buyerData.email || '');
      setEditTimeout(buyerData.timeout ?? 30);
      setEditMaxConcurrentCalls(buyerData.max_concurrent_calls ?? 1);
      refreshDestinationNumbers();
    } catch {
      // ignore
    }
  }

  async function refreshInvitations() {
    if (!workspaceId || !buyerId) return;
    try {
      const invData = await apiFetch(`/workspaces/${workspaceId}/invitations`);
      const allInvs = Array.isArray(invData) ? invData : invData?.items || [];
      setInvitations(allInvs.filter((inv: any) => inv.buyer_id === buyerId));
    } catch {
      // ignore
    }
  }

  function handleCopyId() {
    if (buyer?.id && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(buyer.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  }

  // Edit Org Submit
  async function handleEditOrgSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !buyerId) return;

    const errors: { name?: string; email?: string; timeout?: string; maxConcurrentCalls?: string } = {};
    if (!editName.trim()) errors.name = 'Organization name is required.';
    if (editEmail.trim() && !validateEmail(editEmail)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!Number.isInteger(editTimeout) || editTimeout < 5 || editTimeout > 300) {
      errors.timeout = 'Timeout must be between 5 and 300 seconds.';
    }
    const numMax = Number(editMaxConcurrentCalls);
    if (isNaN(numMax) || !Number.isInteger(numMax) || numMax < 1 || numMax > 1000) {
      errors.maxConcurrentCalls = 'Concurrency limit must be an integer between 1 and 1000.';
    }

    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }

    setEditErrors({});
    setIsSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          ...(editEmail.trim() ? { email: editEmail.trim().toLowerCase() } : {}),
          timeout: editTimeout,
          max_concurrent_calls: numMax,
        }),
      });
      setSuccess('Buyer Organization details updated successfully.');
      setIsEditOpen(false);
      refreshBuyer();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update organization.');
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  // Handle Org Activate / Deactivate
  async function handleToggleOrgStatus() {
    if (!workspaceId || !buyer) return;
    const isActivatingAction = buyer.status !== 'ACTIVE';
    if (isActivatingAction) {
      setIsActivating(true);
    } else {
      setIsSubmittingDeactivate(true);
    }
    setError(null);
    setSuccess(null);

    try {
      const endpoint = isActivatingAction ? 'activate' : 'archive';
      await apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}/${endpoint}`, {
        method: 'POST',
      });
      setSuccess(`Buyer Organization ${isActivatingAction ? 'activated' : 'deactivated'} successfully.`);
      setIsDeactivateOpen(false);
      refreshBuyer();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Failed to ${isActivatingAction ? 'activate' : 'deactivate'} organization.`);
    } finally {
      setIsActivating(false);
      setIsSubmittingDeactivate(false);
    }
  }

  // Create Destination Number Submit (B2)
  async function handleCreateDestinationNumber(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !buyerId) return;

    const errors: { destinationNumber?: string; timeout?: string; maxConcurrentCalls?: string } = {};
    if (!dnNumber.trim()) {
      errors.destinationNumber = 'Destination phone number is required.';
    } else if (!validatePhoneNumber(dnNumber)) {
      errors.destinationNumber = 'Please enter a valid E.164 phone number (e.g. +15551234567).';
    }
    if (!Number.isInteger(dnTimeout) || dnTimeout < 5 || dnTimeout > 300) {
      errors.timeout = 'Timeout must be an integer between 5 and 300 seconds.';
    }
    const numMax = Number(dnMaxConcurrentCalls);
    if (isNaN(numMax) || !Number.isInteger(numMax) || numMax < 1 || numMax > 1000) {
      errors.maxConcurrentCalls = 'Concurrency limit must be an integer between 1 and 1000.';
    }

    if (Object.keys(errors).length > 0) {
      setDnCreateErrors(errors);
      return;
    }

    setDnCreateErrors({});
    setIsSubmittingDnCreate(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}/destination-numbers`, {
        method: 'POST',
        body: JSON.stringify({
          destinationNumber: dnNumber.trim(),
          name: dnName.trim() || undefined,
          timeout: dnTimeout,
          max_concurrent_calls: numMax,
        }),
      });

      setSuccess(`Destination number ${dnNumber.trim()} added successfully.`);
      setDnNumber('');
      setDnName('');
      setDnTimeout(30);
      setDnMaxConcurrentCalls(1);
      setIsCreateDnOpen(false);
      refreshDestinationNumbers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create destination number.');
    } finally {
      setIsSubmittingDnCreate(false);
    }
  }

  // Edit Destination Number Submit
  async function handleEditDestinationNumber(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !editingDn) return;

    const errors: { timeout?: string; maxConcurrentCalls?: string } = {};
    if (!Number.isInteger(editDnTimeout) || editDnTimeout < 5 || editDnTimeout > 300) {
      errors.timeout = 'Timeout must be between 5 and 300 seconds.';
    }
    const numMax = Number(editDnMaxConcurrentCalls);
    if (isNaN(numMax) || !Number.isInteger(numMax) || numMax < 1 || numMax > 1000) {
      errors.maxConcurrentCalls = 'Concurrency limit must be an integer between 1 and 1000.';
    }

    if (Object.keys(errors).length > 0) {
      setEditDnErrors(errors);
      return;
    }

    setEditDnErrors({});
    setIsSubmittingDnEdit(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/destination-numbers/${editingDn.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editDnName.trim() || null,
          timeout: editDnTimeout,
          max_concurrent_calls: numMax,
        }),
      });

      setSuccess(`Destination number updated successfully.`);
      setEditingDn(null);
      refreshDestinationNumbers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update destination number.');
    } finally {
      setIsSubmittingDnEdit(false);
    }
  }

  // Toggle Destination Active/Inactive Status
  async function handleToggleDnStatus(dn: DestinationNumberDetail) {
    if (!workspaceId) return;
    setTogglingDnId(dn.id);
    setError(null);
    setSuccess(null);

    const isActivatingAction = dn.status !== 'ACTIVE';
    const actionEndpoint = isActivatingAction ? 'activate' : 'archive';

    try {
      await apiFetch(`/workspaces/${workspaceId}/destination-numbers/${dn.id}/${actionEndpoint}`, {
        method: 'POST',
      });
      setSuccess(`Destination number ${dn.destination_number} ${isActivatingAction ? 'activated' : 'deactivated'} successfully.`);
      refreshDestinationNumbers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update destination status.');
    } finally {
      setTogglingDnId(null);
    }
  }

  // Delete Destination Number Submit
  async function handleDeleteDnSubmit() {
    if (!workspaceId || !deletingDn) return;
    setIsSubmittingDnDelete(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/destination-numbers/${deletingDn.id}`, {
        method: 'DELETE',
      });
      setSuccess(`Destination number ${deletingDn.destination_number} deleted successfully.`);
      setDeletingDn(null);
      refreshDestinationNumbers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete destination number.');
    } finally {
      setIsSubmittingDnDelete(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin text-primary mr-2" />
        Loading Buyer Organization details...
      </div>
    );
  }

  if (error && !buyer) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md border border-error/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error || 'Buyer Organization not found.'}</p>
        </div>
        <Link
          href={`/protected/buyers?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-border bg-surface hover:bg-muted h-10 px-4 py-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Buyers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12 relative">
      {/* Top Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/protected/buyers?workspace=${workspaceId}`}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-muted h-10 w-10 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="sr-only">Back</span>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">{buyer?.name}</h1>
            <Badge variant={buyer?.status === 'ACTIVE' ? 'success' : 'warning'} className="ml-2">
              {buyer?.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground ml-11">
            <span className="font-mono text-xs">{buyer?.id}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyId}
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="Copy Buyer ID"
            >
              {copiedId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            </Button>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isOwnerOrAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit Organization
            </Button>
          )}

          {isOwnerOrAdmin && (
            buyer?.status === 'ACTIVE' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDeactivateOpen(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Power className="w-3.5 h-3.5 mr-1" />
                Deactivate Org
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleOrgStatus}
                disabled={isActivating}
                className="text-success hover:text-success hover:bg-success/10"
              >
                {isActivating ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Power className="w-3.5 h-3.5 mr-1" />}
                Activate Org
              </Button>
            )
          )}

          {isOwnerOrAdmin && (
            <Button
              size="sm"
              onClick={() => setIsInviteOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Users className="w-3.5 h-3.5" />
              Invite Portal User
            </Button>
          )}
        </div>
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md text-sm border border-error-muted flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-success-muted text-success-muted-foreground p-4 rounded-md text-sm border border-success-muted flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Organization Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 border-border bg-surface/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-primary" /> Corporate Email
          </span>
          <p className="font-mono text-sm font-semibold mt-1">
            {buyer?.email || <span className="text-muted-foreground font-normal">Not configured</span>}
          </p>
        </Card>

        <Card className="p-4 border-border bg-surface/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" /> Destination Endpoints
          </span>
          <p className="text-xl font-bold font-mono mt-1">
            {destinationNumbers.length}
          </p>
        </Card>

        <Card className="p-4 border-border bg-surface/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary" /> Default Timeout
          </span>
          <p className="text-xl font-bold font-mono mt-1">
            {buyer?.timeout ?? 30}s
          </p>
        </Card>

        <Card className="p-4 border-border bg-surface/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-primary" /> Org Concurrency
          </span>
          <p className="text-xl font-bold font-mono mt-1">
            {buyer?.max_concurrent_calls ?? 1} max call{(buyer?.max_concurrent_calls ?? 1) === 1 ? '' : 's'}
          </p>
        </Card>
      </div>

      {/* SECTION 1: DESTINATION NUMBERS MANAGEMENT (PART B2) */}
      <Card>
        <CardHeader className="pb-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Destination Numbers (Inbound Endpoints)
            </CardTitle>
            <CardDescription className="mt-1">
              Independent phone destinations owned exclusively by this Buyer Organization. Campaigns route to these endpoints.
            </CardDescription>
          </div>

          {isOwnerOrAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setDnCreateErrors({});
                setIsCreateDnOpen(true);
              }}
              className="flex items-center gap-1.5 self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              Add Destination Number
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {destinationNumbers.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Phone className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-sm">No destination numbers configured</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Add telephone endpoints to receive routed calls from marketing campaigns.
                </p>
              </div>
              {isOwnerOrAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCreateDnOpen(true)}
                  className="mt-2"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add First Destination
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="min-w-[160px]">Label / Friendly Name</TableHead>
                  <TableHead className="min-w-[180px]">Destination Number</TableHead>
                  <TableHead className="min-w-[110px]">Timeout</TableHead>
                  <TableHead className="min-w-[140px]">Concurrency Limit</TableHead>
                  <TableHead className="min-w-[160px]">Assigned Campaigns</TableHead>
                  <TableHead className="min-w-[100px] text-center">Status</TableHead>
                  {isOwnerOrAdmin && <TableHead className="text-right min-w-[180px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {destinationNumbers.map((dn) => (
                  <TableRow key={dn.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="font-medium text-foreground">
                      {dn.name || <span className="text-muted-foreground italic font-normal">Standard Line</span>}
                    </TableCell>

                    <TableCell className="font-mono text-sm font-semibold">
                      <span className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        {dn.destination_number}
                      </span>
                    </TableCell>

                    <TableCell className="text-sm font-mono text-muted-foreground">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-xs font-mono">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        {dn.timeout}s
                      </span>
                    </TableCell>

                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">
                        {dn.max_concurrent_calls} max call{dn.max_concurrent_calls === 1 ? '' : 's'}
                      </span>
                    </TableCell>

                    <TableCell className="text-sm">
                      {dn.campaign_destinations && dn.campaign_destinations.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {dn.campaign_destinations.map((cd, cdIndex) => (
                            <Link
                              key={cd.id || cd.campaign?.id || cdIndex}
                              href={`/protected/campaigns/${cd.campaign?.id}?workspace=${workspaceId}`}
                              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border border-border bg-surface hover:bg-muted transition-colors font-medium"
                            >
                              <Target className="w-2.5 h-2.5 text-primary" />
                              {cd.campaign.name}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">None</span>
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge variant={dn.status === 'ACTIVE' ? 'success' : 'warning'} className="text-[10px] px-2">
                        {dn.status}
                      </Badge>
                    </TableCell>

                    {isOwnerOrAdmin && (
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingDn(dn);
                              setEditDnName(dn.name || '');
                              setEditDnTimeout(dn.timeout);
                              setEditDnMaxConcurrentCalls(dn.max_concurrent_calls);
                              setEditDnErrors({});
                            }}
                            className="h-8 px-2 text-xs"
                          >
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={togglingDnId === dn.id}
                            onClick={() => handleToggleDnStatus(dn)}
                            className={`h-8 px-2 text-xs ${
                              dn.status === 'ACTIVE'
                                ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
                                : 'text-success hover:text-success hover:bg-success/10'
                            }`}
                          >
                            {togglingDnId === dn.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Power className="w-3 h-3 mr-1" />
                            )}
                            {dn.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingDn(dn)}
                            className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Delete Destination Number"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* SECTION 2: CAMPAIGN ASSIGNMENTS & HISTORICAL REACH */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Campaign Assignments
          </CardTitle>
          <CardDescription>
            Campaigns currently routing traffic to this Buyer Organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 p-0">
          {!buyer?.campaigns || buyer.campaigns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              This organization is not currently assigned to any active campaigns.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="w-[100px] text-center">Priority</TableHead>
                  <TableHead>Campaign Name</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyer.campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-center font-mono font-medium text-xs">
                      #{c.priority}
                    </TableCell>
                    <TableCell className="font-semibold">
                      <Link
                        href={`/protected/campaigns/${c.campaign.id}?workspace=${workspaceId}`}
                        className="hover:underline hover:text-primary transition-colors inline-flex items-center gap-1.5"
                      >
                        {c.campaign.name}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={c.campaign.status === 'ACTIVE' ? 'success' : 'default'} className="text-[10px]">
                        {c.campaign.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* SECTION 3: BUYER PORTAL ACCESS & INVITATIONS */}
      <Card>
        <CardHeader className="pb-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Buyer Portal Access & Invitations
            </CardTitle>
            <CardDescription>
              Authorized partner members with reporting access to this Buyer Organization.
            </CardDescription>
          </div>

          {isOwnerOrAdmin && (
            <Button size="sm" onClick={() => setIsInviteOpen(true)} className="flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              Invite Portal User
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-4 p-0">
          {invitations.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No pending or accepted portal invitations for this Buyer Organization.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Email Address</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent On</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.email}</TableCell>
                    <TableCell className="text-xs uppercase font-medium">{inv.role}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={inv.status === 'ACCEPTED' ? 'success' : 'outline'} className="text-[10px]">
                        {inv.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* MODAL: ADD DESTINATION NUMBER (B2) */}
      {isCreateDnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-foreground">Add Destination Number</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Configure a new telephone endpoint for <span className="font-semibold text-foreground">{buyer?.name}</span>.
            </p>

            <form onSubmit={handleCreateDestinationNumber} className="space-y-4 mt-5">
              <div className="space-y-1.5">
                <Label htmlFor="dn-number" className="text-xs font-semibold">
                  Destination Phone Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="dn-number"
                  type="text"
                  placeholder="e.g. +15551234567"
                  value={dnNumber}
                  onChange={(e) => {
                    setDnNumber(e.target.value);
                    if (dnCreateErrors.destinationNumber) {
                      setDnCreateErrors((prev) => ({ ...prev, destinationNumber: undefined }));
                    }
                  }}
                  className={dnCreateErrors.destinationNumber ? 'border-destructive' : ''}
                />
                {dnCreateErrors.destinationNumber && (
                  <p className="text-xs text-destructive mt-1">{dnCreateErrors.destinationNumber}</p>
                )}
                <p className="text-[11px] text-muted-foreground">Must be a valid E.164 phone number.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dn-name" className="text-xs font-semibold">
                  Friendly Label (Optional)
                </Label>
                <Input
                  id="dn-name"
                  type="text"
                  placeholder="e.g. Primary Call Center, West Coast Desk"
                  value={dnName}
                  onChange={(e) => setDnName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dn-timeout" className="text-xs font-semibold">
                    Ring Timeout (sec)
                  </Label>
                  <Input
                    id="dn-timeout"
                    type="number"
                    min={5}
                    max={300}
                    value={dnTimeout}
                    onChange={(e) => {
                      setDnTimeout(parseInt(e.target.value, 10) || 0);
                      if (dnCreateErrors.timeout) {
                        setDnCreateErrors((prev) => ({ ...prev, timeout: undefined }));
                      }
                    }}
                    className={dnCreateErrors.timeout ? 'border-destructive' : ''}
                  />
                  {dnCreateErrors.timeout && (
                    <p className="text-xs text-destructive mt-1">{dnCreateErrors.timeout}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dn-concurrency" className="text-xs font-semibold">
                    Max Concurrent Calls
                  </Label>
                  <Input
                    id="dn-concurrency"
                    type="number"
                    min={1}
                    max={1000}
                    value={dnMaxConcurrentCalls}
                    onChange={(e) => {
                      setDnMaxConcurrentCalls(e.target.value);
                      if (dnCreateErrors.maxConcurrentCalls) {
                        setDnCreateErrors((prev) => ({ ...prev, maxConcurrentCalls: undefined }));
                      }
                    }}
                    className={dnCreateErrors.maxConcurrentCalls ? 'border-destructive' : ''}
                  />
                  {dnCreateErrors.maxConcurrentCalls && (
                    <p className="text-xs text-destructive mt-1">{dnCreateErrors.maxConcurrentCalls}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateDnOpen(false)}
                  disabled={isSubmittingDnCreate}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmittingDnCreate}>
                  {isSubmittingDnCreate ? (
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Adding...
                    </span>
                  ) : (
                    'Add Destination Number'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT DESTINATION NUMBER */}
      {editingDn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-foreground">Edit Destination Number</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Configure parameters for endpoint <span className="font-mono font-semibold text-foreground">{editingDn.destination_number}</span>.
            </p>

            <form onSubmit={handleEditDestinationNumber} className="space-y-4 mt-5">
              <div className="space-y-1.5">
                <Label htmlFor="edit-dn-name" className="text-xs font-semibold">
                  Friendly Label
                </Label>
                <Input
                  id="edit-dn-name"
                  type="text"
                  placeholder="e.g. Primary Line"
                  value={editDnName}
                  onChange={(e) => setEditDnName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-dn-timeout" className="text-xs font-semibold">
                    Ring Timeout (sec)
                  </Label>
                  <Input
                    id="edit-dn-timeout"
                    type="number"
                    min={5}
                    max={300}
                    value={editDnTimeout}
                    onChange={(e) => {
                      setEditDnTimeout(parseInt(e.target.value, 10) || 0);
                      if (editDnErrors.timeout) {
                        setEditDnErrors((prev) => ({ ...prev, timeout: undefined }));
                      }
                    }}
                    className={editDnErrors.timeout ? 'border-destructive' : ''}
                  />
                  {editDnErrors.timeout && (
                    <p className="text-xs text-destructive mt-1">{editDnErrors.timeout}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-dn-concurrency" className="text-xs font-semibold">
                    Max Concurrent Calls
                  </Label>
                  <Input
                    id="edit-dn-concurrency"
                    type="number"
                    min={1}
                    max={1000}
                    value={editDnMaxConcurrentCalls}
                    onChange={(e) => {
                      setEditDnMaxConcurrentCalls(e.target.value);
                      if (editDnErrors.maxConcurrentCalls) {
                        setEditDnErrors((prev) => ({ ...prev, maxConcurrentCalls: undefined }));
                      }
                    }}
                    className={editDnErrors.maxConcurrentCalls ? 'border-destructive' : ''}
                  />
                  {editDnErrors.maxConcurrentCalls && (
                    <p className="text-xs text-destructive mt-1">{editDnErrors.maxConcurrentCalls}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingDn(null)}
                  disabled={isSubmittingDnEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmittingDnEdit}>
                  {isSubmittingDnEdit ? (
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving...
                    </span>
                  ) : (
                    'Save Endpoint'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM: DELETE DESTINATION NUMBER */}
      <ConfirmDialog
        open={Boolean(deletingDn)}
        onOpenChange={(open) => !open && setDeletingDn(null)}
        title="Delete Destination Number"
        description={`Are you sure you want to delete destination number "${deletingDn?.destination_number}"? This will immediately remove it from all assigned campaign waterfalls and stop routing calls to it.`}
        confirmText="Delete Destination"
        destructive
        isLoading={isSubmittingDnDelete}
        onConfirm={handleDeleteDnSubmit}
      />

      {/* MODAL: EDIT BUYER ORGANIZATION */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-foreground">Edit Buyer Organization</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Update organization identity, corporate email, and organization-level capacity limit.
            </p>

            <form onSubmit={handleEditOrgSubmit} className="space-y-4 mt-5">
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-name" className="text-xs font-semibold">
                  Organization Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-org-name"
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    if (editErrors.name) {
                      setEditErrors((prev) => ({ ...prev, name: undefined }));
                    }
                  }}
                  className={editErrors.name ? 'border-destructive' : ''}
                />
                {editErrors.name && (
                  <p className="text-xs text-destructive mt-1">{editErrors.name}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-org-email" className="text-xs font-semibold">
                  Corporate Email
                </Label>
                <Input
                  id="edit-org-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => {
                    setEditEmail(e.target.value);
                    if (editErrors.email) {
                      setEditErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  placeholder="e.g. operations@buyer.com"
                  className={editErrors.email ? 'border-destructive' : ''}
                />
                {editErrors.email && (
                  <p className="text-xs text-destructive mt-1">{editErrors.email}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-org-timeout" className="text-xs font-semibold">
                    Default Timeout (sec)
                  </Label>
                  <Input
                    id="edit-org-timeout"
                    type="number"
                    min={5}
                    max={300}
                    value={editTimeout}
                    onChange={(e) => {
                      setEditTimeout(parseInt(e.target.value, 10) || 0);
                      if (editErrors.timeout) {
                        setEditErrors((prev) => ({ ...prev, timeout: undefined }));
                      }
                    }}
                    className={editErrors.timeout ? 'border-destructive' : ''}
                  />
                  {editErrors.timeout && (
                    <p className="text-xs text-destructive mt-1">{editErrors.timeout}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-org-concurrency" className="text-xs font-semibold">
                    Org Concurrency Limit
                  </Label>
                  <Input
                    id="edit-org-concurrency"
                    type="number"
                    min={1}
                    max={1000}
                    value={editMaxConcurrentCalls}
                    onChange={(e) => {
                      setEditMaxConcurrentCalls(e.target.value);
                      if (editErrors.maxConcurrentCalls) {
                        setEditErrors((prev) => ({ ...prev, maxConcurrentCalls: undefined }));
                      }
                    }}
                    className={editErrors.maxConcurrentCalls ? 'border-destructive' : ''}
                  />
                  {editErrors.maxConcurrentCalls && (
                    <p className="text-xs text-destructive mt-1">{editErrors.maxConcurrentCalls}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditOpen(false)}
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

      {/* CONFIRM: DEACTIVATE BUYER ORGANIZATION */}
      <ConfirmDialog
        open={isDeactivateOpen}
        onOpenChange={setIsDeactivateOpen}
        title="Deactivate Buyer Organization"
        description={`Are you sure you want to deactivate "${buyer?.name}"? Inbound calls will stop routing to all destination numbers under this organization.`}
        confirmText="Deactivate Organization"
        destructive
        isLoading={isSubmittingDeactivate}
        onConfirm={handleToggleOrgStatus}
      />

      {/* MODAL: INVITE BUYER PORTAL USER */}
      {isInviteOpen && workspaceId && (
        <InviteUserDialog
          isOpen={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          workspaceId={workspaceId}
          participantType="BUYER"
          entityId={buyerId}
          entityName={buyer?.name || 'Buyer'}
          onSuccess={() => {
            setSuccess(`Portal invitation sent for ${buyer?.name}.`);
            setIsInviteOpen(false);
            refreshInvitations();
          }}
        />
      )}
    </div>
  );
}
