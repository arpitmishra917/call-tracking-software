'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function ApiKeysPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newRawSecret, setNewRawSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      loadKeys(workspaceId);
    }
  }, [workspaceId]);

  async function loadKeys(id: string) {
    try {
      const data = await apiFetch(`/workspaces/${id}/api-keys`);
      setKeys(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !newKeyName.trim()) return;
    setIsCreating(true);
    setError(null);
    setNewRawSecret(null);
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      setNewRawSecret(data.rawSecret);
      setNewKeyName('');
      await loadKeys(workspaceId);
    } catch (e: unknown) {
      setError('Failed to create key: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) return;
    
    try {
      await apiFetch(`/workspaces/${workspaceId}/api-keys/${id}`, {
        method: 'DELETE',
      });
      await loadKeys(workspaceId);
    } catch (e: unknown) {
      setError('Failed to revoke key: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (!workspaceId) {
    return <div className="p-8 text-gray-500">Please select a workspace first.</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">API Keys</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-6">
          {error}
        </div>
      )}

      {newRawSecret && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-6 rounded-lg mb-8 shadow-sm">
          <h3 className="text-lg font-bold mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            Save your API key
          </h3>
          <p className="mb-4 text-sm">Please copy this API key and store it somewhere safe. For security reasons, <strong>we will never show it to you again</strong>.</p>
          <div className="bg-white p-3 rounded border font-mono text-sm break-all flex justify-between items-center">
            <code>{newRawSecret}</code>
            <button 
              onClick={() => navigator.clipboard.writeText(newRawSecret)}
              className="ml-4 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Create New API Key</h2>
        <form onSubmit={handleCreate} className="flex gap-4 items-end">
          <div className="flex-1">
            <label htmlFor="keyName" className="block text-sm font-medium text-gray-700 mb-1">
              Key Name
            </label>
            <input
              type="text"
              id="keyName"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Production Backend"
              disabled={isCreating}
            />
          </div>
          <button
            type="submit"
            disabled={isCreating || !newKeyName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isCreating ? 'Creating...' : 'Create Key'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Your API Keys</h2>
        {keys.length === 0 ? (
          <p className="text-gray-500">No API keys created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 text-sm text-gray-600">Name</th>
                  <th className="py-2 text-sm text-gray-600">Key Prefix</th>
                  <th className="py-2 text-sm text-gray-600">Status</th>
                  <th className="py-2 text-sm text-gray-600">Created At</th>
                  <th className="py-2 text-sm text-gray-600">Last Used</th>
                  <th className="py-2 text-sm text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 text-gray-900 font-medium">{key.name}</td>
                    <td className="py-3 font-mono text-gray-600">{key.key_prefix}...</td>
                    <td className="py-3">
                      {key.revoked_at ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                          Revoked
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-gray-500 text-sm">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-gray-500 text-sm">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-3 text-right">
                      {!key.revoked_at && (
                        <button
                          onClick={() => handleRevoke(key.id)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          Revoke
                        </button>
                      )}
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
