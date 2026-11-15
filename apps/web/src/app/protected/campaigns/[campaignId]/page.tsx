'use client';

import { useEffect, useState, use, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { 
  ArrowLeft, 
  Target, 
  Phone, 
  Hash, 
  AlertCircle, 
  Info, 
  ListOrdered, 
  DollarSign, 
  Clock, 
  TrendingUp,
  Plus,
  ArrowUp,
  ArrowDown,
  PhoneForwarded,
  Building2,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface CampaignDestination {
  id: string;
  campaign_id: string;
  destination_number_id: string;
  priority: number;
  weight: number;
  destination_number: {
    id: string;
    destination_number: string;
    name?: string | null;
    status: string;
    timeout: number;
    max_concurrent_calls: number;
    buyer?: {
      id: string;
      name: string;
      email?: string | null;
      status: string;
    } | null;
  };
}

interface AvailableDestination {
  id: string;
  destination_number: string;
  name?: string | null;
  status: string;
  buyer?: {
    id: string;
    name: string;
    status: string;
  } | null;
}

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  created_at: string;
  default_revenue_amount?: number | string | null;
  default_payout_amount?: number | string | null;
  currency?: string | null;
  conversion_duration_secs?: number | null;
  duplicate_window_secs?: number | null;
  phone_numbers: { id: string; phone_number: string; provider: string }[];
  buyers: {
    id: string;
    priority: number;
    buyer: {
      id: string;
      name: string;
      destination_number: string;
      status: string;
    };
  }[];
  destination_numbers?: CampaignDestination[];
}

export default function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> | { campaignId: string } }) {
  const unwrappedParams = params instanceof Promise ? use(params) : params as { campaignId: string };
  const campaignId = unwrappedParams.campaignId;
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Phone number unassign state
  const [unassigningNumber, setUnassigningNumber] = useState<{ id: string; phone_number: string } | null>(null);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [numberActionError, setNumberActionError] = useState<string | null>(null);
  const [numberActionSuccess, setNumberActionSuccess] = useState<string | null>(null);

  // Destination numbers waterfall state
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [availableDestinations, setAvailableDestinations] = useState<AvailableDestination[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [assignForm, setAssignForm] = useState({
    destinationNumberId: '',
    priority: 1,
    weight: 100,
  });
  const [assignError, setAssignError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const [unassigningDestination, setUnassigningDestination] = useState<CampaignDestination | null>(null);
  const [isUnassigningDestination, setIsUnassigningDestination] = useState(false);
  const [destinationActionError, setDestinationActionError] = useState<string | null>(null);
  const [destinationActionSuccess, setDestinationActionSuccess] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const fetchCampaign = useCallback(async () => {
    if (!workspaceId || !campaignId) return;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}`);
      setCampaign(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Campaign not found or access denied.');
    }
  }, [workspaceId, campaignId]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!workspaceId || !campaignId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}`);
        if (!ignore) {
          setCampaign(data);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Campaign not found or access denied.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => { ignore = true; };
  }, [workspaceId, campaignId]);

  async function handleUnassignNumber() {
    if (!workspaceId || !campaignId || !unassigningNumber) return;
    setIsUnassigning(true);
    setNumberActionError(null);
    setNumberActionSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/phone-numbers/${unassigningNumber.id}`, {
        method: 'DELETE',
      });
      setNumberActionSuccess(`Phone number ${unassigningNumber.phone_number} unassigned successfully.`);
      setUnassigningNumber(null);
      await fetchCampaign();
    } catch (err: unknown) {
      setNumberActionError(err instanceof Error ? err.message : 'Failed to unassign phone number.');
    } finally {
      setIsUnassigning(false);
    }
  }

  async function handleOpenAssignModal() {
    if (!workspaceId) return;
    setAssignError(null);
    setLoadingDestinations(true);
    setIsAssignModalOpen(true);
    try {
      const res = await apiFetch(`/workspaces/${workspaceId}/destination-numbers?limit=100`);
      const all: AvailableDestination[] = Array.isArray(res) ? res : res?.items || [];
      const assignedIds = new Set((campaign?.destination_numbers || []).map(d => d.destination_number_id));
      const unassigned = all.filter(d => !assignedIds.has(d.id));
      setAvailableDestinations(unassigned);
      setAssignForm({
        destinationNumberId: unassigned[0]?.id || '',
        priority: (campaign?.destination_numbers?.length || 0) + 1,
        weight: 100,
      });
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Failed to load destination numbers.');
    } finally {
      setLoadingDestinations(false);
    }
  }

  async function handleAssignDestination(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !campaignId || !assignForm.destinationNumberId) {
      setAssignError('Please select a destination number.');
      return;
    }
    setIsAssigning(true);
    setAssignError(null);
    setDestinationActionError(null);
    setDestinationActionSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/destinations`, {
        method: 'POST',
        body: JSON.stringify({
          destinationNumberId: assignForm.destinationNumberId,
          priority: Number(assignForm.priority) || 1,
          weight: Number(assignForm.weight) || 100,
        }),
      });
      setIsAssignModalOpen(false);
      setDestinationActionSuccess('Destination endpoint assigned to campaign waterfall.');
      await fetchCampaign();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign destination.');
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleUnassignDestination() {
    if (!workspaceId || !campaignId || !unassigningDestination) return;
    setIsUnassigningDestination(true);
    setDestinationActionError(null);
    setDestinationActionSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/destinations/${unassigningDestination.destination_number_id}`, {
        method: 'DELETE',
      });
      setDestinationActionSuccess('Destination endpoint removed from campaign waterfall.');
      setUnassigningDestination(null);
      await fetchCampaign();
    } catch (err: unknown) {
      setDestinationActionError(err instanceof Error ? err.message : 'Failed to unassign destination.');
    } finally {
      setIsUnassigningDestination(false);
    }
  }

  async function handleMoveDestination(index: number, direction: 'up' | 'down') {
    if (!workspaceId || !campaignId || !campaign?.destination_numbers || reordering) return;
    const sorted = [...campaign.destination_numbers].sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;

    setReordering(true);
    setDestinationActionError(null);
    setDestinationActionSuccess(null);

    const reordered = [...sorted];
    const temp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = temp;

    const destinationNumberIds = reordered.map(d => d.destination_number_id);

    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/destinations/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ destinationNumberIds }),
      });
      setDestinationActionSuccess('Waterfall routing priorities updated.');
      await fetchCampaign();
    } catch (err: unknown) {
      setDestinationActionError(err instanceof Error ? err.message : 'Failed to reorder destinations.');
    } finally {
      setReordering(false);
    }
  }

  const getStatusBadgeVariant = (state: string) => {
    switch (state?.toUpperCase()) {
      case 'ACTIVE':
        return 'success';
      case 'INACTIVE':
      case 'PAUSED':
        return 'warning';
      default:
        return 'default';
    }
  };

  if (!workspaceId) {
    return <div className="p-8 text-muted-foreground">Please select a workspace first.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
        Loading campaign details...
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md border border-error/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error || 'Campaign not found.'}</p>
        </div>
        <Link 
          href={`/protected/campaigns?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors border border-border bg-surface hover:bg-muted hover:text-foreground h-10 px-4 py-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Campaigns
        </Link>
      </div>
    );
  }

  const sortedDestinations = [...(campaign.destination_numbers || [])].sort(
    (a, b) => a.priority - b.priority || b.weight - a.weight
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-2">
            <Link 
              href={`/protected/campaigns?workspace=${workspaceId}`}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 w-10 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="sr-only">Back</span>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Campaign Details</h1>
            <Badge variant={getStatusBadgeVariant(campaign.status)} className="ml-2">
              {campaign.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground ml-11">
            <span className="font-mono text-xs">{campaign.id}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Summary & Metadata */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" /> Campaign Name
                </span>
                <p className="font-medium text-base">{campaign.name}</p>
              </div>
              
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> Created On
                </span>
                <p className="font-medium text-sm">
                  {new Date(campaign.created_at).toLocaleDateString()}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary" />
                Assigned Numbers
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 p-0">
              {numberActionSuccess && (
                <div className="m-4 p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-md text-xs">
                  {numberActionSuccess}
                </div>
              )}
              {numberActionError && (
                <div className="m-4 p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-md text-xs">
                  {numberActionError}
                </div>
              )}
              {campaign.phone_numbers && campaign.phone_numbers.length === 0 ? (
                <div className="text-sm text-muted-foreground p-6 text-center">
                  No tracking numbers assigned.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {campaign.phone_numbers?.map(num => (
                    <div key={num.id || num.phone_number} className="p-4 flex items-center justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-sm font-medium">{num.phone_number}</span>
                        {num.provider && <span className="text-xs text-muted-foreground capitalize">{num.provider}</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8 px-2.5"
                        onClick={() => setUnassigningNumber(num)}
                      >
                        Unassign
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Routing & Commercial Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Destination Numbers (Routing Waterfall) */}
          <Card>
            <CardHeader className="pb-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <PhoneForwarded className="w-4 h-4 text-primary" />
                  Destination Numbers (Routing Waterfall)
                </CardTitle>
                <CardDescription className="mt-1">
                  Primary routing engine. Calls evaluate destinations in order of priority, distributing by weight.
                </CardDescription>
              </div>
              <Button size="sm" onClick={handleOpenAssignModal} className="h-8 text-xs shrink-0">
                <Plus className="w-3.5 h-3.5 mr-1" />
                Assign Destination
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {destinationActionSuccess && (
                <div className="m-4 p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-md text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{destinationActionSuccess}</span>
                </div>
              )}
              {destinationActionError && (
                <div className="m-4 p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-md text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{destinationActionError}</span>
                </div>
              )}

              {sortedDestinations.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-10 px-4">
                  <p>No destination numbers assigned to this campaign yet.</p>
                  <p className="text-xs mt-1 text-muted-foreground/80">
                    Assign buyer endpoints above to route live calls through independent destination numbers.
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleOpenAssignModal} 
                    className="mt-4 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Assign First Destination
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="w-[100px] text-center">Priority</TableHead>
                        <TableHead>Destination</TableHead>
                        <TableHead>Buyer Organization</TableHead>
                        <TableHead className="text-center w-[80px]">Weight</TableHead>
                        <TableHead className="text-center w-[90px]">Timeout</TableHead>
                        <TableHead className="text-center w-[80px]">Status</TableHead>
                        <TableHead className="text-right w-[110px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedDestinations.map((cd, index) => {
                        const dest = cd.destination_number;
                        const buyer = dest?.buyer;
                        const isInactive = dest?.status !== 'ACTIVE';
                        return (
                          <TableRow key={cd.id || cd.destination_number_id} className={isInactive ? 'opacity-60 bg-muted/20' : ''}>
                            <TableCell className="text-center font-medium">
                              <div className="flex items-center justify-center gap-1">
                                <span className="bg-primary/10 text-primary font-bold w-6 h-6 rounded-full inline-flex items-center justify-center text-xs">
                                  {cd.priority}
                                </span>
                                <div className="flex flex-col">
                                  <button
                                    type="button"
                                    disabled={index === 0 || reordering}
                                    onClick={() => handleMoveDestination(index, 'up')}
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                                    title="Move up"
                                    aria-label="Move destination up in priority"
                                  >
                                    <ArrowUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === sortedDestinations.length - 1 || reordering}
                                    onClick={() => handleMoveDestination(index, 'down')}
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                                    title="Move down"
                                    aria-label="Move destination down in priority"
                                  >
                                    <ArrowDown className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-mono text-sm font-semibold">{dest?.destination_number}</span>
                                {dest?.name && (
                                  <span className="text-xs text-muted-foreground font-medium">{dest.name}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {buyer ? (
                                <Link 
                                  href={`/protected/buyers/${buyer.id}?workspace=${workspaceId}`}
                                  className="text-sm font-medium hover:underline hover:text-primary transition-colors flex items-center gap-1.5"
                                >
                                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span>{buyer.name}</span>
                                </Link>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Unassigned</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs font-medium">
                              {cd.weight}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs text-muted-foreground">
                              {dest?.timeout ?? 30}s
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge 
                                variant={dest?.status === 'ACTIVE' ? 'success' : 'warning'} 
                                className="text-[10px] px-1.5 h-5"
                              >
                                {dest?.status || 'UNKNOWN'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-7 px-2"
                                onClick={() => setUnassigningDestination(cd)}
                                title="Unassign from campaign"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legacy Campaign Buyers (Fallback) */}
          {campaign.buyers && campaign.buyers.length > 0 && (
            <Card className="border-dashed border-border/80">
              <CardHeader className="pb-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ListOrdered className="w-4 h-4 text-muted-foreground" />
                      Legacy Buyer Waterfall
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                      Legacy Fallback
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">
                    Retained for backward compatibility. Evaluated only if no Destination Numbers are configured above.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/20">
                    <TableRow>
                      <TableHead className="w-[80px] text-center">Priority</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Legacy Destination</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...campaign.buyers].sort((a, b) => a.priority - b.priority).map((cb) => (
                      <TableRow key={cb.id || cb.buyer.id} className="opacity-75">
                        <TableCell className="text-center font-medium">
                          <span className="bg-secondary text-secondary-foreground w-6 h-6 rounded-full inline-flex items-center justify-center text-xs">
                            {cb.priority}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link href={`/protected/buyers/${cb.buyer.id}?workspace=${workspaceId}`} className="hover:underline hover:text-primary transition-colors">
                            {cb.buyer.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {cb.buyer.destination_number || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={cb.buyer.status === 'ACTIVE' ? 'success' : cb.buyer.status === 'INACTIVE' ? 'warning' : 'default'} className="text-[10px] px-1.5 h-5">
                            {cb.buyer.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Commercial Configuration & Rates Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-primary" />
                  Commercial Configuration & Rates
                </CardTitle>
                <CardDescription className="mt-1">
                  Buyer revenue, vendor payout rates, and qualification criteria used by the commercial evaluation engine.
                </CardDescription>
              </div>
              <Badge
                variant={
                  campaign.default_revenue_amount !== null &&
                  campaign.default_revenue_amount !== undefined &&
                  campaign.default_payout_amount !== null &&
                  campaign.default_payout_amount !== undefined
                    ? 'success'
                    : 'outline'
                }
              >
                {campaign.default_revenue_amount !== null &&
                campaign.default_revenue_amount !== undefined &&
                campaign.default_payout_amount !== null &&
                campaign.default_payout_amount !== undefined
                  ? 'Commercial Active'
                  : 'Non-commercial'}
              </Badge>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Buyer Revenue
                  </span>
                  <p className="text-lg font-bold font-mono">
                    {campaign.default_revenue_amount !== null && campaign.default_revenue_amount !== undefined
                      ? `${campaign.currency || 'USD'} ${Number(campaign.default_revenue_amount).toFixed(2)}`
                      : '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Billed to buyer per qualified call</p>
                </div>

                <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> Vendor Payout
                  </span>
                  <p className="text-lg font-bold font-mono">
                    {campaign.default_payout_amount !== null && campaign.default_payout_amount !== undefined
                      ? `${campaign.currency || 'USD'} ${Number(campaign.default_payout_amount).toFixed(2)}`
                      : '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Paid to vendor per qualified call</p>
                </div>

                <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Spread / Gross Margin
                  </span>
                  <p className="text-lg font-bold font-mono">
                    {campaign.default_revenue_amount !== null &&
                    campaign.default_revenue_amount !== undefined &&
                    campaign.default_payout_amount !== null &&
                    campaign.default_payout_amount !== undefined
                      ? `${campaign.currency || 'USD'} ${(
                          Number(campaign.default_revenue_amount) - Number(campaign.default_payout_amount)
                        ).toFixed(2)}`
                      : '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {campaign.default_revenue_amount !== null &&
                    campaign.default_revenue_amount !== undefined &&
                    campaign.default_payout_amount !== null &&
                    campaign.default_payout_amount !== undefined &&
                    Number(campaign.default_revenue_amount) > 0
                      ? `${(
                          ((Number(campaign.default_revenue_amount) - Number(campaign.default_payout_amount)) /
                            Number(campaign.default_revenue_amount)) *
                          100
                        ).toFixed(1)}% gross margin`
                      : 'Net rate difference'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    Currency
                  </span>
                  <p className="font-mono text-sm font-semibold">{campaign.currency || 'USD'}</p>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Qualification Threshold
                  </span>
                  <p className="font-mono text-sm">
                    {campaign.conversion_duration_secs ?? 90}s talk duration
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    Duplicate Prevention
                  </span>
                  <p className="font-mono text-sm">
                    {campaign.duplicate_window_secs
                      ? `${Math.round(campaign.duplicate_window_secs / 86400)} days (${campaign.duplicate_window_secs}s)`
                      : '30 days (2,592,000s)'}
                  </p>
                </div>
              </div>

              {campaign.default_revenue_amount === null ||
              campaign.default_revenue_amount === undefined ||
              campaign.default_payout_amount === null ||
              campaign.default_payout_amount === undefined ? (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-3 rounded-md text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Commercial evaluation is disabled for this campaign because one or both rates are unconfigured. The commercial engine strictly requires both Default Buyer Revenue and Default Vendor Payout to generate authoritative CallCommercial records.
                  </span>
                </div>
              ) : (
                <div className="bg-muted/40 border border-border p-3 rounded-md text-xs text-muted-foreground flex items-start gap-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                  <span>
                    Qualified calls generate an immutable CallCommercial snapshot capturing revenue, payout, and actual operational cost. Subsequent edits to campaign default rates do not alter historical records.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Assign Destination Modal */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <PhoneForwarded className="w-5 h-5 text-primary" />
                Assign Destination Number
              </h2>
              <button 
                type="button" 
                onClick={() => setIsAssignModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            {assignError && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{assignError}</span>
              </div>
            )}

            {loadingDestinations ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent inline-block mr-2" />
                Loading available destination numbers...
              </div>
            ) : availableDestinations.length === 0 ? (
              <div className="py-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  No unassigned destination numbers available in this workspace.
                </p>
                <p className="text-xs text-muted-foreground/80">
                  Please add or configure destination numbers on a Buyer Organization before assigning them here.
                </p>
                <div className="pt-2">
                  <Button variant="outline" size="sm" onClick={() => setIsAssignModalOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAssignDestination} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="destinationSelect">Select Destination Endpoint *</Label>
                  <select
                    id="destinationSelect"
                    value={assignForm.destinationNumberId}
                    onChange={(e) => setAssignForm({ ...assignForm, destinationNumberId: e.target.value })}
                    required
                    className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    {availableDestinations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.destination_number} {d.name ? `(${d.name})` : ''} — {d.buyer?.name || 'Buyer'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="priorityInput">Priority (Waterfall Order) *</Label>
                    <Input
                      id="priorityInput"
                      type="number"
                      min={1}
                      max={100}
                      value={assignForm.priority}
                      onChange={(e) => setAssignForm({ ...assignForm, priority: parseInt(e.target.value, 10) || 1 })}
                      required
                    />
                    <p className="text-[11px] text-muted-foreground">Lower number rings first (1 = highest).</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="weightInput">Weight (Traffic Share) *</Label>
                    <Input
                      id="weightInput"
                      type="number"
                      min={1}
                      max={1000}
                      value={assignForm.weight}
                      onChange={(e) => setAssignForm({ ...assignForm, weight: parseInt(e.target.value, 10) || 100 })}
                      required
                    />
                    <p className="text-[11px] text-muted-foreground">Relative weight among same priority.</p>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsAssignModalOpen(false)}
                    disabled={isAssigning}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isAssigning}>
                    {isAssigning ? 'Assigning...' : 'Assign Destination'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Confirm Unassign Phone Number Dialog */}
      <ConfirmDialog
        open={Boolean(unassigningNumber)}
        onOpenChange={(open) => !open && setUnassigningNumber(null)}
        title="Unassign Phone Number"
        description={`Are you sure you want to unassign ${unassigningNumber?.phone_number} from this campaign? Inbound calls to this number will no longer route to this campaign.`}
        confirmText="Unassign Number"
        destructive
        isLoading={isUnassigning}
        onConfirm={handleUnassignNumber}
      />

      {/* Confirm Unassign Destination Dialog */}
      <ConfirmDialog
        open={Boolean(unassigningDestination)}
        onOpenChange={(open) => !open && setUnassigningDestination(null)}
        title="Unassign Destination Endpoint"
        description={`Are you sure you want to unassign ${unassigningDestination?.destination_number?.destination_number} (${unassigningDestination?.destination_number?.name || unassigningDestination?.destination_number?.buyer?.name || 'Endpoint'}) from this campaign's routing waterfall?`}
        confirmText="Unassign Destination"
        destructive
        isLoading={isUnassigningDestination}
        onConfirm={handleUnassignDestination}
      />
    </div>
  );
}
