'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type Profile = {
  id: string;
  display_name: string | null;
  created_at: string;
};

type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile: Profile;
};

export default function MembersPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!workspaceId) return;
    try {
      // Find out current user's role in this workspace
      const workspaces = await apiFetch('/workspaces');
      const ws = workspaces.find((w: { id: string; role: string }) => w.id === workspaceId);
      setUserRole(ws?.role || null);

      const data = await apiFetch(`/workspaces/${workspaceId}/members`);
      setMembers(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
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
        fetchMembers();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchMembers]);

  const handleRemove = async (userId: string) => {
    if (!workspaceId) return;
    if (!confirm('Are you sure you want to remove this member from the workspace? This action cannot be undone.')) return;

    try {
      setError(null);
      await apiFetch(`/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      });
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  if (!workspaceId) {
    return <div className="p-4 text-gray-500">Please select a workspace first.</div>;
  }

  const isOwnerOrAdmin = userRole === 'OWNER' || userRole === 'ADMIN';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Workspace Members</h1>
        <p className="text-gray-600 mt-1">
          Manage access to this workspace.
          <br/>
          <span className="text-sm font-semibold">Note: The backend currently does not support inviting new members via email or editing existing roles.</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-md border border-red-200">
          {error}
        </div>
      )}

      <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Team Members</h2>
        </div>
        
        {loading ? (
          <div className="p-6 text-gray-500 text-center">Loading members...</div>
        ) : members.length === 0 ? (
          <div className="p-6 text-gray-500 text-center">No members found.</div>
        ) : (
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-6 py-3 font-medium">User / Identity</th>
                <th className="px-6 py-3 font-medium w-32">Role</th>
                <th className="px-6 py-3 font-medium w-48">Joined</th>
                {isOwnerOrAdmin && <th className="px-6 py-3 font-medium w-24 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">
                      {member.profile.display_name || 'Anonymous User'}
                    </div>
                    <div className="text-xs font-mono text-gray-500 mt-1 break-all">
                      {member.profile.id}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      {member.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(member.created_at).toLocaleDateString()}
                  </td>
                  {isOwnerOrAdmin && (
                    <td className="px-6 py-4 text-right">
                      {member.role !== 'OWNER' && (
                        <button
                          onClick={() => handleRemove(member.user_id)}
                          className="text-red-600 hover:text-red-800 font-medium"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
