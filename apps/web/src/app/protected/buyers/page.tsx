'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface Buyer {
  id: string;
  name: string;
  destination_number: string;
  status: string;
  timeout: number;
}

export default function BuyersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [timeout, setTimeoutVal] = useState(30);
  
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal states
  const [editingBuyer, setEditingBuyer] = useState<Buyer | null>(null);
  const [editName, setEditName] = useState('');
  const [editDestination, setEditDestination] = useState('');
  const [editTimeout, setEditTimeout] = useState(30);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const [deactivatingBuyer, setDeactivatingBuyer] = useState<Buyer | null>(null);
  const [isSubmittingDeactivate, setIsSubmittingDeactivate] = useState(false);

  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    async function loadBuyers() {
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/buyers`);
        setBuyers(data?.items || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load buyers.');
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadBuyers();
    }
  }, [workspaceId]);

  async function refreshBuyers() {
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/buyers`);
      setBuyers(data?.items || []);
    } catch (e) {
      console.error(e);
    }
  }

  function openEditModal(buyer: Buyer) {
    setEditingBuyer(buyer);
    setEditName(buyer.name);
    setEditDestination(buyer.destination_number);
    setEditTimeout(buyer.timeout);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !editingBuyer) return;
    setIsSubmittingEdit(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${editingBuyer.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName, destinationNumber: editDestination, timeout: editTimeout }),
      });
      setSuccess('Buyer updated successfully.');
      setEditingBuyer(null);
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to update buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  async function handleActivate(id: string) {
    if (!workspaceId) return;
    setActivatingId(id);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${id}/activate`, {
        method: 'POST',
      });
      setSuccess('Buyer activated successfully.');
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to activate buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActivatingId(null);
    }
  }

  async function handleDeactivateSubmit() {
    if (!workspaceId || !deactivatingBuyer) return;
    setIsSubmittingDeactivate(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers/${deactivatingBuyer.id}/archive`, {
        method: 'POST',
      });
      setSuccess('Buyer deactivated successfully.');
      setDeactivatingBuyer(null);
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to deactivate buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmittingDeactivate(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setIsCreating(true);
    setError(null);
    setSuccess(null);
    
    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers`, {
        method: 'POST',
        body: JSON.stringify({ name, destinationNumber: destination, timeout }),
      });
      setName('');
      setDestination('');
      setTimeoutVal(30);
      setSuccess('Buyer created successfully.');
      refreshBuyers();
    } catch (err: unknown) {
      setError(`Failed to create buyer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCreating(false);
    }
  }

  if (loading) return <div className="p-8 flex items-center justify-center text-muted-foreground">Loading buyers...</div>;
  if (!workspaceId) return <div className="p-8 flex items-center justify-center text-muted-foreground">Select a workspace first.</div>;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-8 w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Buyers</h1>
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
          <CardTitle>Add New Buyer</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-4 items-end flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label htmlFor="buyerName">Buyer Name</Label>
              <Input 
                id="buyerName"
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Acme Corp" 
                required
              />
            </div>
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label htmlFor="destination">Destination Number</Label>
              <Input 
                id="destination"
                type="text" 
                value={destination} 
                onChange={e => setDestination(e.target.value)}
                placeholder="e.g. +1234567890" 
                required
              />
            </div>
            <div className="w-[120px] space-y-1.5">
              <Label htmlFor="timeout">Timeout (s)</Label>
              <Input 
                id="timeout"
                type="number" 
                value={timeout} 
                onChange={e => setTimeoutVal(Number(e.target.value))}
                min="1"
                required
              />
            </div>
            <Button type="submit" isLoading={isCreating}>
              Add Buyer
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {buyers.length === 0 ? (
          <EmptyState
            title="No buyers found"
            description="Add a buyer destination to start receiving calls."
          />
        ) : (
          <Card className="overflow-hidden border-border shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="min-w-[150px]">Buyer</TableHead>
                  <TableHead className="min-w-[150px]">Destination</TableHead>
                  <TableHead className="min-w-[100px]">Timeout</TableHead>
                  <TableHead className="text-right min-w-[100px]">Status</TableHead>
                  <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium text-foreground">
                      {b.name}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {b.destination_number}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.timeout}s
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={b.status === 'ACTIVE' ? 'success' : b.status === 'INACTIVE' ? 'warning' : 'default'}>
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Link href={`/protected/buyers/${b.id}?workspace=${workspaceId}`} className="text-sm font-medium text-primary hover:underline">
                        View Details
                      </Link>
                      <button 
                        onClick={() => openEditModal(b)} 
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Edit
                      </button>
                      {b.status !== 'ACTIVE' && (
                        <button 
                          onClick={() => handleActivate(b.id)} 
                          className="text-sm font-medium text-success hover:underline disabled:opacity-50"
                          disabled={activatingId === b.id}
                        >
                          {activatingId === b.id ? 'Activating...' : 'Activate'}
                        </button>
                      )}
                      {b.status === 'ACTIVE' && (
                        <button 
                          onClick={() => setDeactivatingBuyer(b)} 
                          className="text-sm font-medium text-error hover:underline"
                        >
                          Deactivate
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Edit Modal */}
      {editingBuyer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md bg-background">
            <CardHeader>
              <CardTitle>Edit Buyer</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="editName">Buyer Name</Label>
                  <Input 
                    id="editName"
                    type="text" 
                    value={editName} 
                    onChange={e => setEditName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="editDestination">Destination Number</Label>
                  <Input 
                    id="editDestination"
                    type="text" 
                    value={editDestination} 
                    onChange={e => setEditDestination(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="editTimeout">Timeout (s)</Label>
                  <Input 
                    id="editTimeout"
                    type="number" 
                    value={editTimeout} 
                    onChange={e => setEditTimeout(Number(e.target.value))}
                    min="1"
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button type="button" variant="outline" onClick={() => setEditingBuyer(null)} disabled={isSubmittingEdit}>
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={isSubmittingEdit}>
                    Save Changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Deactivate Modal */}
      {deactivatingBuyer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm bg-background">
            <CardHeader>
              <CardTitle>Deactivate Buyer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-6 text-sm text-muted-foreground">
                Are you sure you want to deactivate <strong>{deactivatingBuyer.name}</strong>? This will archive the buyer and they will no longer receive calls.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDeactivatingBuyer(null)} disabled={isSubmittingDeactivate}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={handleDeactivateSubmit} isLoading={isSubmittingDeactivate}>
                  Deactivate
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
