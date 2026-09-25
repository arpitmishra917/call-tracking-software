'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ExternalLink, CreditCard, Receipt } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

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
  }
  const [billingState, setBillingState] = useState<BillingState | null>(null);

  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    let ignore = false;
    const fetchBilling = async () => {
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/billing`);
        if (!ignore) {
          setBillingState(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };
    fetchBilling();
    return () => { ignore = true; };
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

  if (!workspaceId) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        Select a workspace first.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Billing & Subscription</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Manage your subscription plan, billing details, and view past invoices.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading billing data...</div>
      ) : billingState ? (
        <div className="flex flex-col gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Current Status</CardTitle>
              <CardDescription>Your active subscription details.</CardDescription>
            </CardHeader>
            <CardContent>
              {billingState.subscription ? (
                <div className="flex flex-col gap-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">Status</p>
                      <Badge variant={billingState.subscription.status === 'active' || billingState.subscription.status === 'trialing' ? 'success' : 'warning'} className="uppercase">
                        {billingState.subscription.status}
                      </Badge>
                    </div>
                    {billingState.subscription.plan && (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Plan</p>
                        <p className="font-semibold text-foreground">{billingState.subscription.plan.name}</p>
                      </div>
                    )}
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">Period End</p>
                      <p className="font-semibold text-foreground">
                        {new Date(billingState.subscription.current_period_end).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-border">
                    <Button onClick={handleManageBilling} className="gap-2">
                      <CreditCard className="w-4 h-4" />
                      Manage Billing Portal
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <div className="p-6 bg-muted/50 rounded-lg border border-dashed text-center">
                    <p className="text-muted-foreground">No active subscription found.</p>
                  </div>
                  
                  {billingState.plans && billingState.plans.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {billingState.plans.map((plan) => (
                        <Card key={plan.id} className="flex flex-col shadow-none">
                          <CardHeader>
                            <CardTitle>{plan.name}</CardTitle>
                            <CardDescription>{plan.description}</CardDescription>
                          </CardHeader>
                          <CardContent className="flex-grow">
                            <div className="text-3xl font-bold">
                              ${(plan.amount / 100).toFixed(2)}
                              <span className="text-sm font-normal text-muted-foreground"> / {plan.interval}</span>
                            </div>
                          </CardContent>
                          <CardFooter>
                            <Button 
                              className="w-full" 
                              onClick={() => handleSubscribe(plan.id)}
                            >
                              Subscribe
                            </Button>
                          </CardFooter>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice History</CardTitle>
              <CardDescription>Past billing statements for this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!billingState.invoices || billingState.invoices.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    icon={<Receipt />}
                    title="No invoices yet"
                    description="When you are billed, your invoices will appear here."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingState.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          {new Date(inv.invoice_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          ${(inv.amount_paid / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={inv.status.toUpperCase() === 'PAID' ? 'success' : 'error'} className={inv.status.toUpperCase() === 'PAID' ? 'bg-green-600 hover:bg-green-700' : ''}>
                            {inv.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {inv.hosted_invoice_url ? (
                            <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
                              View <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
