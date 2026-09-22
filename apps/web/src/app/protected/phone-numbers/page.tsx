'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface PhoneNumber {
  id: string;
  phone_number: string;
  name: string | null;
  status: string;
  provider: string;
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
  const [isSearching, setIsSearching] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      loadPhoneNumbers(workspaceId);
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

  async function handleSearch() {
    if (!workspaceId) return;
    setIsSearching(true);
    setError(null);
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
    try {
      await apiFetch(`/workspaces/${workspaceId}/phone-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      });
      setAvailableNumbers([]);
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError('Failed to provision number: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsProvisioning(false);
    }
  }

  if (!workspaceId) {
    return <div className="p-8 text-gray-500">Please select a workspace first.</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Phone Numbers</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-6">
          {error}
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
                <th className="py-2 text-sm text-gray-600">Name</th>
                <th className="py-2 text-sm text-gray-600">Status</th>
                <th className="py-2 text-sm text-gray-600">Provider</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((num) => (
                <tr key={num.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 font-mono text-gray-800">{num.phone_number}</td>
                  <td className="py-3 text-gray-800">{num.name || '-'}</td>
                  <td className="py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${num.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {num.status}
                    </span>
                  </td>
                  <td className="py-3 capitalize text-gray-600">{num.provider}</td>
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
    </div>
  );
}
