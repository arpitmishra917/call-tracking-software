'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

// Add useDebounce hook inside or just inline it
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

interface Buyer {
  id: string;
  name: string;
  destination_number: string;
  timeout: number;
}

interface CampaignBuyer {
  id: string;
  priority: number;
  buyer: Buyer;
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  campaign_id: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  conversion_duration_secs?: number | null;
  duplicate_window_secs?: number | null;
  default_revenue_amount?: number | string | null;
  default_payout_amount?: number | string | null;
  currency?: string;
  phone_numbers?: PhoneNumber[];
  buyers?: CampaignBuyer[];
}

export default function CampaignsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);
  const requestGenRef = useRef(0);
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availableBuyers, setAvailableBuyers] = useState<Buyer[]>([]);

  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    requestGenRef.current++;
    setCampaigns([]);
    setAvailableBuyers([]);
    setError(null);
    setSuccess(null);
  }, [workspaceId]);
  
  // Search & Filters
  const [statusTab, setStatusTab] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [page, setPage] = useState(1);
  const limit = 50; // Use a reasonable limit

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newRevenue, setNewRevenue] = useState('');
  const [newPayout, setNewPayout] = useState('');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newConversionDuration, setNewConversionDuration] = useState('90');
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  // Add Buyer Modal State
  const [addBuyerModalOpen, setAddBuyerModalOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [priority, setPriority] = useState<number>(1);
  const [isAddingBuyer, setIsAddingBuyer] = useState(false);

  // Add Tracking Number Modal State
  const [addTrackingNumberModalOpen, setAddTrackingNumberModalOpen] = useState(false);
  const [availablePhoneNumbers, setAvailablePhoneNumbers] = useState<PhoneNumber[]>([]);
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState('');
  const [isAddingPhoneNumber, setIsAddingPhoneNumber] = useState(false);

  // Action Modals State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [campaignToEdit, setCampaignToEdit] = useState<Campaign | null>(null);
  const [editCampaignName, setEditCampaignName] = useState('');
  const [editRevenue, setEditRevenue] = useState('');
  const [editPayout, setEditPayout] = useState('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [editConversionDuration, setEditConversionDuration] = useState('90');
  const [isEditingCampaign, setIsEditingCampaign] = useState(false);

  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [campaignToDeactivate, setCampaignToDeactivate] = useState<Campaign | null>(null);
  const [isDeactivatingCampaign, setIsDeactivatingCampaign] = useState(false);

  const [activatingCampaignId, setActivatingCampaignId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!workspaceId) return;
    const targetWs = workspaceId;
    const currentGen = ++requestGenRef.current;
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const [cData, bData] = await Promise.all([
        apiFetch(`/workspaces/${workspaceId}/campaigns?status=${statusTab}&search=${encodeURIComponent(debouncedSearch)}&limit=${limit}&offset=${offset}`),
        apiFetch(`/workspaces/${workspaceId}/buyers`)
      ]);
      if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
        return;
      }
      setCampaigns(cData?.items || []);
      setAvailableBuyers(bData?.items || bData || []);
    } catch (e: unknown) {
      if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
        return;
      }
      setError('Failed to load campaigns/buyers: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (currentGen === requestGenRef.current && targetWs === currentWorkspaceIdRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, statusTab, debouncedSearch, page, limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Reset page when search or tab changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [statusTab, debouncedSearch]);

  async function refreshCampaigns() {
    loadData();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setError(null);
    setSuccess(null);
    setIsCreatingCampaign(true);
    
    try {
      if (newRevenue !== '' && (isNaN(Number(newRevenue)) || Number(newRevenue) < 0)) {
        setError('Default buyer revenue cannot be negative');
        setIsCreatingCampaign(false);
        return;
      }
      if (newPayout !== '' && (isNaN(Number(newPayout)) || Number(newPayout) < 0)) {
        setError('Default vendor payout cannot be negative');
        setIsCreatingCampaign(false);
        return;
      }
      if (newConversionDuration !== '') {
        const cdNum = Number(newConversionDuration);
        if (isNaN(cdNum) || !Number.isInteger(cdNum) || cdNum < 0) {
          setError('Conversion duration threshold must be a non-negative whole number (seconds)');
          setIsCreatingCampaign(false);
          return;
        }
      }

      const payload: {
        name: string;
        default_revenue_amount?: number | null;
        default_payout_amount?: number | null;
        currency?: string;
        conversion_duration_secs?: number;
      } = {
        name: newCampaignName.trim(),
        default_revenue_amount: newRevenue !== '' ? Number(newRevenue) : null,
        default_payout_amount: newPayout !== '' ? Number(newPayout) : null,
        currency: newCurrency.trim().toUpperCase() || 'USD',
      };
      if (newConversionDuration !== '') {
        payload.conversion_duration_secs = Number(newConversionDuration);
      }

      await apiFetch(`/workspaces/${workspaceId}/campaigns`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setNewCampaignName('');
      setNewRevenue('');
      setNewPayout('');
      setNewCurrency('USD');
      setNewConversionDuration('90');
      setCreateModalOpen(false);
      setSuccess('Campaign created successfully.');
      setStatusTab('ACTIVE');
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to create campaign. ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsCreatingCampaign(false);
    }
  }

  async function handleAddBuyerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !selectedCampaignId || !selectedBuyerId) return;
    setIsAddingBuyer(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/buyers`, {
        method: 'POST',
        body: JSON.stringify({ buyerId: selectedBuyerId, priority }),
      });
      
      setSuccess('Buyer added to campaign.');
      setAddBuyerModalOpen(false);
      setSelectedBuyerId('');
      setPriority(1);
      refreshCampaigns();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Unique constraint failed') || msg.includes('duplicate')) {
        setError('That priority is already used in this campaign or buyer is already assigned.');
      } else {
        setError('Unable to add buyer: ' + msg);
      }
    } finally {
      setIsAddingBuyer(false);
    }
  }

  function openAddBuyerModal(campaignId: string, currentBuyers: CampaignBuyer[] = []) {
    setSelectedCampaignId(campaignId);
    setSelectedBuyerId('');
    const nextPriority = currentBuyers.length > 0 ? Math.max(...currentBuyers.map(b => b.priority)) + 1 : 1;
    setPriority(nextPriority);
    setAddBuyerModalOpen(true);
  }

  async function handleRemoveBuyer(campaignId: string, buyerId: string) {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to remove this buyer from the campaign?')) return;
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/buyers/${buyerId}`, {
        method: 'DELETE',
      });
      setSuccess('Buyer removed from campaign.');
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to remove buyer: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleMoveBuyer(campaignId: string, currentBuyers: CampaignBuyer[], index: number, direction: 'up' | 'down') {
    if (!workspaceId) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === currentBuyers.length - 1) return;
    
    setError(null);
    const newBuyers = [...currentBuyers].sort((a, b) => a.priority - b.priority);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    const temp = newBuyers[index];
    newBuyers[index] = newBuyers[newIndex];
    newBuyers[newIndex] = temp;
    
    const buyerIds = newBuyers.map(cb => cb.buyer.id);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/buyers/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ buyerIds }),
      });
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to reorder buyers: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function openAddTrackingNumberModal(campaignId: string) {
    if (!workspaceId) return;
    setSelectedCampaignId(campaignId);
    setSelectedPhoneNumberId('');
    setAddTrackingNumberModalOpen(true);
    
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/phone-numbers`);
      const allNumbers = data?.items || [];
      // Eligible numbers: those not assigned to ANY campaign (or explicitly logic for your business rules)
      const eligible = allNumbers.filter((n: PhoneNumber) => !n.campaign_id);
      setAvailablePhoneNumbers(eligible);
    } catch (e) {
      console.error(e);
      setError('Failed to load tracking numbers.');
    }
  }

  async function handleAddTrackingNumberSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !selectedCampaignId || !selectedPhoneNumberId) return;
    setIsAddingPhoneNumber(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumberId: selectedPhoneNumberId }),
      });
      setSuccess('Tracking number assigned to campaign.');
      setAddTrackingNumberModalOpen(false);
      setSelectedPhoneNumberId('');
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to add tracking number: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAddingPhoneNumber(false);
    }
  }

  async function handleRemoveTrackingNumber(campaignId: string, phoneNumberId: string) {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to remove this tracking number from the campaign?')) return;
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/phone-numbers/${phoneNumberId}`, {
        method: 'DELETE',
      });
      setSuccess('Tracking number removed from campaign.');
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to remove tracking number: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !campaignToEdit) return;
    setIsEditingCampaign(true);
    setError(null);
    setSuccess(null);

    try {
      if (editRevenue !== '' && (isNaN(Number(editRevenue)) || Number(editRevenue) < 0)) {
        setError('Default buyer revenue cannot be negative');
        setIsEditingCampaign(false);
        return;
      }
      if (editPayout !== '' && (isNaN(Number(editPayout)) || Number(editPayout) < 0)) {
        setError('Default vendor payout cannot be negative');
        setIsEditingCampaign(false);
        return;
      }
      if (editConversionDuration !== '') {
        const cdNum = Number(editConversionDuration);
        if (isNaN(cdNum) || !Number.isInteger(cdNum) || cdNum < 0) {
          setError('Conversion duration threshold must be a non-negative whole number (seconds)');
          setIsEditingCampaign(false);
          return;
        }
      }

      const payload: {
        name: string;
        default_revenue_amount?: number | null;
        default_payout_amount?: number | null;
        currency?: string;
        conversion_duration_secs?: number;
      } = {
        name: editCampaignName.trim(),
        default_revenue_amount: editRevenue !== '' ? Number(editRevenue) : null,
        default_payout_amount: editPayout !== '' ? Number(editPayout) : null,
        currency: editCurrency.trim().toUpperCase() || 'USD',
      };
      if (editConversionDuration !== '') {
        payload.conversion_duration_secs = Number(editConversionDuration);
      }

      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setSuccess('Campaign updated successfully.');
      setEditModalOpen(false);
      setCampaignToEdit(null);
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to update campaign: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsEditingCampaign(false);
    }
  }

  function openEditModal(campaign: Campaign) {
    setCampaignToEdit(campaign);
    setEditCampaignName(campaign.name);
    setEditRevenue(campaign.default_revenue_amount !== null && campaign.default_revenue_amount !== undefined ? String(campaign.default_revenue_amount) : '');
    setEditPayout(campaign.default_payout_amount !== null && campaign.default_payout_amount !== undefined ? String(campaign.default_payout_amount) : '');
    setEditCurrency(campaign.currency || 'USD');
    setEditConversionDuration(
      campaign.conversion_duration_secs !== null && campaign.conversion_duration_secs !== undefined
        ? String(campaign.conversion_duration_secs)
        : ''
    );
    setEditModalOpen(true);
  }

  async function handleActivate(campaignId: string) {
    if (!workspaceId) return;
    setActivatingCampaignId(campaignId);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}/activate`, {
        method: 'POST'
      });
      setSuccess('Campaign activated successfully.');
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to activate campaign: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActivatingCampaignId(null);
    }
  }

  function openDeactivateModal(campaign: Campaign) {
    setCampaignToDeactivate(campaign);
    setDeactivateModalOpen(true);
  }

  async function handleDeactivateConfirm() {
    if (!workspaceId || !campaignToDeactivate) return;
    setIsDeactivatingCampaign(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignToDeactivate.id}/archive`, {
        method: 'POST'
      });
      setSuccess('Campaign deactivated successfully.');
      setDeactivateModalOpen(false);
      setCampaignToDeactivate(null);
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to deactivate campaign: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsDeactivatingCampaign(false);
    }
  }

  if (!workspaceId) return <div className="p-8 flex items-center justify-center text-muted-foreground">Select a workspace first.</div>;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
        <Button onClick={() => setCreateModalOpen(true)}>+ Create Campaign</Button>
      </div>
      
      {error && (
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md text-sm border border-error-muted" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-success-muted text-success-muted-foreground p-4 rounded-md text-sm border border-success-muted">
          {success}
        </div>
      )}

      <div className="flex justify-between items-center bg-card p-4 rounded-lg border border-border shadow-sm flex-wrap gap-4">
        <div className="flex gap-2 p-1 bg-muted rounded-md w-full max-w-[400px]">
          <Button
            variant={statusTab === 'ACTIVE' ? 'primary' : 'ghost'}
            className="flex-1"
            size="sm"
            onClick={() => setStatusTab('ACTIVE')}
          >
            Active
          </Button>
          <Button
            variant={statusTab === 'INACTIVE' ? 'primary' : 'ghost'}
            className="flex-1"
            size="sm"
            onClick={() => setStatusTab('INACTIVE')}
          >
            Deactivated
          </Button>
        </div>
        
        <div className="w-full sm:w-auto flex-1 max-w-sm">
          <Input 
            type="search" 
            placeholder="Search campaigns..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-6">
        {loading ? (
          <div className="p-8 flex items-center justify-center text-muted-foreground">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns found"
            description={statusTab === 'ACTIVE' ? "Create a campaign above to start routing calls." : "No deactivated campaigns."}
          />
        ) : (
          campaigns.map(c => {
            const hasCommercialRates =
              c.default_revenue_amount !== null &&
              c.default_revenue_amount !== undefined &&
              c.default_payout_amount !== null &&
              c.default_payout_amount !== undefined;

            return (
              <Card key={c.id} className="overflow-hidden">
                <div className="bg-muted/30 px-6 py-4 border-b border-border flex justify-between items-center flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-foreground">{c.name}</h2>
                    <Badge variant={c.status === 'ACTIVE' ? 'success' : c.status === 'INACTIVE' ? 'warning' : 'default'}>
                      {c.status}
                    </Badge>
                    {hasCommercialRates ? (
                      <Badge variant="info">Commercial Active</Badge>
                    ) : (
                      <Badge variant="outline">Non-commercial</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <Link href={`/protected/campaigns/${c.id}?workspace=${workspaceId}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                      View Details
                    </Link>
                    <Button variant="outline" size="sm" onClick={() => openEditModal(c)}>
                      Edit
                    </Button>
                    {c.status !== 'ACTIVE' ? (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleActivate(c.id)}
                        isLoading={activatingCampaignId === c.id}
                      >
                        Activate
                      </Button>
                    ) : (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => openDeactivateModal(c)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                </div>

                {/* Commercial Rates Summary Banner */}
                <div className="px-6 py-2.5 bg-muted/10 border-b border-border text-xs flex items-center gap-6 text-muted-foreground flex-wrap">
                  <div>
                    <span className="font-medium text-foreground">Buyer Revenue:</span>{' '}
                    {c.default_revenue_amount !== null && c.default_revenue_amount !== undefined ? (
                      <span className="font-mono text-foreground font-semibold">{c.currency || 'USD'} {Number(c.default_revenue_amount).toFixed(2)}</span>
                    ) : (
                      <span className="italic">Not configured</span>
                    )}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Vendor Payout:</span>{' '}
                    {c.default_payout_amount !== null && c.default_payout_amount !== undefined ? (
                      <span className="font-mono text-foreground font-semibold">{c.currency || 'USD'} {Number(c.default_payout_amount).toFixed(2)}</span>
                    ) : (
                      <span className="italic">Not configured</span>
                    )}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Currency:</span>{' '}
                    <span className="font-mono">{c.currency || 'USD'}</span>
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Conversion Threshold:</span>{' '}
                    <span className="font-mono text-foreground font-semibold">
                      {c.conversion_duration_secs !== null && c.conversion_duration_secs !== undefined
                        ? `${c.conversion_duration_secs}s`
                        : '90s (default)'}
                    </span>
                  </div>
                </div>
                
                <CardContent className="p-0">
                  <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border">
                    {/* Left Col: Numbers */}
                    <div className="p-6">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tracking Numbers</h3>
                        <Button variant="ghost" size="sm" onClick={() => openAddTrackingNumberModal(c.id)}>+ Add</Button>
                      </div>
                      {c.phone_numbers && c.phone_numbers.length > 0 ? (
                        <div className="space-y-2 mb-4">
                          {c.phone_numbers.map(pn => (
                            <div key={pn.id} className="text-sm font-mono bg-muted/50 px-3 py-2 rounded-md border border-border flex justify-between items-center">
                              <span>{pn.phone_number}</span>
                              <Button variant="ghost" size="sm" className="h-6 text-error hover:text-error hover:bg-error/10 px-2" onClick={() => handleRemoveTrackingNumber(c.id, pn.id)}>
                                Remove
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mb-4">No tracking numbers assigned.</p>
                      )}
                    </div>

                    {/* Right Cols: Buyers */}
                    <div className="p-6 lg:col-span-2">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assigned Buyers (Priority Routing)</h3>
                        <Button variant="ghost" size="sm" onClick={() => openAddBuyerModal(c.id, c.buyers)}>+ Add Buyer</Button>
                      </div>
                      
                      {c.buyers && c.buyers.length > 0 ? (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-16">Priority</TableHead>
                                <TableHead>Buyer Name</TableHead>
                                <TableHead>Destination Number</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {c.buyers.map((cb, index) => (
                                <TableRow key={cb.id}>
                                  <TableCell className="font-semibold">{cb.priority}</TableCell>
                                  <TableCell className="font-medium">{cb.buyer.name}</TableCell>
                                  <TableCell className="font-mono text-muted-foreground">{cb.buyer.destination_number}</TableCell>
                                  <TableCell className="text-right space-x-1">
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      disabled={index === 0}
                                      onClick={() => handleMoveBuyer(c.id, c.buyers || [], index, 'up')}
                                    >
                                      ▲
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      disabled={index === (c.buyers?.length || 0) - 1}
                                      onClick={() => handleMoveBuyer(c.id, c.buyers || [], index, 'down')}
                                    >
                                      ▼
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="text-error hover:text-error hover:bg-error/10"
                                      onClick={() => handleRemoveBuyer(c.id, cb.buyer.id)}
                                    >
                                      Remove
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No buyers assigned to this campaign yet.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* CREATE MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-lg shadow-lg">
            <CardHeader>
              <CardTitle>Create Campaign</CardTitle>
            </CardHeader>
            <form onSubmit={handleCreate}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs border border-error-muted" role="alert">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="newCampaignName">Campaign Name *</Label>
                  <Input 
                    id="newCampaignName"
                    type="text" 
                    value={newCampaignName} 
                    onChange={e => setNewCampaignName(e.target.value)}
                    placeholder="e.g. Inbound Sales" 
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="newRevenue">Default Buyer Revenue</Label>
                    <Input 
                      id="newRevenue"
                      type="number"
                      step="0.01"
                      value={newRevenue} 
                      onChange={e => setNewRevenue(e.target.value)}
                      placeholder="e.g. 45.00" 
                    />
                    <p className="text-xs text-muted-foreground">Billed to buyer per qualifying call.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="newPayout">Default Vendor Payout</Label>
                    <Input 
                      id="newPayout"
                      type="number"
                      step="0.01"
                      value={newPayout} 
                      onChange={e => setNewPayout(e.target.value)}
                      placeholder="e.g. 30.00" 
                    />
                    <p className="text-xs text-muted-foreground">Disbursed to vendor per qualifying call.</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="newCurrency">Currency</Label>
                  <select
                    id="newCurrency"
                    value={newCurrency}
                    onChange={e => setNewCurrency(e.target.value)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="newConversionDuration">Conversion Duration Threshold (seconds)</Label>
                  <Input 
                    id="newConversionDuration"
                    type="number"
                    placeholder="90"
                    value={newConversionDuration} 
                    onChange={e => setNewConversionDuration(e.target.value)} 
                  />
                  <p className="text-xs text-muted-foreground">Minimum connected talk time required for a call to convert. Set to 0 to convert on answer. Default: 90 seconds.</p>
                </div>

                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground border border-border">
                  Commercial evaluation and wallet settlement require both Buyer Revenue and Vendor Payout to be set.
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" type="button" onClick={() => {
                  setCreateModalOpen(false);
                  setNewCampaignName('');
                  setNewRevenue('');
                  setNewPayout('');
                  setNewCurrency('USD');
                  setNewConversionDuration('90');
                }}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isCreatingCampaign}>
                  Create Campaign
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* EDIT MODAL */}
      {editModalOpen && campaignToEdit && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-lg shadow-lg">
            <CardHeader>
              <CardTitle>Edit Campaign</CardTitle>
            </CardHeader>
            <form onSubmit={handleEditSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="bg-error-muted text-error-muted-foreground p-3 rounded-md text-xs border border-error-muted" role="alert">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="editCampaignName">Campaign Name *</Label>
                  <Input 
                    id="editCampaignName"
                    type="text" 
                    value={editCampaignName} 
                    onChange={e => setEditCampaignName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="editRevenue">Default Buyer Revenue</Label>
                    <Input 
                      id="editRevenue"
                      type="number"
                      step="0.01"
                      value={editRevenue} 
                      onChange={e => setEditRevenue(e.target.value)}
                      placeholder="e.g. 45.00" 
                    />
                    <p className="text-xs text-muted-foreground">Billed to buyer per qualifying call.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="editPayout">Default Vendor Payout</Label>
                    <Input 
                      id="editPayout"
                      type="number"
                      step="0.01"
                      value={editPayout} 
                      onChange={e => setEditPayout(e.target.value)}
                      placeholder="e.g. 30.00" 
                    />
                    <p className="text-xs text-muted-foreground">Disbursed to vendor per qualifying call.</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="editCurrency">Currency</Label>
                  <select
                    id="editCurrency"
                    value={editCurrency}
                    onChange={e => setEditCurrency(e.target.value)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="editConversionDuration">Conversion Duration Threshold (seconds)</Label>
                  <Input 
                    id="editConversionDuration"
                    type="number"
                    placeholder="90"
                    value={editConversionDuration} 
                    onChange={e => setEditConversionDuration(e.target.value)} 
                  />
                  <p className="text-xs text-muted-foreground">Minimum connected talk time required for a call to convert. Set to 0 to convert on answer. Default: 90 seconds.</p>
                </div>

                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground border border-border">
                  Commercial evaluation and wallet settlement require both Buyer Revenue and Vendor Payout to be set. Existing evaluated calls will not be retroactively modified.
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" type="button" onClick={() => { setEditModalOpen(false); setCampaignToEdit(null); }}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isEditingCampaign}>
                  Save Changes
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {deactivateModalOpen && campaignToDeactivate && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Deactivate Campaign</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to deactivate the campaign <strong>{campaignToDeactivate.name}</strong>? It will no longer route calls.
              </p>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button variant="outline" onClick={() => { setDeactivateModalOpen(false); setCampaignToDeactivate(null); }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeactivateConfirm} isLoading={isDeactivatingCampaign}>
                Deactivate
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {addTrackingNumberModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Add Tracking Number</CardTitle>
            </CardHeader>
            <form onSubmit={handleAddTrackingNumberSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Select Phone Number</Label>
                  <select
                    value={selectedPhoneNumberId}
                    onChange={(e) => setSelectedPhoneNumberId(e.target.value)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  >
                    <option value="" disabled>Select Number ▼</option>
                    {availablePhoneNumbers.map(n => (
                      <option key={n.id} value={n.id}>{n.phone_number}</option>
                    ))}
                  </select>
                  {availablePhoneNumbers.length === 0 && (
                    <p className="text-xs text-warning-muted-foreground mt-1">No unassigned numbers found.</p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" type="button" onClick={() => setAddTrackingNumberModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={availablePhoneNumbers.length === 0} isLoading={isAddingPhoneNumber}>
                  Assign Number
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {addBuyerModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Add Buyer to Campaign</CardTitle>
            </CardHeader>
            <form onSubmit={handleAddBuyerSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Select Buyer</Label>
                  <select
                    value={selectedBuyerId}
                    onChange={(e) => setSelectedBuyerId(e.target.value)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  >
                    <option value="" disabled>Select Buyer ▼</option>
                    {availableBuyers.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.destination_number})</option>
                    ))}
                  </select>
                  {availableBuyers.length === 0 && (
                    <p className="text-xs text-warning-muted-foreground mt-1">No buyers found in this workspace.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Input 
                    type="number"
                    min="1"
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                    required
                  />
                  <p className="text-xs text-muted-foreground">Priority order for dialing (1 is tried first).</p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" type="button" onClick={() => setAddBuyerModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={availableBuyers.length === 0} isLoading={isAddingBuyer}>
                  Add Buyer
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
