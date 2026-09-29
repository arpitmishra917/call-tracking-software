'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

type WorkspaceInfo = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
};

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [statusSaving, setStatusSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'SUSPEND' | 'ARCHIVE' | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const fetchWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const workspaces = await apiFetch('/workspaces');
      const ws = workspaces.find((w: { id: string; role: string }) => w.id === workspaceId);
      setUserRole(ws?.role || null);

      const data = await apiFetch(`/workspaces/${workspaceId}`);
      setWorkspaceInfo(data);
      setNameInput(data.name || '');
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace settings');
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
        fetchWorkspace();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchWorkspace]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !nameInput.trim()) return;

    try {
      setIsSaving(true);
      setError(null);
      setSuccessMsg(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      setWorkspaceInfo(data);
      setSuccessMsg('Workspace settings updated successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') => {
    if (!workspaceId) return;
    try {
      setStatusSaving(true);
      setError(null);
      setSuccessMsg(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setWorkspaceInfo(data);
      setConfirmAction(null);
      setConfirmName('');
      setSuccessMsg(`Workspace status updated to ${newStatus}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace status');
    } finally {
      setStatusSaving(false);
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
    <div className="flex flex-col gap-8 pb-8 max-w-4xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Workspace Settings</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Manage your workspace profile.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-green-50 text-green-700 rounded-md border border-green-200 text-sm">
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading settings...</div>
      ) : workspaceInfo ? (
        <div className="grid grid-cols-1 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Workspace Information</CardTitle>
              <CardDescription>Update your workspace display name.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="name">Workspace Name</Label>
                  <Input
                    type="text"
                    id="name"
                    required
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    disabled={!isOwnerOrAdmin || isSaving}
                  />
                  {!isOwnerOrAdmin && (
                    <p className="text-sm text-muted-foreground">
                      You must be an OWNER or ADMIN to change the workspace name.
                    </p>
                  )}
                </div>

                {isOwnerOrAdmin && (
                  <Button
                    type="submit"
                    disabled={isSaving || !nameInput.trim() || nameInput.trim() === workspaceInfo.name}
                    className="w-full sm:w-auto self-start mt-2"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Read-Only Metadata</CardTitle>
              <CardDescription>Internal details about this workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 text-sm">
                <div className="space-y-1">
                  <dt className="font-medium text-foreground">Workspace ID</dt>
                  <dd className="font-mono text-muted-foreground text-xs">{workspaceInfo.id}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="font-medium text-foreground">Slug</dt>
                  <dd className="font-mono text-muted-foreground text-xs">{workspaceInfo.slug}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="font-medium text-foreground">Status</dt>
                  <dd>
                    <Badge variant={workspaceInfo.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {workspaceInfo.status}
                    </Badge>
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="font-medium text-foreground">Created At</dt>
                  <dd className="text-muted-foreground">{new Date(workspaceInfo.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workspace Status</CardTitle>
              <CardDescription>Manage the lifecycle of your workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              {workspaceInfo.status === 'ACTIVE' ? (
                <div className="flex gap-4">
                  <Button variant="outline" onClick={() => setConfirmAction('SUSPEND')} disabled={!isOwnerOrAdmin || statusSaving}>
                    Suspend
                  </Button>
                  <Button variant="destructive" onClick={() => setConfirmAction('ARCHIVE')} disabled={!isOwnerOrAdmin || statusSaving}>
                    Archive
                  </Button>
                </div>
              ) : (
                <Button onClick={() => handleStatusChange('ACTIVE')} disabled={!isOwnerOrAdmin || statusSaving}>
                  Restore
                </Button>
              )}

              {confirmAction && (
                <div className="mt-4 p-4 border rounded-md border-destructive/50 bg-destructive/5">
                  <h4 className="font-medium text-destructive mb-2">
                    Confirm {confirmAction === 'SUSPEND' ? 'Suspension' : 'Archival'}
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Type <strong>{workspaceInfo.name}</strong> to confirm you want to {confirmAction.toLowerCase()} this workspace.
                  </p>
                  <div className="flex gap-2 max-w-sm">
                    <Input 
                      value={confirmName} 
                      onChange={(e) => setConfirmName(e.target.value)} 
                      placeholder={workspaceInfo.name}
                      disabled={statusSaving}
                    />
                    <Button 
                      variant="destructive" 
                      onClick={() => handleStatusChange(confirmAction === 'SUSPEND' ? 'SUSPENDED' : 'ARCHIVED')}
                      disabled={confirmName !== workspaceInfo.name || statusSaving}
                    >
                      {statusSaving ? 'Saving...' : 'Confirm'}
                    </Button>
                    <Button variant="outline" onClick={() => { setConfirmAction(null); setConfirmName(''); }} disabled={statusSaving}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="p-8 text-center text-muted-foreground">Workspace not found.</div>
      )}
    </div>
  );
}
