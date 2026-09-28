'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface Campaign {
  id: string;
  name: string;
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  name: string | null;
  status: string;
  provider: string;
  campaign?: Campaign | null;
  campaign_id?: string | null;
}

interface AvailableNumber {
  phone_number: string;
  locality?: string;
  administrative_area?: string;
}

export default function PhoneNumbersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Assignment Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    async function loadAll() {
      if (!workspaceId) return;
      try {
        const [numData, campData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/phone-numbers`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/campaigns`).catch(() => [])
        ]);
        setNumbers(numData?.items || numData || []);
        setCampaigns(campData?.items || campData || []);
      } catch (e: unknown) {
        setError('Failed to load phone numbers or campaigns.');
      } finally {
        setLoading(false);
      }
    }
    
    if (workspaceId) {
      loadAll();
    }
  }, [workspaceId]);

  async function loadPhoneNumbers(id: string) {
    try {
      const data = await apiFetch(`/workspaces/${id}/phone-numbers`);
      setNumbers(data?.items || data || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSearch() {
    if (!workspaceId) return;
    setIsSearching(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/phone-numbers/search?countryCode=US&limit=5`);
      setAvailableNumbers(data);
    } catch (e: unknown) {
      setError('Failed to search numbers: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleProvision(phoneNumber: string) {
    if (!workspaceId) return;
    setIsProvisioning(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      });
      setAvailableNumbers([]);
      await loadPhoneNumbers(workspaceId);
      setSuccess('Phone number provisioned successfully.');
    } catch (e: unknown) {
      setError('Failed to provision number: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsProvisioning(false);
    }
  }

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !selectedPhone || !selectedCampaignId) return;
    setIsAssigning(true);
    setError(null);
    setSuccess(null);
    
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumberId: selectedPhone.id }),
      });
      
      setSuccess('Phone number assigned to campaign.');
      setAssignModalOpen(false);
      setSelectedPhone(null);
      setSelectedCampaignId('');
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError('Unable to assign this number to the campaign. ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAssigning(false);
    }
  }

  function openAssignModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setSelectedCampaignId(phone.campaign_id || '');
    setAssignModalOpen(true);
  }

  if (loading) return <div className="p-8 flex items-center justify-center text-muted-foreground">Loading phone numbers...</div>;
  if (!workspaceId) return <div className="p-8 flex items-center justify-center text-muted-foreground">Please select a workspace first.</div>;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Phone Numbers</h1>
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
          <CardTitle>Provisioned Numbers</CardTitle>
          <CardDescription>Numbers active in your workspace that can be assigned to campaigns.</CardDescription>
        </CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
             <EmptyState
               title="No phone numbers"
               description="Search and provision a new phone number below."
             />
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="min-w-[150px]">Number</TableHead>
                    <TableHead className="min-w-[150px]">Campaign</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="text-right min-w-[100px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {numbers.map((num) => (
                    <TableRow key={num.id}>
                      <TableCell className="font-mono font-medium text-foreground">
                        {num.phone_number}
                      </TableCell>
                      <TableCell>
                        {num.campaign ? (
                          <span className="font-medium text-foreground">{num.campaign.name}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={num.status === 'ACTIVE' ? 'success' : num.status === 'ASSIGNED' ? 'info' : 'outline'}>
                          {num.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAssignModal(num)}
                        >
                          {num.campaign ? 'Change' : 'Assign'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provision New Number</CardTitle>
          <CardDescription>Search for available US numbers to add to your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Button
              onClick={handleSearch}
              isLoading={isSearching}
              variant="secondary"
            >
              Search US Numbers
            </Button>
          </div>

          {availableNumbers.length > 0 && (
            <div className="space-y-3">
              <Label className="text-muted-foreground uppercase tracking-wider text-xs font-semibold">Available Numbers</Label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {availableNumbers.map((num) => (
                  <div key={num.phone_number} className="flex flex-col justify-between p-4 bg-muted/20 rounded-lg border border-border">
                    <div className="mb-4">
                      <div className="font-mono text-lg font-medium text-foreground mb-1">
                        {num.phone_number}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {num.locality && num.administrative_area ? `${num.locality}, ${num.administrative_area}` : 'Toll-free / Unknown'}
                      </div>
                    </div>
                    <Button
                      onClick={() => handleProvision(num.phone_number)}
                      disabled={isProvisioning}
                      variant="primary"
                      className="w-full"
                    >
                      {isProvisioning ? 'Provisioning...' : 'Provision'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {assignModalOpen && selectedPhone && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Assign to Campaign</CardTitle>
            </CardHeader>
            <form onSubmit={handleAssignSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Phone Number</Label>
                  <div className="font-mono bg-muted/30 p-2.5 rounded-md border border-border text-sm">
                    {selectedPhone.phone_number}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Campaign</Label>
                  <select
                    value={selectedCampaignId}
                    onChange={(e) => setSelectedCampaignId(e.target.value)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  >
                    <option value="" disabled>Select Campaign ▼</option>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {campaigns.length === 0 && (
                    <p className="text-xs text-warning-muted-foreground mt-1">No campaigns found. Please create one first.</p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isLoading={isAssigning}
                  disabled={!selectedCampaignId || campaigns.length === 0}
                >
                  Assign
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
