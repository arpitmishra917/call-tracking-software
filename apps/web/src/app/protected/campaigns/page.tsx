'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface CampaignBuyer {
  priority: number;
  buyer: {
    name: string;
  };
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  phone_numbers?: unknown[];
  buyers?: CampaignBuyer[];
}

export default function CampaignsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCampaigns() {
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/campaigns`);
        setCampaigns(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadCampaigns();
    }
  }, [workspaceId]);

  async function refreshCampaigns() {
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/campaigns`);
      setCampaigns(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns`, {
        method: 'POST',
        body: JSON.stringify({ name: newCampaignName }),
      });
      setNewCampaignName('');
      refreshCampaigns();
    } catch {
      alert('Failed to create campaign');
    }
  }

  if (loading) return <div>Loading campaigns...</div>;
  if (!workspaceId) return <div>Select a workspace first.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Campaigns</h1>
      
      <form onSubmit={handleCreate} className="flex gap-2">
        <input 
          type="text" 
          value={newCampaignName} 
          onChange={e => setNewCampaignName(e.target.value)}
          placeholder="New Campaign Name" 
          className="border p-2 rounded"
          required
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">Create Campaign</button>
      </form>

      <div className="grid gap-4">
        {campaigns.map(c => (
          <div key={c.id} className="border p-4 rounded bg-white shadow-sm">
            <h2 className="font-bold">{c.name}</h2>
            <div className="text-sm text-gray-500">Status: {c.status}</div>
            <div className="mt-2 text-sm text-gray-700">
              Tracking Numbers: {c.phone_numbers?.length || 0}
            </div>
            <div className="mt-1 text-sm text-gray-700">
              Buyers: {c.buyers?.map((b: CampaignBuyer) => `${b.buyer.name} (P${b.priority})`).join(', ') || 'None'}
            </div>
          </div>
        ))}
        {campaigns.length === 0 && <div>No campaigns found.</div>}
      </div>
    </div>
  );
}
