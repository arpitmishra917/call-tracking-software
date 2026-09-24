'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  interface BillingState {
    subscription?: {
      status: string;
      plan?: { name: string };
      current_period_end: string | number | Date;
    };
    invoices?: Array<{
      id: string;
      invoice_date: string | number | Date;
      amount_paid: number;
      status: string;
      hosted_invoice_url?: string;
    }>;
    plans?: Array<{
      id: string;
      name: string;
      description: string;
      amount: number;
      interval: string;
    }>;
    usage?: {
      summary?: {
        CALL_MINUTE?: number;
        PHONE_NUMBER?: number;
        RECORDING_STORAGE?: number;
      };
      period_start?: string | number | Date;
      period_end?: string | number | Date;
    };
  }
  const [billingState, setBillingState] = useState<BillingState | null>(null);

  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const fetchBilling = async () => {
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/billing`);
        setBillingState(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchBilling();
  }, [workspaceId]);

  const handleSubscribe = async (planId: string) => {
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/billing/checkout`, {
        method: 'POST',
        body: JSON.stringify({ planId, returnUrl: window.location.href }),
      });
      window.location.assign(data.url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleManageBilling = async () => {
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/billing/portal`, {
        method: 'POST',
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.assign(data.url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (!workspaceId) return <div className="p-8">Please select a workspace first.</div>;
  if (loading) return <div className="p-8">Loading billing data...</div>;
  if (error) return <div className="p-8 text-red-500">Error: {error}</div>;

  const { subscription, invoices, plans, usage } = billingState || {};

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-4">Billing & Subscription</h1>
        <div className="bg-white shadow p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Current Status</h2>
          {subscription ? (
            <div>
              <p>Status: <span className="font-medium text-blue-600">{subscription.status}</span></p>
              {subscription.plan && <p>Plan: {subscription.plan.name}</p>}
              <p>Period End: {new Date(subscription.current_period_end).toLocaleDateString()}</p>
              
              <div className="mt-4">
                <button
                  onClick={handleManageBilling}
                  className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"
                >
                  Manage Billing (Stripe Portal)
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-gray-500 mb-4">No active subscription found.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plans?.map((plan) => (
                  <div key={plan.id} className="border p-4 rounded-lg flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-lg">{plan.name}</h3>
                      <p className="text-gray-600">{plan.description}</p>
                      <p className="text-xl font-semibold mt-2">${(plan.amount / 100).toFixed(2)} / {plan.interval}</p>
                    </div>
                    <button
                      onClick={() => handleSubscribe(plan.id)}
                      className="mt-4 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 w-full"
                    >
                      Subscribe
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {usage?.summary && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Current Period Usage</h2>
          <div className="bg-white shadow p-6 rounded-lg">
            <p className="text-sm text-gray-500 mb-4">
              Usage tracked during the current billing period 
              ({usage.period_start ? new Date(usage.period_start).toLocaleDateString() : 'N/A'} - {usage.period_end ? new Date(usage.period_end).toLocaleDateString() : 'N/A'}).
              This usage does not affect your flat subscription rate.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border p-4 rounded-lg">
                <h3 className="font-semibold text-gray-700">Call Minutes</h3>
                <p className="text-2xl font-bold">{usage.summary.CALL_MINUTE}</p>
              </div>
              <div className="border p-4 rounded-lg">
                <h3 className="font-semibold text-gray-700">Phone Numbers</h3>
                <p className="text-2xl font-bold">{usage.summary.PHONE_NUMBER}</p>
              </div>
              <div className="border p-4 rounded-lg">
                <h3 className="font-semibold text-gray-700">Recordings (MB)</h3>
                <p className="text-2xl font-bold">{usage.summary.RECORDING_STORAGE}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {(invoices?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Invoice History</h2>
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b">
                  <th className="p-4">Date</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {invoices?.map((inv) => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">{new Date(inv.invoice_date).toLocaleDateString()}</td>
                    <td className="p-4">${(inv.amount_paid / 100).toFixed(2)}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${inv.status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="p-4">
                      {inv.hosted_invoice_url ? (
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          View
                        </a>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
