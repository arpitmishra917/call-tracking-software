'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Copy, AlertTriangle, KeyRound } from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function ApiKeysPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newRawSecret, setNewRawSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workspaceId) {
      loadKeys(workspaceId);
    } else {
      setTimeout(() => setLoading(false), 0);
    }
  }, [workspaceId]);

  async function loadKeys(id: string) {
    try {
      setLoading(true);
      const data = await apiFetch(`/workspaces/${id}/api-keys`);
      setKeys(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !newKeyName.trim()) return;
    setIsCreating(true);
    setError(null);
    setNewRawSecret(null);
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      setNewRawSecret(data.rawSecret);
      setNewKeyName('');
      await loadKeys(workspaceId);
    } catch (e: unknown) {
      setError('Failed to create key: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsCreating(false);
    }
  }

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  async function handleRevoke() {
    if (!workspaceId || !revokeId) return;
    
    setIsRevoking(true);
    try {
      await apiFetch(`/workspaces/${workspaceId}/api-keys/${revokeId}`, {
        method: 'DELETE',
      });
      await loadKeys(workspaceId);
      setRevokeId(null);
    } catch (e: unknown) {
      setError('Failed to revoke key: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsRevoking(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Loading API keys...
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Select a workspace first.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8 max-w-5xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">API Keys</h1>
          <p className="text-muted-foreground mt-2">
            Manage developer access to your CallFlow resources.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {newRawSecret && (
        <Card className="border-warning/50 bg-warning/5 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-warning/20 rounded-full shrink-0">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground mb-1">API Key Created</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Please copy this API key and store it somewhere safe. For security reasons, <strong>we will never show it to you again</strong>.
                </p>
                <div className="flex items-center justify-between gap-4 bg-background border rounded-md p-3 max-w-xl">
                  <code className="text-sm font-mono break-all text-foreground select-all">
                    {newRawSecret}
                  </code>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="shrink-0"
                    onClick={() => navigator.clipboard.writeText(newRawSecret)}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Create API Key</CardTitle>
            <CardDescription>Generate a new API key to authenticate requests.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col sm:flex-row items-end gap-4 max-w-xl">
              <div className="space-y-2 flex-1 w-full">
                <Label htmlFor="keyName">Key Name</Label>
                <Input
                  type="text"
                  id="keyName"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. Production Backend"
                  disabled={isCreating}
                />
              </div>
              <Button
                type="submit"
                disabled={isCreating || !newKeyName.trim()}
                className="w-full sm:w-auto"
              >
                {isCreating ? 'Creating...' : 'Create Key'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Keys</CardTitle>
            <CardDescription>All API keys associated with this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {keys.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={<KeyRound />}
                  title="No API keys yet"
                  description="Create an API key to connect your application to CallFlow."
                />
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="min-w-[150px]">Name</TableHead>
                    <TableHead className="min-w-[150px]">Key Prefix</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Created</TableHead>
                    <TableHead className="min-w-[120px]">Last Used</TableHead>
                    <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{key.key_prefix}...</TableCell>
                      <TableCell>
                        {key.revoked_at ? (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Revoked</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{new Date(key.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        {!key.revoked_at && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                            onClick={() => setRevokeId(key.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(open) => !open && setRevokeId(null)}
        title="Revoke API Key"
        description="Are you sure you want to revoke this API key? This action cannot be undone and any integrations using this key will immediately stop working."
        onConfirm={handleRevoke}
        isLoading={isRevoking}
        confirmText="Revoke Key"
      />
    </div>
  );
}
