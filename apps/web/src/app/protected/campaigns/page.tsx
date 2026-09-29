'use client';

import { useEffect, useState, useCallback } from 'react';
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
  phone_numbers?: PhoneNumber[];
  buyers?: CampaignBuyer[];
}

export default function CampaignsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availableBuyers, setAvailableBuyers] = useState<Buyer[]>([]);
  
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
  const [isEditingCampaign, setIsEditingCampaign] = useState(false);

  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [campaignToDeactivate, setCampaignToDeactivate] = useState<Campaign | null>(null);
  const [isDeactivatingCampaign, setIsDeactivatingCampaign] = useState(false);

  const [activatingCampaignId, setActivatingCampaignId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const [cData, bData] = await Promise.all([
        apiFetch(`/workspaces/${workspaceId}/campaigns?status=${statusTab}&search=${encodeURIComponent(debouncedSearch)}&limit=${limit}&offset=${offset}`),
        apiFetch(`/workspaces/${workspaceId}/buyers`)
      ]);
      setCampaigns(cData?.items || []);
      setAvailableBuyers(bData?.items || bData || []);
    } catch (e: unknown) {
      setError('Failed to load campaigns/buyers: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
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
      await apiFetch(`/workspaces/${workspaceId}/campaigns`, {
        method: 'POST',
        body: JSON.stringify({ name: newCampaignName }),
      });
      setNewCampaignName('');
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
      setError('Failed to fetch available phone numbers');
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
      setSuccess('Tracking number assigned successfully.');
      setAddTrackingNumberModalOpen(false);
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to assign tracking number: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAddingPhoneNumber(false);
    }
  }

  async function handleRemoveTrackingNumber(campaignId: string, phoneNumberId: string) {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to remove this tracking number from the campaign? The number will not be released.')) return;
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
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editCampaignName }),
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
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md text-sm border border-error-muted">
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
          campaigns.map(c => (
            <Card key={c.id} className="overflow-hidden">
              <div className="bg-muted/30 px-6 py-4 border-b border-border flex justify-between items-center flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-foreground">{c.name}</h2>
                  <Badge variant={c.status === 'ACTIVE' ? 'success' : c.status === 'INACTIVE' ? 'warning' : 'default'}>
                    {c.status}
                  </Badge>
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
              
              <CardContent className="p-0">
                <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border">
                  {/* Left Col: Numbers */}
                  <div className="p-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tracking Numbers</h3>
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
                      <div className="text-sm text-muted-foreground mb-4">
                        No tracking numbers assigned.
                      </div>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openAddTrackingNumberModal(c.id)}>
                      + Add Tracking Number
                    </Button>
                  </div>

                  {/* Right Col: Buyers */}
                  <div className="p-6 lg:col-span-2">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Routing Order (Buyers)</h3>
                      <Button variant="outline" size="sm" onClick={() => openAddBuyerModal(c.id, c.buyers)}>
                        + Add Buyer
                      </Button>
                    </div>
                    
                    {c.buyers && c.buyers.length > 0 ? (
                      <div className="border border-border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="w-20 text-center min-w-[80px]">Priority</TableHead>
                              <TableHead className="min-w-[150px]">Buyer</TableHead>
                              <TableHead className="min-w-[150px]">Destination</TableHead>
                              <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...c.buyers].sort((a, b) => a.priority - b.priority).map((cb, index) => (
                              <TableRow key={cb.buyer.id}>
                                <TableCell className="text-center font-medium">
                                  {cb.priority}
                                </TableCell>
                                <TableCell className="font-medium text-foreground">
                                  {cb.buyer.name}
                                </TableCell>
                                <TableCell className="font-mono text-muted-foreground">
                                  {cb.buyer.destination_number}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => handleMoveBuyer(c.id, c.buyers || [], index, 'up')} disabled={index === 0}>↑</Button>
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => handleMoveBuyer(c.id, c.buyers || [], index, 'down')} disabled={index === c.buyers!.length - 1}>↓</Button>
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-error hover:text-error hover:bg-error/10" onClick={() => handleRemoveBuyer(c.id, cb.buyer.id)}>Remove</Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
                        No buyers assigned. Calls to this campaign will fail.
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Create Campaign</CardTitle>
            </CardHeader>
            <form onSubmit={handleCreate}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="newCampaignName">Campaign Name</Label>
                  <Input 
                    id="newCampaignName"
                    type="text" 
                    value={newCampaignName} 
                    onChange={e => setNewCampaignName(e.target.value)}
                    placeholder="e.g. Inbound Sales" 
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" type="button" onClick={() => setCreateModalOpen(false)}>
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

      {editModalOpen && campaignToEdit && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Edit Campaign</CardTitle>
            </CardHeader>
            <form onSubmit={handleEditSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editCampaignName">Campaign Name</Label>
                  <Input 
                    id="editCampaignName"
                    type="text" 
                    value={editCampaignName} 
                    onChange={e => setEditCampaignName(e.target.value)}
                    required
                  />
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
                <Button type="submit" isLoading={isAddingPhoneNumber} disabled={!selectedPhoneNumberId || availablePhoneNumbers.length === 0}>
                  Add Number
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
              <CardTitle>Add Buyer</CardTitle>
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
                  <Label>Priority (1 = Highest)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    required
                  />
                  <p className="text-xs text-muted-foreground">Calls route to lower priority numbers first.</p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" type="button" onClick={() => setAddBuyerModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isAddingBuyer} disabled={!selectedBuyerId || availableBuyers.length === 0}>
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
