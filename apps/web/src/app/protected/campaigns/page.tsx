'use client';

import { useEffect, useState } from 'react';
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

interface Buyer {
  id: string;
  name: string;
  destination_number: string;
  timeout: number;
}

interface CampaignBuyer {
  priority: number;
  buyer: Buyer;
}

interface PhoneNumber {
  phone_number: string;
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
  
  const [newCampaignName, setNewCampaignName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add Buyer Modal State
  const [addBuyerModalOpen, setAddBuyerModalOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [priority, setPriority] = useState<number>(1);
  const [isAddingBuyer, setIsAddingBuyer] = useState(false);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [cData, bData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/campaigns`),
          apiFetch(`/workspaces/${workspaceId}/buyers`)
        ]);
        setCampaigns(cData?.items || []);
        setAvailableBuyers(bData?.items || bData || []);
      } catch (e: unknown) {
        setError('Failed to load campaigns/buyers: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadData();
    }
  }, [workspaceId]);

  async function refreshCampaigns() {
    if (!workspaceId) return;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/campaigns`);
      setCampaigns(data?.items || []);
    } catch (e) {
      console.error(e);
    }
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
      setSuccess('Campaign created successfully.');
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

  if (loading) return <div className="p-8 flex items-center justify-center text-muted-foreground">Loading campaigns...</div>;
  if (!workspaceId) return <div className="p-8 flex items-center justify-center text-muted-foreground">Select a workspace first.</div>;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
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

      <Card>
        <CardHeader>
          <CardTitle>Create Campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-4 items-end flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label htmlFor="campaignName">Campaign Name</Label>
              <Input 
                id="campaignName"
                type="text" 
                value={newCampaignName} 
                onChange={e => setNewCampaignName(e.target.value)}
                placeholder="e.g. Inbound Sales" 
                required
              />
            </div>
            <Button type="submit" isLoading={isCreatingCampaign}>
              Create Campaign
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns found"
            description="Create a campaign above to start routing calls."
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
                <Link href={`/protected/campaigns/${c.id}?workspace=${workspaceId}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                  View Details
                </Link>
              </div>
              
              <CardContent className="p-0">
                <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border">
                  {/* Left Col: Numbers */}
                  <div className="p-6">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Tracking Numbers</h3>
                    {c.phone_numbers && c.phone_numbers.length > 0 ? (
                      <div className="space-y-2">
                        {c.phone_numbers.map(pn => (
                          <div key={pn.phone_number} className="text-sm font-mono bg-muted/50 px-3 py-2 rounded-md border border-border flex items-center">
                            {pn.phone_number}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No tracking numbers assigned.
                      </div>
                    )}
                  </div>

                  {/* Right Col: Buyers */}
                  <div className="p-6 lg:col-span-2">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Routing Order (Buyers)</h3>
                      <Button variant="outline" size="sm" onClick={() => openAddBuyerModal(c.id, c.buyers)}>
                        Add Buyer
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
                              <TableHead className="text-right min-w-[100px]">Timeout</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...c.buyers].sort((a, b) => a.priority - b.priority).map(cb => (
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
                                <TableCell className="text-right text-muted-foreground">
                                  {cb.buyer.timeout}s
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
