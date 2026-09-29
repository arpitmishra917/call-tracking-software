'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Users, Mail } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

type Profile = {
  id: string;
  display_name: string | null;
  created_at: string;
};

type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile: Profile;
};

type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

export default function MembersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Invite Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [isInviting, setIsInviting] = useState(false);
  
  // Success Modal State
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Role Change
  const [isChangingRole, setIsChangingRole] = useState<string | null>(null);

  const [removeId, setRemoveId] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
      }
    });
  }, []);

  const fetchMembersAndInvitations = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const workspaces = await apiFetch('/workspaces');
      const ws = workspaces.find((w: { id: string; role: string }) => w.id === workspaceId);
      const role = ws?.role || null;
      setUserRole(role);

      const data = await apiFetch(`/workspaces/${workspaceId}/members`);
      setMembers(Array.isArray(data) ? data : []);

      if (role === 'OWNER' || role === 'ADMIN') {
        try {
          const invData = await apiFetch(`/workspaces/${workspaceId}/invitations`);
          setInvitations(Array.isArray(invData) ? invData : []);
        } catch (e) {
          console.error("Failed to fetch invitations", e);
        }
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (!ignore) {
        setLoading(true);
        fetchMembersAndInvitations();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchMembersAndInvitations]);

  const handleRemove = async () => {
    if (!workspaceId || !removeId) return;
    
    setIsRemoving(true);
    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/members/${removeId}`, {
        method: 'DELETE',
      });
      await fetchMembersAndInvitations();
      setRemoveId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setIsRemoving(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    if (!workspaceId) return;
    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/invitations/${inviteId}`, {
        method: 'DELETE',
      });
      await fetchMembersAndInvitations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation');
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!workspaceId) return;
    setIsChangingRole(userId);
    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/members/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      await fetchMembersAndInvitations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    } finally {
      setIsChangingRole(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !inviteEmail) return;
    setIsInviting(true);
    try {
      setError(null);
      const res = await apiFetch(`/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res && res.token) {
        setInviteToken(res.token);
      }
      setIsInviteModalOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      await fetchMembersAndInvitations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setIsInviting(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Select a workspace first.
      </div>
    );
  }

  const isOwnerOrAdmin = userRole === 'OWNER' || userRole === 'ADMIN';

  return (
    <div className="flex flex-col gap-8 pb-8 max-w-5xl mx-auto w-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workspace Members</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl">
            Manage access to this workspace. Invite new members, change roles, and remove access.
          </p>
        </div>
        {isOwnerOrAdmin && (
          <Button onClick={() => setIsInviteModalOpen(true)}>Invite Member</Button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {/* Invitations Table */}
      {isOwnerOrAdmin && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>Invitations awaiting acceptance.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="min-w-[200px]">Email</TableHead>
                  <TableHead className="min-w-[100px]">Role</TableHead>
                  <TableHead className="min-w-[120px]">Invited</TableHead>
                  <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{inv.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                        onClick={() => handleRevoke(inv.id)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Active Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>All members who have access to this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading members...</div>
          ) : members.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<Users />}
                title="No members found"
                description="This workspace currently has no active members."
              />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="min-w-[200px]">User / Identity</TableHead>
                  <TableHead className="min-w-[100px]">Role</TableHead>
                  <TableHead className="min-w-[120px]">Joined</TableHead>
                  {isOwnerOrAdmin && <TableHead className="text-right min-w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        {member.profile?.display_name || (member as { email?: string }).email || member.user_id}
                        {currentUserId === member.user_id && (
                          <Badge variant="outline" className="text-xs">You</Badge>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-1 break-all max-w-xs">
                        {(member as { email?: string }).email ? member.user_id : (member.profile?.id || member.user_id)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {isOwnerOrAdmin && currentUserId !== member.user_id ? (
                        <select
                          className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={member.role}
                          disabled={isChangingRole === member.user_id}
                          onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                        >
                          <option value="OWNER">OWNER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="MEMBER">MEMBER</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                      ) : (
                        <Badge variant={member.role === 'OWNER' ? 'success' : member.role === 'ADMIN' ? 'info' : 'outline'}>
                          {member.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(member.created_at).toLocaleDateString()}
                    </TableCell>
                    {isOwnerOrAdmin && (
                      <TableCell className="text-right">
                        {currentUserId !== member.user_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                            onClick={() => setRemoveId(member.user_id)}
                          >
                            Remove
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      <ConfirmDialog
        open={!!removeId}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Remove Member"
        description="Are you sure you want to remove this member from the workspace? This action cannot be undone."
        onConfirm={handleRemove}
        isLoading={isRemoving}
        confirmText="Remove"
      />

      {/* Custom Invite Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Invite Member</h2>
            <form onSubmit={handleInvite}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input
                    type="email"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Role</label>
                  <select
                    className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    <option value="OWNER">OWNER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="MEMBER">MEMBER</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsInviteModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isInviting}>
                  {isInviting ? 'Inviting...' : 'Invite'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {inviteToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-6 border border-border">
            <h2 className="text-xl font-bold mb-2">Invitation Created</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Email delivery is not configured. Copy this invitation link and send it to the recipient.
            </p>
            <div className="flex gap-2 mb-6">
              <input 
                type="text" 
                readOnly 
                className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/invitations?token=${inviteToken}`}
              />
              <Button onClick={() => navigator.clipboard.writeText(`${typeof window !== 'undefined' ? window.location.origin : ''}/invitations?token=${inviteToken}`)}>
                Copy
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setInviteToken(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
