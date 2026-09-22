'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface DashboardMetrics {
  total: number;
  answered: number;
  missed: number;
  blocked: number;
  avgDuration: number;
  campaigns: Record<string, { total: number; answered: number }>;
  buyers: Record<string, { total: number; answered: number }>;
}

export default function ProtectedPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    async function loadMetrics() {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (startDate) query.set('startDate', startDate);
        if (endDate) query.set('endDate', endDate);
        const data = await apiFetch(`/workspaces/${workspaceId}/calls/metrics?${query.toString()}`);
        setMetrics(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadMetrics();
    }
  }, [workspaceId, startDate, endDate]);

  if (!workspaceId) return <div className="p-6">Select a workspace first.</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex space-x-2 items-center text-sm">
          <label>Start:</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border rounded p-1" />
          <label>End:</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border rounded p-1" />
        </div>
      </div>
      
      {loading ? (
        <div>Loading metrics...</div>
      ) : metrics ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-gray-500 text-sm">Total Calls</div>
              <div className="text-3xl font-bold">{metrics.total}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-green-600 text-sm">Answered</div>
              <div className="text-3xl font-bold">{metrics.answered}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-orange-500 text-sm">Missed</div>
              <div className="text-3xl font-bold">{metrics.missed}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <div className="text-red-500 text-sm">Blocked</div>
              <div className="text-3xl font-bold">{metrics.blocked}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <h3 className="font-bold mb-2">Campaign Metrics</h3>
              <div className="space-y-2">
                {Object.entries(metrics.campaigns).map(([id, stats]: [string, { total: number; answered: number }]) => (
                  <div key={id} className="flex justify-between border-b pb-1 text-sm">
                    <span>Campaign: {id.slice(0, 8)}...</span>
                    <span>{stats.total} total, {stats.answered} ans</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <h3 className="font-bold mb-2">Buyer Metrics</h3>
              <div className="space-y-2">
                {Object.entries(metrics.buyers).map(([id, stats]: [string, { total: number; answered: number }]) => (
                  <div key={id} className="flex justify-between border-b pb-1 text-sm">
                    <span>Buyer: {id.slice(0, 8)}...</span>
                    <span>{stats.total} total, {stats.answered} ans</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>No metrics data available.</div>
      )}
    </div>
  );
}
