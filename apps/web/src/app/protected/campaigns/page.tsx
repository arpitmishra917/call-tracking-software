'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface Buyer {
  id: string;
  name: string;
  destination_number: string;
  timeout: number;
}

interface CampaignBuyer {
  priority: number;
  buyer: Buyer;
}

interface PhoneNumber {
  phone_number: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  phone_numbers?: PhoneNumber[];
  buyers?: CampaignBuyer[];
}

export default function CampaignsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availableBuyers, setAvailableBuyers] = useState<Buyer[]>([]);
  
  const [newCampaignName, setNewCampaignName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add Buyer Modal State
  const [addBuyerModalOpen, setAddBuyerModalOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [priority, setPriority] = useState<number>(1);
  const [isAddingBuyer, setIsAddingBuyer] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [cData, bData] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/campaigns`),
          apiFetch(`/workspaces/${workspaceId}/buyers`)
        ]);
        setCampaigns(cData);
        setAvailableBuyers(bData);
      } catch (e: unknown) {
        setError('Failed to load campaigns/buyers: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadData();
    }
  }, [workspaceId]);

  async function refreshCampaigns() {
    if (!workspaceId) return;
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
    setError(null);
    setSuccess(null);
    
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns`, {
        method: 'POST',
        body: JSON.stringify({ name: newCampaignName }),
      });
      setNewCampaignName('');
      setSuccess('Campaign created successfully.');
      refreshCampaigns();
    } catch (e: unknown) {
      setError('Failed to create campaign. ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleAddBuyerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !selectedCampaignId || !selectedBuyerId) return;
    setIsAddingBuyer(true);
    setError(null);
    setSuccess(null);

    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/buyers`, {
        method: 'POST',
        body: JSON.stringify({ buyerId: selectedBuyerId, priority }),
      });
      
      setSuccess('Buyer added to campaign.');
      setAddBuyerModalOpen(false);
      setSelectedBuyerId('');
      setPriority(1);
      refreshCampaigns();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Clean up common duplicate error message gracefully
      if (msg.includes('Unique constraint failed') || msg.includes('duplicate')) {
        setError('That priority is already used in this campaign or buyer is already assigned.');
      } else {
        setError('Unable to add buyer: ' + msg);
      }
    } finally {
      setIsAddingBuyer(false);
    }
  }

  function openAddBuyerModal(campaignId: string, currentBuyers: CampaignBuyer[] = []) {
    setSelectedCampaignId(campaignId);
    setSelectedBuyerId('');
    // Auto-suggest next priority
    const nextPriority = currentBuyers.length > 0 ? Math.max(...currentBuyers.map(b => b.priority)) + 1 : 1;
    setPriority(nextPriority);
    setAddBuyerModalOpen(true);
  }

  if (loading) return <div className="p-8">Loading campaigns...</div>;
  if (!workspaceId) return <div className="p-8 text-gray-500">Select a workspace first.</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Campaigns</h1>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-6">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded mb-6">
          {success}
        </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2 mb-8 bg-white p-4 rounded shadow border border-gray-100">
        <input 
          type="text" 
          value={newCampaignName} 
          onChange={e => setNewCampaignName(e.target.value)}
          placeholder="New Campaign Name" 
          className="border border-gray-300 p-2 rounded flex-1 focus:ring-blue-500 focus:border-blue-500"
          required
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition-colors">
          Create Campaign
        </button>
      </form>

      <div className="grid gap-6">
        {campaigns.map(c => (
          <div key={c.id} className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{c.name}</h2>
                <div className="text-sm text-gray-500 mt-1">Status: <span className="text-green-600 font-medium">{c.status}</span></div>
              </div>
            </div>
            
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Tracking Numbers Section */}
              <div>
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 border-b pb-2">Tracking Numbers</h3>
                {c.phone_numbers && c.phone_numbers.length > 0 ? (
                  <ul className="space-y-2 text-gray-800 font-mono">
                    {c.phone_numbers.map(pn => (
                      <li key={pn.phone_number} className="bg-gray-50 px-3 py-2 rounded border border-gray-100">{pn.phone_number}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-sm italic">No tracking numbers assigned.</p>
                )}
                <div className="mt-4 text-xs text-gray-500">
                  Assign numbers from the <a href={`/protected/phone-numbers?workspace=${workspaceId}`} className="text-blue-600 hover:underline">Phone Numbers</a> page.
                </div>
              </div>

              {/* Buyers Section */}
              <div>
                <div className="flex justify-between items-center mb-3 border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Buyers</h3>
                  <button 
                    onClick={() => openAddBuyerModal(c.id, c.buyers)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Add Buyer
                  </button>
                </div>
                
                {c.buyers && c.buyers.length > 0 ? (
                  <div className="space-y-3">
                    {/* Sort buyers by priority just in case backend didn't, though it should */}
                    {[...c.buyers].sort((a, b) => a.priority - b.priority).map(cb => (
                      <div key={cb.buyer.id} className="bg-gray-50 p-3 rounded border border-gray-200 flex items-start gap-3">
                        <div className="bg-blue-100 text-blue-800 font-bold rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-sm mt-0.5">
                          {cb.priority}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{cb.buyer.name}</div>
                          <div className="text-sm text-gray-600 font-mono mt-1">{cb.buyer.destination_number}</div>
                          <div className="text-xs text-gray-500 mt-1">Timeout: {cb.buyer.timeout}s</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm italic">No buyers assigned. Calls will fail.</p>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {campaigns.length === 0 && (
          <div className="text-center p-8 bg-gray-50 border border-gray-200 rounded text-gray-500">
            No campaigns found. Create one above.
          </div>
        )}
      </div>

      {addBuyerModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Buyer to Campaign</h2>
            <form onSubmit={handleAddBuyerSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Buyer</label>
                <select
                  value={selectedBuyerId}
                  onChange={(e) => setSelectedBuyerId(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="" disabled>Select Buyer ▼</option>
                  {availableBuyers.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.destination_number})</option>
                  ))}
                </select>
                {availableBuyers.length === 0 && (
                  <p className="text-sm text-amber-600 mt-2">No buyers found in this workspace.</p>
                )}
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority (1 = Highest)</label>
                <input
                  type="number"
                  min="1"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded p-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAddBuyerModalOpen(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingBuyer || !selectedBuyerId || availableBuyers.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                >
                  {isAddingBuyer ? 'Adding...' : 'Add Buyer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
