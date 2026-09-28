'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Webhook as WebhookIcon, Copy, AlertTriangle, Link } from 'lucide-react';

type Webhook = {
  id: string;
  url: string;
  status: string;
  created_at: string;
};

export default function WebhooksPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [newUrl, setNewUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/webhooks`);
      setWebhooks(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (!ignore) {
        fetchWebhooks();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchWebhooks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !newUrl.trim()) return;

    try {
      setIsCreating(true);
      setError(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({ url: newUrl.trim() }),
      });
      setNewSecret(data.secret);
      setNewUrl('');
      await fetchWebhooks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!workspaceId || !deleteId) return;
    
    setIsDeleting(true);
    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/webhooks/${deleteId}`, {
        method: 'DELETE',
      });
      setNewSecret(null); // Clear secret if they delete
      await fetchWebhooks();
      setDeleteId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Loading webhooks...
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
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Webhooks</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl">
            Manage endpoints for receiving real-time call and attempt events. 
            The current platform provides event streaming but does not support manual editing or viewing delivery history.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {newSecret && (
        <Card className="border-warning/50 bg-warning/5 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-warning/20 rounded-full shrink-0">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground mb-1">Webhook Created</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Please copy your signing secret now. You will need it to verify payload signatures. 
                  <strong> It will never be shown again.</strong>
                </p>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-background border rounded-md p-3 max-w-xl">
                  <code className="text-sm font-mono break-all text-foreground select-all">
                    {newSecret}
                  </code>
                  <div className="flex gap-2 shrink-0">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(newSecret)}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setNewSecret(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Add Webhook Endpoint</CardTitle>
            <CardDescription>Register a new URL to receive HTTP POST payloads.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col sm:flex-row items-end gap-4 max-w-xl">
              <div className="space-y-2 flex-1 w-full">
                <Label htmlFor="url">Endpoint URL</Label>
                <Input
                  type="url"
                  id="url"
                  required
                  placeholder="https://your-server.com/webhook"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  disabled={isCreating}
                />
              </div>
              <Button
                type="submit"
                disabled={isCreating || !newUrl.trim()}
                className="w-full sm:w-auto"
              >
                {isCreating ? 'Creating...' : 'Create Webhook'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Endpoints</CardTitle>
            <CardDescription>Configured webhooks for this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {webhooks.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={<WebhookIcon />}
                  title="No webhooks yet"
                  description="Connect CallFlow to your application by creating your first webhook endpoint."
                />
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="min-w-[200px]">Endpoint URL</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Created</TableHead>
                    <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhooks.map((wh) => (
                    <TableRow key={wh.id}>
                      <TableCell className="font-mono text-xs max-w-[200px] md:max-w-md break-all truncate text-foreground">
                        <div className="flex items-center gap-2">
                          <Link className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{wh.url}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 capitalize">
                          {wh.status.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(wh.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                            onClick={() => setDeleteId(wh.id)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>`n`n      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Webhook"
        description="Are you sure you want to delete this webhook? It will no longer receive any events."
        onConfirm={handleDelete}
        isLoading={isDeleting}
        confirmText="Delete"
      />
    </div>
  );
}

