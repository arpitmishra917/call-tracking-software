'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export default function MemberPermissionsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const workspaceId = searchParams.get('workspace');
  const memberId = params.memberId as string;

  const [member, setMember] = useState<any>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<any[]>([]);
  const [buyers, setBuyers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Assignment State
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState('');
  const [selectedScope, setSelectedScope] = useState('ALL');
  const [selectedResource, setSelectedResource] = useState('');
  
  const [revokeData, setRevokeData] = useState<{key: string, scopeType: string, resourceId?: string} | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const fetchData = useCallback(async () => {
    if (!workspaceId || !memberId) return;
    try {
      setLoading(true);
      setError(null);

      // Fetch member
      const membersData = await apiFetch(`/workspaces/${workspaceId}/members`);
      const m = (Array.isArray(membersData) ? membersData : []).find((m: any) => m.id === memberId || m.user_id === memberId);
      if (!m) throw new Error('Member not found in workspace');
      setMember(m);

      // We actually need the true memberId (the workspace_member.id). Let's use m.id if available.
      const trueMemberId = m.id;

      // Fetch Permissions
      const [allPerms, memPerms] = await Promise.all([
        apiFetch(`/workspaces/${workspaceId}/permissions`),
        apiFetch(`/workspaces/${workspaceId}/permissions/members/${trueMemberId}`)
      ]);
      setAllPermissions(Array.isArray(allPerms) ? allPerms : []);
      setPermissions(Array.isArray(memPerms) ? memPerms : []);

      // Fetch resources silently
      try {
        const [c, p, b, v] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/campaigns`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/phone-numbers`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/buyers`).catch(() => []),
          apiFetch(`/workspaces/${workspaceId}/vendors`).catch(() => [])
        ]);
        setCampaigns(Array.isArray(c) ? c : []);
        setPhoneNumbers(Array.isArray(p) ? p : []);
        setBuyers(Array.isArray(b) ? b : []);
        setVendors(Array.isArray(v) ? v : []);
      } catch (err) {
        console.error('Failed to load some resources', err);
      }

    } catch (err: any) {
      if (err.message.includes('403')) {
        setError('403 Forbidden: You do not have permission to view or manage permissions.');
      } else {
        setError(err.message || 'Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, memberId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !selectedPermission) return;
    
    // Some scopes require resources
    if (['CAMPAIGN', 'PHONE_NUMBER', 'BUYER', 'VENDOR'].includes(selectedScope) && !selectedResource) {
      setError('Please select a resource for the chosen scope.');
      return;
    }
    
    setIsAssigning(true);
    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/permissions/members/${member.id}/${selectedPermission}`, {
        method: 'PUT',
        body: JSON.stringify({
          scopeType: selectedScope,
          resourceId: selectedResource || undefined
        })
      });
      // Reset form
      setSelectedPermission('');
      setSelectedScope('ALL');
      setSelectedResource('');
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to assign permission');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRevoke = async () => {
    if (!workspaceId || !revokeData || !member) return;
    setIsRevoking(true);
    try {
      setError(null);
      const url = `/workspaces/${workspaceId}/permissions/members/${member.id}/${revokeData.key}?scopeType=${revokeData.scopeType}${revokeData.resourceId ? `&resourceId=${revokeData.resourceId}` : ''}`;
      await apiFetch(url, { method: 'DELETE' });
      setRevokeData(null);
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke permission');
    } finally {
      setIsRevoking(false);
    }
  };

  if (!workspaceId) return <div className="p-8">No workspace selected</div>;
  if (loading) return <div className="p-8">Loading member details...</div>;

  const isOwner = member?.role === 'OWNER';
  const isAdmin = member?.role === 'ADMIN';

  // Group current permissions by group
  const groupedPermissions: Record<string, any[]> = {};
  for (const p of permissions) {
    if (!groupedPermissions[p.group]) groupedPermissions[p.group] = [];
    groupedPermissions[p.group].push(p);
  }

  // Get unassigned permissions for dropdown
  const getUnassignedOptions = () => {
    return allPermissions.filter(ap => {
      // Allow assigning if not already assigned identically
      // Actually we can just show all, since they might want to assign with a different scope.
      return true;
    });
  };

  const getResourceName = (scopeType: string, resourceId: string) => {
    if (!resourceId) return '';
    if (scopeType === 'CAMPAIGN') return campaigns.find(c => c.id === resourceId)?.name || resourceId;
    if (scopeType === 'PHONE_NUMBER') return phoneNumbers.find(p => p.id === resourceId)?.phone_number || resourceId;
    if (scopeType === 'BUYER') return buyers.find(b => b.id === resourceId)?.name || resourceId;
    if (scopeType === 'VENDOR') return vendors.find(v => v.id === resourceId)?.name || resourceId;
    return resourceId;
  };

  const getScopeHelpText = (scopeType: string) => {
    switch (scopeType) {
      case 'ALL': return 'Access to all resources in the workspace.';
      case 'ASSIGNED': return 'Access limited to resources explicitly assigned to this member (e.g., if they are a Buyer/Vendor).';
      case 'CAMPAIGN': return 'Access limited to a specific campaign and its child objects.';
      case 'PHONE_NUMBER': return 'Access limited to calls routing through a specific phone number.';
      case 'BUYER': return 'Access limited to a specific buyer.';
      case 'VENDOR': return 'Access limited to a specific vendor.';
      default: return '';
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Manage Permissions</h1>
          <p className="text-muted-foreground mt-1">
            {member ? `${member.profile?.display_name || member.user_id} • ${member.participant_type}` : ''}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          {error}
        </div>
      )}

      {isOwner ? (
        <Card>
          <CardContent className="p-8 text-center flex flex-col items-center">
            <ShieldAlert className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-bold">Workspace Owner</h3>
            <p className="text-muted-foreground max-w-md mt-2">
              This member is an OWNER. Owners inherently have full access to all resources and permissions. Their permissions cannot be selectively revoked unless their role is demoted.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <h2 className="text-xl font-bold">Current Permissions</h2>
            {isAdmin && (
              <div className="p-4 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-md border border-blue-500/20 text-sm">
                This member is an <strong>ADMIN</strong> and receives a comprehensive baseline of permissions automatically. The permissions shown below represent their baseline access plus any explicit assignments.
              </div>
            )}
            
            {Object.keys(groupedPermissions).length === 0 ? (
              <div className="p-8 text-center border rounded-lg bg-card text-muted-foreground">
                No permissions assigned.
              </div>
            ) : (
              <div className="space-y-4">
                {Object.keys(groupedPermissions).sort().map(group => (
                  <Card key={group}>
                    <CardHeader className="py-3 bg-muted/30">
                      <CardTitle className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">{group}</CardTitle>
                    </CardHeader>
                    <div className="divide-y">
                      {groupedPermissions[group].map((p, i) => (
                        <div key={i} className="p-4 flex items-center justify-between hover:bg-muted/10">
                          <div>
                            <div className="font-medium">{p.key}</div>
                            <div className="text-xs text-muted-foreground mt-1">{p.description}</div>
                            <div className="mt-2 flex gap-2">
                              <Badge variant={p.scope_type === 'ALL' ? 'default' : 'outline'} className="text-[10px]">
                                {p.scope_type}
                              </Badge>
                              {p.resource_id && (
                                <Badge variant="outline" className="text-[10px]">
                                  {getResourceName(p.scope_type, p.resource_id)}
                                </Badge>
                              )}
                            </div>
                          </div>
                          {!isAdmin && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => setRevokeData({ key: p.key, scopeType: p.scope_type, resourceId: p.resource_id })}
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-1">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle>Assign Permission</CardTitle>
                <CardDescription>Grant specific access to this member.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleAssign} className="space-y-4">
                  <div>
                    <label htmlFor="permission-select" className="block text-sm font-medium mb-1">Permission</label>
                    <select
                      id="permission-select"
                      required
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={selectedPermission}
                      onChange={(e) => setSelectedPermission(e.target.value)}
                    >
                      <option value="" disabled>Select a permission...</option>
                      {getUnassignedOptions().map(p => (
                        <option key={p.key} value={p.key}>{p.key} ({p.group})</option>
                      ))}
                    </select>
                    {selectedPermission && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {allPermissions.find(p => p.key === selectedPermission)?.description}
                      </p>
                    )}
                  </div>

                  {selectedPermission && (
                    <div>
                      <label htmlFor="scope-select" className="block text-sm font-medium mb-1">Scope</label>
                      <select
                        id="scope-select"
                        required
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        value={selectedScope}
                        onChange={(e) => {
                          setSelectedScope(e.target.value);
                          setSelectedResource('');
                        }}
                      >
                        <option value="ALL">All Resources (ALL)</option>
                        <option value="ASSIGNED">My Assigned Resources (ASSIGNED)</option>
                        <option value="CAMPAIGN">Specific Campaign</option>
                        <option value="PHONE_NUMBER">Specific Phone Number</option>
                        <option value="BUYER">Specific Buyer</option>
                        <option value="VENDOR">Specific Vendor</option>
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">
                        {getScopeHelpText(selectedScope)}
                      </p>
                    </div>
                  )}

                  {['CAMPAIGN', 'PHONE_NUMBER', 'BUYER', 'VENDOR'].includes(selectedScope) && (
                    <div>
                      <label htmlFor="resource-select" className="block text-sm font-medium mb-1">Resource</label>
                      <select
                        id="resource-select"
                        required
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        value={selectedResource}
                        onChange={(e) => setSelectedResource(e.target.value)}
                      >
                        <option value="" disabled>Select a {selectedScope.toLowerCase()}...</option>
                        {selectedScope === 'CAMPAIGN' && campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        {selectedScope === 'PHONE_NUMBER' && phoneNumbers.map(p => <option key={p.id} value={p.id}>{p.phone_number}</option>)}
                        {selectedScope === 'BUYER' && buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        {selectedScope === 'VENDOR' && vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={!selectedPermission || isAssigning}>
                    {isAssigning ? 'Assigning...' : 'Assign Permission'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!revokeData}
        onOpenChange={(open) => !open && setRevokeData(null)}
        title="Revoke Permission"
        description="Are you sure you want to revoke this permission? The member may lose access immediately."
        onConfirm={handleRevoke}
        isLoading={isRevoking}
        confirmText="Revoke"
      />
    </div>
  );
}
