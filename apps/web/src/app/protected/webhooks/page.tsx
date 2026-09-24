'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type Webhook = {
  id: string;
  url: string;
  status: string;
  created_at: string;
};

export default function WebhooksPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [newUrl, setNewUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/webhooks`);
      setWebhooks(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (!ignore) {
        fetchWebhooks();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchWebhooks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !newUrl.trim()) return;

    try {
      setIsCreating(true);
      setError(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({ url: newUrl.trim() }),
      });
      setNewSecret(data.secret);
      setNewUrl('');
      await fetchWebhooks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/webhooks/${id}`, {
        method: 'DELETE',
      });
      setNewSecret(null); // Clear secret if they delete
      await fetchWebhooks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    }
  };

  if (!workspaceId) {
    return <div className="p-4 text-gray-500">Please select a workspace first.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Webhooks</h1>
        <p className="text-gray-600 mt-1">
          Manage endpoints for receiving real-time call and attempt events. 
          <br/>
          <span className="text-sm font-semibold">Note: The backend currently does not support editing URLs, disabling endpoints, or viewing delivery history.</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {newSecret && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-md border border-green-200">
          <p className="font-bold mb-2">Webhook Created Successfully!</p>
          <p className="mb-2">Please copy your signing secret now. It will <strong>never</strong> be shown again.</p>
          <code className="block p-3 bg-white border border-green-200 rounded font-mono text-sm break-all">
            {newSecret}
          </code>
          <button 
            onClick={() => setNewSecret(null)}
            className="mt-3 text-sm text-green-800 hover:underline"
          >
            I have copied it, dismiss this message
          </button>
        </div>
      )}

      <div className="bg-white shadow rounded-lg border border-gray-200 mb-8 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Add Webhook Endpoint</h2>
        <form onSubmit={handleCreate} className="flex gap-4 items-end">
          <div className="flex-1">
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
              Endpoint URL
            </label>
            <input
              type="url"
              id="url"
              required
              placeholder="https://your-server.com/webhook"
              className="w-full rounded-md border-gray-300 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 border"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={isCreating}
            />
          </div>
          <button
            type="submit"
            disabled={isCreating || !newUrl.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium text-sm transition-colors disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create Webhook'}
          </button>
        </form>
      </div>

      <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Active Endpoints</h2>
        </div>
        
        {loading ? (
          <div className="p-6 text-gray-500 text-center">Loading webhooks...</div>
        ) : webhooks.length === 0 ? (
          <div className="p-6 text-gray-500 text-center">No webhooks configured.</div>
        ) : (
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-6 py-3 font-medium">URL</th>
                <th className="px-6 py-3 font-medium w-32">Status</th>
                <th className="px-6 py-3 font-medium w-48">Created</th>
                <th className="px-6 py-3 font-medium w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {webhooks.map((wh) => (
                <tr key={wh.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono text-xs break-all">{wh.url}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      {wh.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(wh.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDelete(wh.id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
