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

  useEffect(() => {
    async function loadBuyers() {
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/buyers`);
        setBuyers(data?.items || data || []);
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
      setBuyers(data?.items || data || []);
    } catch (e) {
      console.error(e);
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
                    <TableCell className="text-right">
                      <Link href={`/protected/buyers/${b.id}?workspace=${workspaceId}`} className="text-sm font-medium text-primary hover:underline">
                        View Details
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
