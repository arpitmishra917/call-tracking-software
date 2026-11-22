'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Search, X, AlertCircle } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
}

interface Vendor {
  id: string;
  name: string;
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  name: string | null;
  status: string;
  provider?: string;
  campaign?: Campaign | null;
  campaign_id?: string | null;
  vendor?: Vendor | null;
  vendor_id?: string | null;
  number_type?: string | null;
}

interface AvailableNumber {
  phone_number: string;
  phone_number_type?: string;
  region_information?: Array<{
    region_type: string;
    region_name: string;
  }>;
}

export function getPhoneTypeDisplay(num: AvailableNumber): string {
  if (num.phone_number_type === 'local') return 'Local';
  if (num.phone_number_type === 'toll_free') return 'Toll-Free';
  return 'Unknown';
}

export default function PhoneNumbersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);
  const requestGenRef = useRef(0);
  
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Render-time workspace identity guard: eliminate stale data rendering during workspace transitions
  const isWorkspaceStale = currentWorkspaceIdRef.current !== workspaceId;
  const activeNumbers = isWorkspaceStale ? [] : numbers;
  const activeCampaigns = isWorkspaceStale ? [] : campaigns;
  const activeVendors = isWorkspaceStale ? [] : vendors;
  const activeAvailableNumbers = isWorkspaceStale ? [] : availableNumbers;
  const isLoading = loading || isWorkspaceStale;

  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    requestGenRef.current++;
    setNumbers([]);
    setAvailableNumbers([]);
    setCampaigns([]);
    setVendors([]);
    setError(null);
    setSuccess(null);
  }, [workspaceId]);

  // Assignment Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Unassign Modal State
  const [unassignModalOpen, setUnassignModalOpen] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);

  // Vendor Assignment Modal State
  const [assignVendorModalOpen, setAssignVendorModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [isAssigningVendor, setIsAssigningVendor] = useState(false);

  const [isVendor, setIsVendor] = useState(false);

  // Filter States for Provisioned Numbers
  const [filterText, setFilterText] = useState('');
  const [filterCampaignId, setFilterCampaignId] = useState('ALL');
  const [filterVendorId, setFilterVendorId] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Dedicated Unassign Vendor Modal State
  const [unassignVendorPhone, setUnassignVendorPhone] = useState<PhoneNumber | null>(null);
  const [isUnassignVendorOpen, setIsUnassignVendorOpen] = useState(false);
  const [isSubmittingUnassignVendor, setIsSubmittingUnassignVendor] = useState(false);

  const [searchPrefix, setSearchPrefix] = useState('');
  const [searchType, setSearchType] = useState('local');

  useEffect(() => {
    async function checkRole() {
      if (!workspaceId) return;
      try {
        const workspaces = await apiFetch('/workspaces');
        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === workspaceId)
          : null;
        if (currentWs) {
          setIsVendor(currentWs.participant_type === 'VENDOR');
        }
      } catch {
        // Continue if workspace query fails
      }
    }
    checkRole();
  }, [workspaceId]);

  useEffect(() => {
    async function loadAll() {
      if (!workspaceId) return;
      const targetWs = workspaceId;
      const currentGen = ++requestGenRef.current;
      setLoading(true);
      try {
        const [numData, campData, vendData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/phone-numbers`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/campaigns`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/vendors`).catch(() => ({ items: [] }))
        ]);
        if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
          return;
        }
        setNumbers(numData?.items || []);
        setCampaigns(campData?.items || campData || []);
        const vendorList = vendData?.items || vendData || [];
        setVendors(Array.isArray(vendorList) ? vendorList : []);
      } catch (e: unknown) {
        if (currentGen !== requestGenRef.current || targetWs !== currentWorkspaceIdRef.current) {
          return;
        }
        setError('Failed to load phone numbers or campaigns.');
      } finally {
        if (currentGen === requestGenRef.current && targetWs === currentWorkspaceIdRef.current) {
          setLoading(false);
        }
      }
    }
    
    if (workspaceId) {
      loadAll();
    }
  }, [workspaceId]);

  async function loadPhoneNumbers(id: string) {
    try {
      const data = await apiFetch(`/workspaces/${id}/phone-numbers`);
      setNumbers(data?.items || []);
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
      const url = new URL(`/workspaces/${workspaceId}/phone-numbers/search`, window.location.origin);
      url.searchParams.set('countryCode', 'US');
      url.searchParams.set('limit', '5');
      url.searchParams.set('numberType', searchType);
      if (searchPrefix) url.searchParams.set('prefix', searchPrefix);

      const data = await apiFetch(url.pathname + url.search);
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

  function openAssignVendorModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setSelectedVendorId(phone.vendor?.id || phone.vendor_id || '');
    setAssignVendorModalOpen(true);
  }

  async function handleAssignVendorSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !selectedPhone) return;
    setIsAssigningVendor(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers/${selectedPhone.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          vendorId: selectedVendorId ? selectedVendorId : null
        })
      });
      setSuccess('Vendor assignment updated successfully.');
      setAssignVendorModalOpen(false);
      setSelectedPhone(null);
      setSelectedVendorId('');
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError('Unable to update vendor assignment: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAssigningVendor(false);
    }
  }

  function openUnassignVendorDialog(phone: PhoneNumber) {
    setUnassignVendorPhone(phone);
    setIsUnassignVendorOpen(true);
  }

  async function handleConfirmUnassignVendor() {
    if (!workspaceId || !unassignVendorPhone) return;
    setIsSubmittingUnassignVendor(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers/${unassignVendorPhone.id}`, {
        method: 'PUT',
        body: JSON.stringify({ vendorId: null }),
      });
      setSuccess(`Vendor unassigned from ${unassignVendorPhone.phone_number} successfully.`);
      setIsUnassignVendorOpen(false);
      setUnassignVendorPhone(null);
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError('Unable to unassign vendor: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsSubmittingUnassignVendor(false);
    }
  }

  const filteredNumbers = activeNumbers.filter((num) => {
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      const matchNumber = num.phone_number?.toLowerCase().includes(q);
      const matchName = num.name?.toLowerCase().includes(q);
      if (!matchNumber && !matchName) return false;
    }

    if (filterCampaignId === 'UNASSIGNED') {
      if (num.campaign_id || num.campaign) return false;
    } else if (filterCampaignId !== 'ALL') {
      const currentCampId = num.campaign?.id || num.campaign_id;
      if (currentCampId !== filterCampaignId) return false;
    }

    if (!isVendor) {
      if (filterVendorId === 'UNASSIGNED') {
        if (num.vendor_id || num.vendor) return false;
      } else if (filterVendorId !== 'ALL') {
        const currentVendId = num.vendor?.id || num.vendor_id;
        if (currentVendId !== filterVendorId) return false;
      }
    }

    if (filterStatus !== 'ALL') {
      if (num.status !== filterStatus) return false;
    }

    return true;
  });

  const hasActiveFilters =
    Boolean(filterText.trim()) ||
    filterCampaignId !== 'ALL' ||
    filterVendorId !== 'ALL' ||
    filterStatus !== 'ALL';

  function handleClearFilters() {
    setFilterText('');
    setFilterCampaignId('ALL');
    setFilterVendorId('ALL');
    setFilterStatus('ALL');
  }

  function openAssignModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setSelectedCampaignId(phone.campaign_id || '');
    setAssignModalOpen(true);
  }

  function openUnassignModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setUnassignModalOpen(true);
  }

  async function handleUnassign() {
    if (!workspaceId || !selectedPhone || !selectedPhone.campaign_id) return;
    setIsUnassigning(true);
    setError(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${selectedPhone.campaign_id}/phone-numbers/${selectedPhone.id}`, {
        method: 'DELETE',
      });
      setSuccess('Phone number unassigned successfully.');
      setUnassignModalOpen(false);
      setSelectedPhone(null);
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsUnassigning(false);
    }
  }



  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  function openReleaseModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setReleaseModalOpen(true);
  }

  async function handleRelease() {
    if (!workspaceId || !selectedPhone) return;
    setIsReleasing(true);
    setError(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers/${selectedPhone.id}`, {
        method: 'DELETE',
      });
      setSuccess('Phone number released successfully.');
      setReleaseModalOpen(false);
      setSelectedPhone(null);
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError('Failed to release number: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsReleasing(false);
    }
  }

  if (isLoading) return <div className="p-8 flex items-center justify-center text-muted-foreground">Loading phone numbers...</div>;
  if (!workspaceId) return <div className="p-8 flex items-center justify-center text-muted-foreground">Please select a workspace first.</div>;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{isVendor ? 'Tracking Numbers' : 'Phone Numbers'}</h1>
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
          <CardTitle>{isVendor ? 'Assigned Tracking Numbers' : 'Provisioned Numbers'}</CardTitle>
          <CardDescription>
            {isVendor
              ? 'Inbound tracking numbers assigned to your organization.'
              : 'Numbers active in your workspace that can be assigned to campaigns.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Controls */}
          {activeNumbers.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between pb-2">
              <div className="flex flex-1 flex-wrap gap-3 items-center w-full">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter by number or name..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="pl-8 h-9 text-sm"
                  />
                </div>

                <div className="w-[160px]">
                  <select
                    value={filterCampaignId}
                    onChange={(e) => setFilterCampaignId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="ALL">All Campaigns</option>
                    <option value="UNASSIGNED">Unassigned Campaign</option>
                    {activeCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {!isVendor && (
                  <div className="w-[160px]">
                    <select
                      value={filterVendorId}
                      onChange={(e) => setFilterVendorId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="ALL">All Vendors</option>
                      <option value="UNASSIGNED">Unassigned Vendor</option>
                      {activeVendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="w-[130px]">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ASSIGNED">ASSIGNED</option>
                    <option value="PROVISIONING">PROVISIONING</option>
                    <option value="RELEASED">RELEASED</option>
                  </select>
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          )}

          {activeNumbers.length === 0 ? (
             <EmptyState
               title={isVendor ? "No tracking numbers assigned" : "No phone numbers"}
               description={isVendor ? "You do not have any inbound tracking numbers assigned to your account yet." : "Search and provision a new phone number below."}
             />
          ) : filteredNumbers.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground border border-dashed rounded-md">
              <p>No phone numbers match the current filters.</p>
              <Button variant="ghost" size="sm" onClick={handleClearFilters} className="mt-2 text-primary hover:underline">
                Clear Filters
              </Button>
            </div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="min-w-[150px]">Number</TableHead>
                    <TableHead className="min-w-[100px]">Type</TableHead>
                    <TableHead className="min-w-[150px]">Campaign</TableHead>
                    {!isVendor && <TableHead className="min-w-[150px]">Vendor</TableHead>}
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    {!isVendor && <TableHead className="text-right min-w-[150px]">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredNumbers.map((num) => {
                    const typeLabels: Record<string, string> = {
                      local: 'Local',
                      toll_free: 'Toll-Free',
                      mobile: 'Mobile',
                      national: 'National',
                      shared_cost: 'Shared Cost'
                    };
                    const displayType = num.number_type ? (typeLabels[num.number_type] || num.number_type) : 'Unknown';
                    
                    return (
                    <TableRow key={num.id}>
                      <TableCell>
                        <div className="font-mono font-medium text-foreground">{num.phone_number}</div>
                        {num.name && <div className="text-sm text-muted-foreground">{num.name}</div>}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{displayType}</span>
                      </TableCell>
                      <TableCell>
                        {num.campaign ? (
                          <span className="font-medium text-foreground">{num.campaign.name}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      {!isVendor && (
                        <TableCell>
                          {num.vendor ? (
                            <span className="font-medium text-foreground">{num.vendor.name}</span>
                          ) : (
                            <span className="text-muted-foreground italic">Unassigned</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant={num.status === 'ACTIVE' ? 'success' : num.status === 'ASSIGNED' ? 'info' : 'outline'}>
                          {num.status}
                        </Badge>
                      </TableCell>
                      {!isVendor && (
                        <TableCell className="text-right space-x-2">
                          {num.status !== 'RELEASED' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAssignModal(num)}
                              >
                                {num.campaign ? 'Change' : 'Assign'}
                              </Button>
                              {num.campaign && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openUnassignModal(num)}
                                >
                                  Unassign
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAssignVendorModal(num)}
                              >
                                {num.vendor ? 'Vendor' : 'Assign Vendor'}
                              </Button>
                              {num.vendor && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openUnassignVendorDialog(num)}
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  Unassign Vendor
                                </Button>
                              )}
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => openReleaseModal(num)}
                              >
                                Release
                              </Button>
                            </>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!isVendor && (
      <Card>
        <CardHeader>
          <CardTitle>Provision New Number</CardTitle>
          <CardDescription>Search for available US numbers to add to your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-1.5 flex-1">
              <Label>Number Type</Label>
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="local">Local</option>
                <option value="toll_free">Toll-Free</option>
              </select>
            </div>
            <div className="space-y-1.5 flex-1">
              <Label>Prefix (Optional)</Label>
              <Input
                value={searchPrefix}
                onChange={(e) => setSearchPrefix(e.target.value)}
                placeholder={searchType === 'toll_free' ? 'e.g. 888' : 'e.g. 415'}
              />
            </div>
            <Button
              onClick={handleSearch}
              isLoading={isSearching}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Search Available Numbers
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
                        {getPhoneTypeDisplay(num)}
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
      )}

      {assignVendorModalOpen && selectedPhone && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Assign Vendor</CardTitle>
              <CardDescription>Assign or unassign a vendor for this tracking number.</CardDescription>
            </CardHeader>
            <form onSubmit={handleAssignVendorSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Phone Number</Label>
                  <div className="font-mono bg-muted/30 p-2.5 rounded-md border border-border text-sm">
                    {selectedPhone.phone_number}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vendor-select">Vendor</Label>
                  <select
                    id="vendor-select"
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">-- Unassigned --</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  {vendors.length === 0 ? (
                    <div className="bg-warning-muted text-warning-muted-foreground p-3 rounded-md text-xs border border-warning-muted flex items-start gap-2 mt-2">
                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <span>
                        No vendors found in this workspace.{' '}
                        <Link
                          href={`/protected/vendors?workspace=${workspaceId}`}
                          className="underline font-medium hover:text-foreground"
                        >
                          Create a vendor in the Vendors tab
                        </Link>{' '}
                        first.
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">
                      Inbound calls received on this number will be attributed to the selected vendor. Historical call records will retain their existing attribution.
                    </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setAssignVendorModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isLoading={isAssigningVendor}
                >
                  Save Assignment
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* Unassign Vendor Confirmation Dialog */}
      <ConfirmDialog
        open={isUnassignVendorOpen}
        onOpenChange={setIsUnassignVendorOpen}
        title="Unassign Vendor"
        description={
          <span>
            Are you sure you want to unassign vendor{' '}
            <strong>{unassignVendorPhone?.vendor?.name || 'the vendor'}</strong> from{' '}
            <strong className="font-mono">{unassignVendorPhone?.phone_number}</strong>?
            <br /><br />
            Future inbound calls received on this number will no longer be attributed to this vendor. Historical calls and settlements will remain unchanged.
          </span>
        }
        confirmText="Unassign Vendor"
        cancelText="Cancel"
        onConfirm={handleConfirmUnassignVendor}
        isLoading={isSubmittingUnassignVendor}
        destructive={true}
      />

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
      {unassignModalOpen && selectedPhone && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Unassign Phone Number</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to unassign <strong>{selectedPhone.phone_number}</strong>? 
                It will no longer route inbound calls to the campaign&apos;s buyers.
                <br /><br />
                The number will remain provisioned in your workspace and historical call data will be preserved.
              </p>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                variant="outline"
                type="button"
                onClick={() => setUnassignModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleUnassign}
                isLoading={isUnassigning}
              >
                Unassign
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
      {releaseModalOpen && selectedPhone && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Release Phone Number</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to release <strong>{selectedPhone.phone_number}</strong>? 
                This action cannot be undone and you will lose this number permanently.
              </p>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                variant="outline"
                type="button"
                onClick={() => setReleaseModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRelease}
                isLoading={isReleasing}
              >
                Release
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
