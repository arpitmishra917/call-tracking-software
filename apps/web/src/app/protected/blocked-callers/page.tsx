'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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

  useEffect(() => {
    if (workspaceId) {
      loadCallers(workspaceId);
    }
  }, [workspaceId]);

  async function loadCallers(id: string) {
    setIsFetching(true);
    try {
      const data = await apiFetch(`/workspaces/${id}/blocked-callers`);
      setCallers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsFetching(false);
    }
  }

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

  async function handleUnblock(id: string) {
    if (!workspaceId) return;
    if (!confirm('Unblock this caller?')) return;
    
    try {
      await apiFetch(`/workspaces/${workspaceId}/blocked-callers/${id}`, {
        method: 'DELETE',
      });
      await loadCallers(workspaceId);
    } catch (e: unknown) {
      setError('Failed to unblock caller: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (!workspaceId) {
    return <div className="p-8 text-gray-500">Please select a workspace first.</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Blocked Callers</h1>
          <p className="text-gray-600 mt-1">Blocked callers are prevented from entering campaign routing.</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Block a Caller</h2>
        <form onSubmit={handleBlock} className="flex gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              type="text"
              id="phoneNumber"
              value={newPhoneNumber}
              onChange={(e) => setNewPhoneNumber(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="+14155551234"
              disabled={isAdding}
            />
            <p className="text-xs text-gray-500 mt-1">Enter the number in E.164 format, for example +14155551234.</p>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
              Reason (Optional)
            </label>
            <input
              type="text"
              id="reason"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="Spam, harassment, etc."
              disabled={isAdding}
            />
          </div>
          <button
            type="submit"
            disabled={isAdding || !newPhoneNumber.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors h-[42px] mb-6"
          >
            {isAdding ? 'Blocking...' : 'Block Caller'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Blocked Callers List</h2>
        
        {isFetching && callers.length === 0 ? (
          <p className="text-gray-500">Loading blocked callers...</p>
        ) : callers.length === 0 ? (
          <p className="text-gray-500">No blocked callers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 text-sm text-gray-600">Phone Number</th>
                  <th className="py-2 text-sm text-gray-600">Reason</th>
                  <th className="py-2 text-sm text-gray-600">Blocked On</th>
                  <th className="py-2 text-sm text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {callers.map((caller) => (
                  <tr key={caller.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 text-gray-900 font-medium font-mono">{caller.phone_number}</td>
                    <td className="py-3 text-gray-600">{caller.reason || '-'}</td>
                    <td className="py-3 text-gray-500 text-sm">
                      {new Date(caller.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handleUnblock(caller.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
