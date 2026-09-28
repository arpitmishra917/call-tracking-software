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
import { EmptyState } from '@/components/ui/empty-state';
import { ShieldBan, Phone } from 'lucide-react';

interface BlockedCaller {
  id: string;
  phone_number: string;
  reason: string | null;
  created_at: string;
}

export default function BlockedCallersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [callers, setCallers] = useState<BlockedCaller[]>([]);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newReason, setNewReason] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCallers = useCallback(async (id: string) => {
    setIsFetching(true);
    try {
      const data = await apiFetch(`/workspaces/${id}/blocked-callers`);
      setCallers(data?.items || data || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCallers(workspaceId);
    } else {
      setTimeout(() => setIsFetching(false), 0);
    }
  }, [workspaceId, loadCallers]);

  async function handleBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !newPhoneNumber.trim()) return;
    setIsAdding(true);
    setError(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/blocked-callers`, {
        method: 'POST',
        body: JSON.stringify({ 
          phoneNumber: newPhoneNumber.trim(),
          reason: newReason.trim() || undefined
        }),
      });
      setNewPhoneNumber('');
      setNewReason('');
      await loadCallers(workspaceId);
    } catch (e: unknown) {
      setError('Failed to block caller: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAdding(false);
    }
  }

  const [unblockId, setUnblockId] = useState<string | null>(null);
  const [isUnblocking, setIsUnblocking] = useState(false);

  async function handleUnblock() {
    if (!workspaceId || !unblockId) return;
    
    setIsUnblocking(true);
    try {
      await apiFetch(`/workspaces/${workspaceId}/blocked-callers/${unblockId}`, {
        method: 'DELETE',
      });
      await loadCallers(workspaceId);
      setUnblockId(null);
    } catch (e: unknown) {
      setError('Failed to unblock caller: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsUnblocking(false);
    }
  }

  if (isFetching && callers.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Loading blocked callers...
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
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Blocked Callers</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl">
            Blocked callers are prevented from entering campaign routing.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Block a Caller</CardTitle>
            <CardDescription>Add a new number to your blocked list.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBlock} className="flex flex-col md:flex-row items-end gap-4 max-w-3xl">
              <div className="space-y-2 flex-1 w-full min-w-[240px]">
                <Label htmlFor="phoneNumber">Phone Number</Label>
                <Input
                  type="text"
                  id="phoneNumber"
                  value={newPhoneNumber}
                  onChange={(e) => setNewPhoneNumber(e.target.value)}
                  placeholder="+14155551234"
                  disabled={isAdding}
                />
                <p className="text-xs text-muted-foreground">E.164 format required.</p>
              </div>
              <div className="space-y-2 flex-1 w-full min-w-[240px]">
                <Label htmlFor="reason">Reason (Optional)</Label>
                <Input
                  type="text"
                  id="reason"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  placeholder="e.g., Spam, Harassment"
                  disabled={isAdding}
                />
                <p className="text-xs text-transparent select-none">Spacer</p>
              </div>
              <Button
                type="submit"
                disabled={isAdding || !newPhoneNumber.trim()}
                className="w-full md:w-auto mb-6"
              >
                {isAdding ? 'Blocking...' : 'Block Caller'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Blocked Callers List</CardTitle>
            <CardDescription>All currently blocked numbers for this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {callers.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={<ShieldBan />}
                  title="No blocked callers"
                  description="Blocked phone numbers will appear here."
                />
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="min-w-[150px]">Phone Number</TableHead>
                    <TableHead className="min-w-[150px]">Reason</TableHead>
                    <TableHead className="min-w-[120px]">Blocked Date</TableHead>
                    <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {callers.map((caller) => (
                    <TableRow key={caller.id}>
                      <TableCell className="font-mono text-sm max-w-[200px] break-all text-foreground">
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span>{caller.phone_number}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">
                        {caller.reason || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(caller.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                          onClick={() => setUnblockId(caller.id)}
                        >
                          Unblock
                        </Button>
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
        open={!!unblockId}
        onOpenChange={(open) => !open && setUnblockId(null)}
        title="Unblock Caller"
        description="Are you sure you want to unblock this caller? They will be able to reach your routing system again."
        onConfirm={handleUnblock}
        isLoading={isUnblocking}
        confirmText="Unblock"
      />
    </div>
  );
}
