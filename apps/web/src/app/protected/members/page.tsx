'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Users } from 'lucide-react';

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

export default function MembersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const workspaces = await apiFetch('/workspaces');
      const ws = workspaces.find((w: { id: string; role: string }) => w.id === workspaceId);
      setUserRole(ws?.role || null);

      const data = await apiFetch(`/workspaces/${workspaceId}/members`);
      setMembers(Array.isArray(data) ? data : []);
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
        fetchMembers();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchMembers]);

  const handleRemove = async (userId: string) => {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to remove this member from the workspace? This action cannot be undone.')) return;

    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      });
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Workspace Members</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Manage access to this workspace. The backend currently does not support inviting new members via email or editing existing roles.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

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
                  <TableHead>User / Identity</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  {isOwnerOrAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {member.profile.display_name || 'Anonymous User'}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-1 break-all max-w-xs">
                        {member.profile.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.role === 'OWNER' ? 'success' : member.role === 'ADMIN' ? 'info' : 'outline'}>
                        {member.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(member.created_at).toLocaleDateString()}
                    </TableCell>
                    {isOwnerOrAdmin && (
                      <TableCell className="text-right">
                        {member.role !== 'OWNER' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                            onClick={() => handleRemove(member.user_id)}
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
    </div>
  );
}
