'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type UsageSummary = {
  CALL_MINUTE: number;
  PHONE_NUMBER: number;
  RECORDING_STORAGE: number;
};

type UsageData = {
  summary: UsageSummary;
  period_start: string | null;
  period_end: string | null;
};

export default function UsagePage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/billing`);
      setUsage(data.usage || null);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
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
        fetchUsage();
      }
    }
    init();
    return () => { ignore = true; };
  }, [fetchUsage]);

  if (!workspaceId) {
    return <div className="p-4 text-gray-500">Please select a workspace first.</div>;
  }

  const formatPeriod = (start: string | null, end: string | null) => {
    if (!start || !end) return 'Current Billing Period';
    return `${new Date(start).toLocaleDateString()} to ${new Date(end).toLocaleDateString()}`;
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Workspace Usage</h1>
        <p className="text-gray-600 mt-1">
          Review your usage metrics for the current billing cycle.
          <br />
          <span className="text-sm font-semibold">Note: The backend currently exposes raw usage without dynamic date filtering.</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-gray-500 text-center">Loading usage data...</div>
      ) : usage ? (
        <div className="space-y-6">
          <div className="bg-white px-6 py-4 rounded-lg shadow-sm border border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Billing Period</h2>
              <p className="text-lg font-medium text-gray-900">{formatPeriod(usage.period_start, usage.period_end)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white shadow rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Call Minutes</h3>
              <p className="text-4xl font-bold text-gray-900">{usage.summary.CALL_MINUTE}</p>
              <p className="text-sm text-gray-500 mt-2">Total voice minutes processed</p>
            </div>
            
            <div className="bg-white shadow rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Phone Numbers</h3>
              <p className="text-4xl font-bold text-gray-900">{usage.summary.PHONE_NUMBER}</p>
              <p className="text-sm text-gray-500 mt-2">Active phone numbers provisioned</p>
            </div>
            
            <div className="bg-white shadow rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Recording Storage</h3>
              <p className="text-4xl font-bold text-gray-900">{usage.summary.RECORDING_STORAGE}</p>
              <p className="text-sm text-gray-500 mt-2">Storage units consumed by call recordings</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-gray-500 text-center bg-white shadow rounded-lg border border-gray-200">
          No usage data available for this workspace.
        </div>
      )}
    </div>
  );
}
