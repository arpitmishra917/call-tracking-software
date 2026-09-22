'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface Campaign {
  id: string;
  name: string;
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  name: string | null;
  status: string;
  provider: string;
  campaign?: Campaign | null;
  campaign_id?: string | null;
}

interface AvailableNumber {
  phone_number: string;
  locality?: string;
  administrative_area?: string;
}

export default function PhoneNumbersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Assignment Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    if (workspaceId) {
      loadPhoneNumbers(workspaceId);
      loadCampaigns(workspaceId);
    }
  }, [workspaceId]);

  async function loadPhoneNumbers(id: string) {
    try {
      const data = await apiFetch(`/workspaces/${id}/phone-numbers`);
      setNumbers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadCampaigns(id: string) {
    try {
      const data = await apiFetch(`/workspaces/${id}/campaigns`);
      setCampaigns(data);
    } catch (e: unknown) {
      console.error('Failed to load campaigns', e);
    }
  }

  async function handleSearch() {
    if (!workspaceId) return;
    setIsSearching(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/phone-numbers/search?countryCode=US&limit=5`);
      setAvailableNumbers(data);
    } catch (e: unknown) {
      setError('Failed to search numbers: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleProvision(phoneNumber: string) {
    if (!workspaceId) return;
    setIsProvisioning(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      });
      setAvailableNumbers([]);
      await loadPhoneNumbers(workspaceId);
      setSuccess('Phone number provisioned successfully.');
    } catch (e: unknown) {
      setError('Failed to provision number: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsProvisioning(false);
    }
  }

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !selectedPhone || !selectedCampaignId) return;
    setIsAssigning(true);
    setError(null);
    setSuccess(null);
    
    try {
      await apiFetch(`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumberId: selectedPhone.id }),
      });
      
      setSuccess('Phone number assigned to campaign.');
      setAssignModalOpen(false);
      setSelectedPhone(null);
      setSelectedCampaignId('');
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError('Unable to assign this number to the campaign. ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsAssigning(false);
    }
  }

  function openAssignModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setSelectedCampaignId(phone.campaign_id || '');
    setAssignModalOpen(true);
  }

  if (!workspaceId) {
    return <div className="p-8 text-gray-500">Please select a workspace first.</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto relative">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Phone Numbers</h1>
      </div>

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

      <div className="bg-white rounded shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Your Numbers</h2>
        {numbers.length === 0 ? (
          <p className="text-gray-500">No phone numbers provisioned yet.</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 text-sm text-gray-600">Number</th>
                <th className="py-2 text-sm text-gray-600">Campaign</th>
                <th className="py-2 text-sm text-gray-600">Status</th>
                <th className="py-2 text-sm text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((num) => (
                <tr key={num.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="py-3 font-mono text-gray-800">{num.phone_number}</td>
                  <td className="py-3 text-gray-800">
                    {num.campaign ? (
                      <span className="font-medium text-blue-700">{num.campaign.name}</span>
                    ) : (
                      <span className="text-gray-400 italic">Not assigned</span>
                    )}
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${num.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {num.status}
                    </span>
                  </td>
                  <td className="py-3">
                    <button
                      onClick={() => openAssignModal(num)}
                      className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded transition-colors"
                    >
                      {num.campaign ? 'Change' : 'Assign'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Provision New Number</h2>
        <div className="mb-4">
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search US Numbers'}
          </button>
        </div>

        {availableNumbers.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold mb-3 text-gray-700">Available Numbers</h3>
            <ul className="space-y-3">
              {availableNumbers.map((num) => (
                <li key={num.phone_number} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <span className="font-mono text-lg font-medium text-gray-900">{num.phone_number}</span>
                    <div className="text-sm text-gray-500 mt-1">
                      {num.locality && num.administrative_area ? `${num.locality}, ${num.administrative_area}` : 'Toll-free / Unknown location'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleProvision(num.phone_number)}
                    disabled={isProvisioning}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {isProvisioning ? 'Provisioning...' : 'Provision'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {assignModalOpen && selectedPhone && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Assign to Campaign</h2>
            <form onSubmit={handleAssignSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <div className="font-mono bg-gray-50 p-2 rounded border border-gray-200">{selectedPhone.phone_number}</div>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="" disabled>Select Campaign ▼</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {campaigns.length === 0 && (
                  <p className="text-sm text-amber-600 mt-2">No campaigns found. Please create one first.</p>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning || !selectedCampaignId || campaigns.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                >
                  {isAssigning ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
