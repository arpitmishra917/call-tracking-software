'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type Metrics = {
  total: number;
  answered: number;
  missed: number;
  blocked: number;
  avgDuration: number;
  campaigns: Record<string, { total: number; answered: number }>;
  buyers: Record<string, { total: number; answered: number }>;
};

export default function ReportingPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchMetrics = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append('startDate', new Date(startDate).toISOString());
      if (endDate) {
        // End of the selected day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        queryParams.append('endDate', end.toISOString());
      }
      
      const qs = queryParams.toString();
      const url = `/workspaces/${workspaceId}/calls/metrics${qs ? `?${qs}` : ''}`;
      
      const data = await apiFetch(url);
      setMetrics(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, startDate, endDate]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Derived formats for display
  const formatDuration = (secs: number) => {
    if (!secs) return '0s';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const calculateRate = (part: number, total: number) => {
    if (total === 0) return '0%';
    return Math.round((part / total) * 100) + '%';
  };

  if (!workspaceId) {
    return <div className="p-4 text-gray-500">Please select a workspace first.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reporting</h1>
          <p className="text-gray-600 mt-1 text-sm">
            Call volume and routing performance.
            <br />
            <span className="text-xs font-semibold">Note: The backend currently does not support usage cost mapping or real-time billing metrics in this endpoint.</span>
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white p-2 rounded-md shadow-sm border border-gray-200">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-sm border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500 border"
          />
          <span className="text-gray-500 text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-sm border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500 border"
          />
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center p-12 text-gray-500">Loading metrics...</div>
      ) : metrics ? (
        <>
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
              <div className="text-sm text-gray-500 mb-1">Total Calls</div>
              <div className="text-3xl font-bold text-gray-900">{metrics.total}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-green-200 shadow-sm">
              <div className="text-sm text-green-600 mb-1 font-medium">Answered</div>
              <div className="text-3xl font-bold text-gray-900">{metrics.answered}</div>
              <div className="text-xs text-gray-500 mt-1">Rate: {calculateRate(metrics.answered, metrics.total)}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-orange-200 shadow-sm">
              <div className="text-sm text-orange-600 mb-1 font-medium">Missed/No Answer</div>
              <div className="text-3xl font-bold text-gray-900">{metrics.missed}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-red-200 shadow-sm">
              <div className="text-sm text-red-600 mb-1 font-medium">Blocked/Failed</div>
              <div className="text-3xl font-bold text-gray-900">{metrics.blocked}</div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-blue-200 shadow-sm">
              <div className="text-sm text-blue-600 mb-1 font-medium">Avg Answered Duration</div>
              <div className="text-3xl font-bold text-gray-900">{formatDuration(metrics.avgDuration)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Campaign Breakdown */}
            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Campaign Performance</h2>
              </div>
              {Object.keys(metrics.campaigns).length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">No campaign data in this period.</div>
              ) : (
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="border-b border-gray-200 bg-white">
                    <tr>
                      <th className="px-6 py-3 font-medium">Campaign ID</th>
                      <th className="px-6 py-3 font-medium text-right">Total Calls</th>
                      <th className="px-6 py-3 font-medium text-right">Answered</th>
                      <th className="px-6 py-3 font-medium text-right">Answer Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(metrics.campaigns).map(([id, stats]) => (
                      <tr key={id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-mono text-xs">{id}</td>
                        <td className="px-6 py-3 text-right font-medium">{stats.total}</td>
                        <td className="px-6 py-3 text-right text-green-600 font-medium">{stats.answered}</td>
                        <td className="px-6 py-3 text-right">{calculateRate(stats.answered, stats.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Buyer Breakdown */}
            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Buyer Performance</h2>
              </div>
              {Object.keys(metrics.buyers).length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">No buyer data in this period.</div>
              ) : (
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="border-b border-gray-200 bg-white">
                    <tr>
                      <th className="px-6 py-3 font-medium">Buyer ID</th>
                      <th className="px-6 py-3 font-medium text-right">Total Attempts</th>
                      <th className="px-6 py-3 font-medium text-right">Answered</th>
                      <th className="px-6 py-3 font-medium text-right">Connect Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(metrics.buyers).map(([id, stats]) => (
                      <tr key={id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-mono text-xs">{id}</td>
                        <td className="px-6 py-3 text-right font-medium">{stats.total}</td>
                        <td className="px-6 py-3 text-right text-green-600 font-medium">{stats.answered}</td>
                        <td className="px-6 py-3 text-right">{calculateRate(stats.answered, stats.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
