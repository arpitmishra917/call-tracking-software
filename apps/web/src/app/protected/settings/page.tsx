'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type WorkspaceInfo = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
};

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    try {
      // Find out current user's role in this workspace
      const workspaces = await apiFetch('/workspaces');
      const ws = workspaces.find((w: { id: string; role: string }) => w.id === workspaceId);
      setUserRole(ws?.role || null);

      const data = await apiFetch(`/workspaces/${workspaceId}`);
      setWorkspaceInfo(data);
      setNameInput(data.name || '');
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace settings');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (!ignore) {
        setLoading(true);
        fetchWorkspace();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchWorkspace]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !nameInput.trim()) return;

    try {
      setIsSaving(true);
      setError(null);
      setSuccessMsg(null);
      const data = await apiFetch(`/workspaces/${workspaceId}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      setWorkspaceInfo(data);
      setSuccessMsg('Workspace settings updated successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (!workspaceId) {
    return <div className="p-4 text-gray-500">Please select a workspace first.</div>;
  }

  const isOwnerOrAdmin = userRole === 'OWNER' || userRole === 'ADMIN';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Workspace Settings</h1>
        <p className="text-gray-600 mt-1">
          Manage your workspace profile.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-md border border-green-200">
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="p-6 text-gray-500 text-center">Loading settings...</div>
      ) : workspaceInfo ? (
        <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden p-6 space-y-6">
          
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Workspace Name
              </label>
              <div className="mt-1">
                <input
                  type="text"
                  id="name"
                  required
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={!isOwnerOrAdmin || isSaving}
                  className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md border px-3 py-2 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              {!isOwnerOrAdmin && (
                <p className="mt-1 text-sm text-gray-500">You must be an OWNER or ADMIN to change the workspace name.</p>
              )}
            </div>

            {isOwnerOrAdmin && (
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSaving || !nameInput.trim() || nameInput.trim() === workspaceInfo.name}
                  className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}
          </form>

          <hr className="border-gray-200" />

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Workspace Information</h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 text-sm text-gray-600">
              <div className="sm:col-span-1">
                <dt className="font-medium text-gray-900">Workspace ID</dt>
                <dd className="mt-1 font-mono text-xs">{workspaceInfo.id}</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="font-medium text-gray-900">Slug</dt>
                <dd className="mt-1 font-mono text-xs">{workspaceInfo.slug}</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="font-medium text-gray-900">Status</dt>
                <dd className="mt-1">
                  <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                    {workspaceInfo.status}
                  </span>
                </dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="font-medium text-gray-900">Created At</dt>
                <dd className="mt-1">{new Date(workspaceInfo.created_at).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : (
        <div className="p-6 text-gray-500 text-center">Workspace not found.</div>
      )}
    </div>
  );
}
