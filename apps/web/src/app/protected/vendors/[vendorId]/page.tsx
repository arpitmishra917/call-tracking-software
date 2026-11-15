'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowLeft,
  Building2,
  Phone,
  AlertCircle,
  Info,
  Calendar,
  BadgeDollarSign,
  ShieldAlert,
  Mail,
  Users,
  Edit2,
  Power,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  Plus,
  Search,
  Unlink,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InviteUserDialog } from '@/components/invite-user-dialog';

interface PhoneNumber {
  id: string;
  phone_number: string;
  name?: string | null;
  status: string;
  campaign?: {
    id: string;
    name: string;
    status: string;
  } | null;
}

interface VendorDetail {
  id: string;
  name: string;
  status: string;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
  phone_numbers?: PhoneNumber[];
}

interface VendorInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export default function VendorDetailPage({
  params,
}: {
  params: Promise<{ vendorId: string }> | { vendorId: string };
}) {
  const unwrappedParams = params instanceof Promise ? use(params) : (params as { vendorId: string });
  const vendorId = unwrappedParams.vendorId;
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [invitations, setInvitations] = useState<VendorInvitation[]>([]);
  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // Edit State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editValidationError, setEditValidationError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Deactivate State
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isSubmittingDeactivate, setIsSubmittingDeactivate] = useState(false);

  // Activate State
  const [isActivating, setIsActivating] = useState(false);

  // Assign Number Modal State
  const [isAssignNumberOpen, setIsAssignNumberOpen] = useState(false);
  const [workspacePhoneNumbers, setWorkspacePhoneNumbers] = useState<any[]>([]);
  const [isLoadingPhoneNumbers, setIsLoadingPhoneNumbers] = useState(false);
  const [selectedAssignPhoneId, setSelectedAssignPhoneId] = useState('');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');

  // Unassign Number State
  const [unassignPhone, setUnassignPhone] = useState<PhoneNumber | null>(null);
  const [isUnassignOpen, setIsUnassignOpen] = useState(false);
  const [isSubmittingUnassign, setIsSubmittingUnassign] = useState(false);

  useEffect(() => {
    async function loadVendorAndContext() {
      if (!workspaceId || !vendorId) return;
      setLoading(true);
      setError(null);
      setIsForbidden(false);

      try {
        const [data, workspaces, invData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/vendors/${vendorId}`),
          apiFetch('/workspaces').catch(() => null),
          apiFetch(`/workspaces/${workspaceId}/invitations`).catch(() => []),
        ]);
        setVendor(data);
        setEditName(data.name);

        if (Array.isArray(workspaces)) {
          const ws = workspaces.find((w: any) => w.id === workspaceId);
          setIsOwnerOrAdmin(ws?.role === 'OWNER' || ws?.role === 'ADMIN');
        }

        const allInvs = Array.isArray(invData) ? invData : invData?.items || [];
        setInvitations(allInvs.filter((inv: any) => inv.vendor_id === vendorId));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Vendor not found or access denied.';
        if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
          setIsForbidden(true);
          setError('403 Forbidden: You do not have permission to view this vendor.');
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    }

    loadVendorAndContext();
  }, [workspaceId, vendorId]);

  async function refreshVendor() {
    if (!workspaceId || !vendorId) return;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/vendors/${vendorId}`);
      setVendor(data);
      setEditName(data.name);
    } catch {
      // ignore
    }
  }

  async function refreshInvitations() {
    if (!workspaceId || !vendorId) return;
    try {
      const invData = await apiFetch(`/workspaces/${workspaceId}/invitations`);
      const allInvs = Array.isArray(invData) ? invData : invData?.items || [];
      setInvitations(allInvs.filter((inv: any) => inv.vendor_id === vendorId));
    } catch {
      // ignore
    }
  }

  function handleCopyId() {
    if (vendor?.id && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(vendor.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  }

  // Edit Submit
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !vendorId) return;

    if (!editName.trim()) {
      setEditValidationError('Vendor name is required.');
      return;
    }

    setEditValidationError(null);
    setIsSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors/${vendorId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim() }),
      });
      setSuccess('Vendor details updated successfully.');
      setIsEditOpen(false);
      refreshVendor();
    } catch (err: unknown) {
      setError(`Failed to update vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  // Deactivate Submit
  async function handleDeactivateSubmit() {
    if (!workspaceId || !vendorId) return;
    setIsSubmittingDeactivate(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors/${vendorId}/archive`, {
        method: 'POST',
      });
      setSuccess('Vendor deactivated successfully.');
      setIsDeactivateOpen(false);
      refreshVendor();
    } catch (err: unknown) {
      setError(`Failed to deactivate vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingDeactivate(false);
    }
  }

  // Activate Submit
  async function handleActivate() {
    if (!workspaceId || !vendorId) return;
    setIsActivating(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/vendors/${vendorId}/activate`, {
        method: 'POST',
      });
      setSuccess('Vendor activated successfully.');
      refreshVendor();
    } catch (err: unknown) {
      setError(`Failed to activate vendor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsActivating(false);
    }
  }

  // Assign Phone Number Handlers
  async function openAssignNumberModal() {
    if (!workspaceId) return;
    setIsAssignNumberOpen(true);
    setSelectedAssignPhoneId('');
    setAssignSearch('');
    setIsLoadingPhoneNumbers(true);
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/phone-numbers`);
      const items = Array.isArray(data) ? data : data?.items || [];
      setWorkspacePhoneNumbers(items.filter((pn: any) => pn.status !== 'RELEASED'));
    } catch (err: unknown) {
      setError(`Failed to load phone numbers: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingPhoneNumbers(false);
    }
  }

  async function handleAssignNumberSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !vendorId || !selectedAssignPhoneId) return;
    setIsSubmittingAssign(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers/${selectedAssignPhoneId}`, {
        method: 'PUT',
        body: JSON.stringify({ vendorId }),
      });
      setSuccess('Phone number assigned to vendor successfully.');
      setIsAssignNumberOpen(false);
      setSelectedAssignPhoneId('');
      refreshVendor();
    } catch (err: unknown) {
      setError(`Failed to assign phone number: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingAssign(false);
    }
  }

  function openUnassignPhoneDialog(pn: PhoneNumber) {
    setUnassignPhone(pn);
    setIsUnassignOpen(true);
  }

  async function handleConfirmUnassignPhone() {
    if (!workspaceId || !unassignPhone) return;
    setIsSubmittingUnassign(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers/${unassignPhone.id}`, {
        method: 'PUT',
        body: JSON.stringify({ vendorId: null }),
      });
      setSuccess(`Phone number ${unassignPhone.phone_number} unassigned from vendor successfully.`);
      setIsUnassignOpen(false);
      setUnassignPhone(null);
      refreshVendor();
    } catch (err: unknown) {
      setError(`Failed to unassign phone number: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingUnassign(false);
    }
  }

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm font-medium">Loading vendor profile...</span>
      </div>
    );
  }

  if (isForbidden) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 my-8">
        <div className="bg-destructive/10 text-destructive p-6 rounded-md border border-destructive/20 flex items-start gap-4">
          <ShieldAlert className="w-6 h-6 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-semibold text-lg">Access Denied</h3>
            <p className="text-sm opacity-90">{error}</p>
          </div>
        </div>
        <Link
          href={`/protected/vendors?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-border bg-surface hover:bg-secondary h-10 px-4 py-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Vendors
        </Link>
      </div>
    );
  }

  if (error || !vendor) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 my-8">
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md border border-error-muted flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error || 'Vendor not found.'}</p>
        </div>
        <Link
          href={`/protected/vendors?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-border bg-surface hover:bg-secondary h-10 px-4 py-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Vendors
        </Link>
      </div>
    );
  }

  const filteredWorkspaceNumbers = workspacePhoneNumbers.filter((pn: any) => {
    if (!assignSearch.trim()) return true;
    const term = assignSearch.toLowerCase();
    return (
      pn.phone_number?.toLowerCase().includes(term) ||
      pn.name?.toLowerCase().includes(term) ||
      pn.campaign?.name?.toLowerCase().includes(term)
    );
  });

  const selectedAssignPhone = workspacePhoneNumbers.find(
    (pn: any) => pn.id === selectedAssignPhoneId
  );

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Breadcrumb */}
      <div>
        <Link
          href={`/protected/vendors?workspace=${workspaceId}`}
          className="inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground transition-colors gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Vendors
        </Link>
      </div>

      {/* Hero Header Card */}
      <Card className="border-border shadow-xs bg-surface/50">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Building2 className="h-7 w-7" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">{vendor.name}</h1>
                  <Badge variant={vendor.status === 'ACTIVE' ? 'success' : 'warning'}>
                    {vendor.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground font-mono">
                  <span>ID: {vendor.id}</span>
                  <button
                    onClick={handleCopyId}
                    title="Copy Vendor ID"
                    className="hover:text-foreground transition-colors cursor-pointer"
                  >
                    {copiedId ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-60 hover:opacity-100" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditValidationError(null);
                  setIsEditOpen(true);
                }}
                className="flex items-center gap-1.5"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </Button>

              {isOwnerOrAdmin && (
                <Button
                  size="sm"
                  onClick={() => setIsInviteOpen(true)}
                  className="flex items-center gap-1.5 shadow-sm"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Invite User
                </Button>
              )}

              {vendor.status === 'ACTIVE' ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsDeactivateOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <Power className="h-3.5 w-3.5" />
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleActivate}
                  disabled={isActivating}
                  className="flex items-center gap-1.5 text-success border-success/30 hover:bg-success/10"
                >
                  <Power className="h-3.5 w-3.5" />
                  {isActivating ? 'Activating...' : 'Activate'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Vendor ID
          </span>
          <span className="text-sm font-bold font-mono tracking-wide text-foreground mt-2 truncate">
            {vendor.id}
          </span>
        </Card>

        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Created Date
          </span>
          <span className="text-sm font-bold text-foreground mt-2">
            {vendor.created_at ? new Date(vendor.created_at).toLocaleDateString() : '—'}
          </span>
        </Card>

        <Card className="p-4 flex flex-col justify-between border-border bg-surface/50 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Assigned Numbers
          </span>
          <span className="text-lg font-bold text-foreground mt-2">
            {vendor.phone_numbers?.length || 0}
          </span>
        </Card>
      </div>

      {/* Main Grid: Phone Numbers & User Invitations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Information & Terms */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Vendor Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-5">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Vendor Name
                </span>
                <p className="font-semibold text-foreground text-sm">{vendor.name}</p>
              </div>

              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Registration Timestamp
                </span>
                <p className="text-sm text-foreground">
                  {vendor.created_at ? new Date(vendor.created_at).toLocaleString() : '—'}
                </p>
              </div>

              {vendor.updated_at && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Last Profile Update
                  </span>
                  <p className="text-sm text-foreground">
                    {new Date(vendor.updated_at).toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Commercial Terms Notice Card */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <BadgeDollarSign className="w-4 h-4 text-primary" />
                Commercial Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 text-xs text-muted-foreground space-y-2">
              <p>
                Vendor payout rates and terms are defined on associated campaigns (Campaign Default Payout).
              </p>
              <p>
                No custom payout overrides or commercial rate configuration endpoints exist in the vendor record.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Assigned Numbers & Invitations */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="flex flex-col border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  Assigned Phone Numbers
                </CardTitle>
                <CardDescription className="mt-1">
                  Inbound tracking numbers attributed to this traffic vendor.
                </CardDescription>
              </div>
              {isOwnerOrAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openAssignNumberModal}
                  className="flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Assign Number
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {!vendor.phone_numbers || vendor.phone_numbers.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-12 flex flex-col items-center gap-3">
                  <Phone className="h-8 w-8 text-muted-foreground/40" />
                  <div>No phone numbers currently assigned to this vendor.</div>
                  {isOwnerOrAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openAssignNumberModal}
                      className="mt-1 flex items-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Assign Phone Number
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Phone Number</TableHead>
                      <TableHead>Assigned Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      {isOwnerOrAdmin && <TableHead className="text-right">Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendor.phone_numbers.map((pn) => (
                      <TableRow key={pn.id} className="hover:bg-muted/20">
                        <TableCell className="font-mono text-sm font-medium">
                          {pn.phone_number}
                          {pn.name && (
                            <span className="block text-xs font-sans text-muted-foreground">
                              {pn.name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {pn.campaign ? (
                            <Link
                              href={`/protected/campaigns/${pn.campaign.id}?workspace=${workspaceId}`}
                              className="hover:underline hover:text-primary transition-colors font-medium"
                            >
                              {pn.campaign.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground italic">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={pn.status === 'ACTIVE' ? 'success' : 'warning'}
                            className="text-[10px] px-1.5 h-5"
                          >
                            {pn.status}
                          </Badge>
                        </TableCell>
                        {isOwnerOrAdmin && (
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openUnassignPhoneDialog(pn)}
                              className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                            >
                              Unassign
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* User Invitations Card */}
          {isOwnerOrAdmin && (
            <Card className="flex flex-col border-border shadow-xs">
              <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    Pending User Invitations
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Users invited to access the vendor portal for this entity.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => setIsInviteOpen(true)}>
                  Invite User
                </Button>
              </CardHeader>
              <CardContent className="p-0 flex-1">
                {invitations.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-12">
                    No pending invitations for this vendor. Click &quot;Invite User&quot; to send one.
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Invited</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitations.map((inv) => (
                        <TableRow key={inv.id} className="hover:bg-muted/20">
                          <TableCell className="font-medium text-foreground">{inv.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{inv.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="warning">{inv.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs">
                            {new Date(inv.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Edit Vendor Dialog */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-background border-border shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-primary" />
                Edit Vendor Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="detailEditVendorName" className="text-sm font-medium">
                    Vendor Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="detailEditVendorName"
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
                <div className="mt-4 flex justify-end gap-2.5 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditOpen(false);
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
        open={isDeactivateOpen}
        onOpenChange={setIsDeactivateOpen}
        title="Deactivate Vendor"
        description={
          <span>
            Are you sure you want to deactivate <strong>{vendor.name}</strong>? This will archive
            the vendor and suspend associated inbound traffic routing.
          </span>
        }
        confirmText="Deactivate"
        destructive={true}
        isLoading={isSubmittingDeactivate}
        onConfirm={handleDeactivateSubmit}
      />

      {/* Invite Modal */}
      {isInviteOpen && (
        <InviteUserDialog
          workspaceId={workspaceId || ''}
          isOpen={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          participantType="VENDOR"
          entityId={vendor.id}
          entityName={vendor.name}
          onSuccess={() => refreshInvitations()}
        />
      )}

      {/* Assign Phone Number Modal */}
      {isAssignNumberOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-lg bg-background border-border shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                Assign Phone Number to {vendor.name}
              </CardTitle>
              <CardDescription>
                Select a provisioned tracking number to attribute inbound calls to this vendor.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleAssignNumberSubmit}>
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="assign-search">Search Numbers</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="assign-search"
                      placeholder="Filter by number, name, or campaign..."
                      value={assignSearch}
                      onChange={(e) => setAssignSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Select Phone Number</Label>
                  {isLoadingPhoneNumbers ? (
                    <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      Loading phone numbers...
                    </div>
                  ) : workspacePhoneNumbers.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground border border-dashed rounded-md">
                      No provisioned phone numbers found in this workspace. Please provision a number on the Phone Numbers tab first.
                    </div>
                  ) : filteredWorkspaceNumbers.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground border border-dashed rounded-md">
                      No phone numbers match &quot;{assignSearch}&quot;.
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto border border-border rounded-md divide-y divide-border">
                      {filteredWorkspaceNumbers.map((pn: any) => {
                        const isCurrentVendor = pn.vendor_id === vendor.id;
                        const isOtherVendor = pn.vendor_id && pn.vendor_id !== vendor.id;
                        const otherVendorName = pn.vendor?.name;
                        const isSelected = selectedAssignPhoneId === pn.id;

                        return (
                          <div
                            key={pn.id}
                            onClick={() => !isCurrentVendor && setSelectedAssignPhoneId(pn.id)}
                            className={`p-3 text-sm flex items-center justify-between transition-colors ${
                              isCurrentVendor
                                ? 'opacity-50 cursor-not-allowed bg-muted/20'
                                : isSelected
                                ? 'bg-primary/10 border-l-4 border-primary cursor-pointer'
                                : 'hover:bg-muted/30 cursor-pointer'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="font-mono font-medium text-foreground">
                                {pn.phone_number}
                                {pn.name && (
                                  <span className="font-sans font-normal text-muted-foreground ml-2">
                                    ({pn.name})
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {pn.campaign ? `Campaign: ${pn.campaign.name}` : 'No campaign assigned'}
                                {isCurrentVendor && ' • (Already assigned to this vendor)'}
                                {isOtherVendor && ` • (Currently assigned to ${otherVendorName || 'another vendor'})`}
                              </div>
                            </div>
                            <input
                              type="radio"
                              name="assign-number-radio"
                              checked={isSelected}
                              disabled={isCurrentVendor}
                              onChange={() => setSelectedAssignPhoneId(pn.id)}
                              className="h-4 w-4 text-primary focus:ring-primary"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedAssignPhone && selectedAssignPhone.vendor_id && selectedAssignPhone.vendor_id !== vendor.id && (
                  <div className="bg-warning-muted text-warning-muted-foreground p-3 rounded-md text-xs border border-warning-muted flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>Reassignment Notice:</strong> This number is currently assigned to{' '}
                      <strong>{selectedAssignPhone.vendor?.name || 'another vendor'}</strong>. Assigning it will reassign future traffic to{' '}
                      <strong>{vendor.name}</strong>. Historical call records will remain unchanged.
                    </span>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Inbound calls on this number will attribute to <strong>{vendor.name}</strong>. Historical call records will retain their existing attribution.
                </p>

                <div className="mt-4 flex justify-end gap-2.5 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAssignNumberOpen(false)}
                    disabled={isSubmittingAssign}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!selectedAssignPhoneId || isSubmittingAssign}
                    isLoading={isSubmittingAssign}
                  >
                    Assign to Vendor
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      )}

      {/* Unassign Phone Confirmation Dialog */}
      <ConfirmDialog
        open={isUnassignOpen}
        onOpenChange={setIsUnassignOpen}
        title="Unassign Phone Number"
        description={
          <span>
            Are you sure you want to unassign <strong className="font-mono">{unassignPhone?.phone_number}</strong> from <strong>{vendor.name}</strong>?
            <br /><br />
            Future inbound calls received on this number will no longer be attributed to this vendor. Historical calls and settlements will remain unchanged.
          </span>
        }
        confirmText="Unassign Number"
        cancelText="Cancel"
        onConfirm={handleConfirmUnassignPhone}
        isLoading={isSubmittingUnassign}
        destructive={true}
      />
    </div>
  );
}
