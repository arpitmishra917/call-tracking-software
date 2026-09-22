'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';

interface CallLog {
  id: string;
  created_at: string;
  from_number: string;
  to_number: string;
  state: string;
  duration_secs?: number | null;
  campaign?: { name: string } | null;
}

export default function CallsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    callerNumber: '',
    status: '',
    campaignId: '',
    buyerId: '',
  });

  useEffect(() => {
    async function loadCalls() {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (filters.startDate) query.set('startDate', filters.startDate);
        if (filters.endDate) query.set('endDate', filters.endDate);
        if (filters.callerNumber) query.set('callerNumber', filters.callerNumber);
        if (filters.status) query.set('status', filters.status);
        if (filters.campaignId) query.set('campaignId', filters.campaignId);
        if (filters.buyerId) query.set('buyerId', filters.buyerId);
        
        const data = await apiFetch(`/workspaces/${workspaceId}/calls?${query.toString()}`);
        setCalls(data.items);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadCalls();
    }
  }, [workspaceId, filters]);

  if (!workspaceId) return <div className="p-6">Select a workspace first.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Call Logs</h1>

      <div className="bg-white p-4 rounded shadow-sm border flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm">Start Date</label>
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="border p-1 rounded" />
        </div>
        <div>
          <label className="block text-sm">End Date</label>
          <input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} className="border p-1 rounded" />
        </div>
        <div>
          <label className="block text-sm">Caller Number</label>
          <input type="text" value={filters.callerNumber} onChange={e => setFilters({...filters, callerNumber: e.target.value})} placeholder="e.g. +1" className="border p-1 rounded" />
        </div>
        <div>
          <label className="block text-sm">Status</label>
          <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className="border p-1 rounded">
            <option value="">All</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="NO_ANSWER">NO_ANSWER</option>
            <option value="FAILED">FAILED</option>
          </select>
        </div>
        <button onClick={() => setFilters({startDate: '', endDate: '', callerNumber: '', status: '', campaignId: '', buyerId: ''})} className="bg-gray-200 px-3 py-1 rounded">
          Clear
        </button>
      </div>

      <div className="bg-white rounded shadow-sm border overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">Time</th>
              <th className="p-3">Caller</th>
              <th className="p-3">Tracking No.</th>
              <th className="p-3">Campaign</th>
              <th className="p-3">Status</th>
              <th className="p-3">Duration</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-center">Loading...</td></tr>
            ) : calls.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center">No calls found.</td></tr>
            ) : (
              calls.map(call => (
                <tr key={call.id} className="border-b">
                  <td className="p-3">{new Date(call.created_at).toLocaleString()}</td>
                  <td className="p-3">{call.from_number}</td>
                  <td className="p-3">{call.to_number}</td>
                  <td className="p-3">{call.campaign?.name || '-'}</td>
                  <td className="p-3">{call.state}</td>
                  <td className="p-3">{call.duration_secs ? `${call.duration_secs}s` : '-'}</td>
                  <td className="p-3">
                    <Link href={`/protected/calls/${call.id}?workspace=${workspaceId}`} className="text-blue-600 hover:underline">
                      View Details
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
