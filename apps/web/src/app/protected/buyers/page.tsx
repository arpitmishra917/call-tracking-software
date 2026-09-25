'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBuyers() {
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/buyers`);
        setBuyers(data);
      } catch (e) {
        console.error(e);
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
      setBuyers(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    try {
      await apiFetch(`/workspaces/${workspaceId}/buyers`, {
        method: 'POST',
        body: JSON.stringify({ name, destinationNumber: destination, timeout }),
      });
      setName('');
      setDestination('');
      refreshBuyers();
      setError(null);
    } catch (err: unknown) {
      setError(`Failed to create buyer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (loading) return <div>Loading buyers...</div>;
  if (!workspaceId) return <div>Select a workspace first.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Buyers</h1>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded shadow-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2 items-center flex-wrap">
        <input 
          type="text" 
          value={name} 
          onChange={e => setName(e.target.value)}
          placeholder="Buyer Name" 
          className="border p-2 rounded"
          required
        />
        <input 
          type="text" 
          value={destination} 
          onChange={e => setDestination(e.target.value)}
          placeholder="Destination (e.g. 555-0100)" 
          className="border p-2 rounded"
          required
        />
        <input 
          type="number" 
          value={timeout} 
          onChange={e => setTimeoutVal(Number(e.target.value))}
          placeholder="Timeout (s)" 
          className="border p-2 rounded w-32"
          required
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">Add Buyer</button>
      </form>

      <div className="grid gap-4">
        {buyers.map(b => (
          <div key={b.id} className="border p-4 rounded bg-white shadow-sm flex justify-between">
            <div>
              <h2 className="font-bold">{b.name}</h2>
              <div className="text-sm text-gray-600">{b.destination_number}</div>
            </div>
            <div className="text-sm text-gray-500 text-right">
              <div>Status: {b.status}</div>
              <div>Timeout: {b.timeout}s</div>
            </div>
          </div>
        ))}
        {buyers.length === 0 && <div>No buyers found.</div>}
      </div>
    </div>
  );
}
