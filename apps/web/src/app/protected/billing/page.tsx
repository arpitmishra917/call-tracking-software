'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ExternalLink, CreditCard, Receipt, Wallet, Plus, AlertCircle } from 'lucide-react';
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
  const [walletBalance, setWalletBalance] = useState<{ amountMinor: number; currency: string } | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);

  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);

  // Clear previous workspace state immediately when workspace changes
  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    setBillingState(null);
    setWalletBalance(null);
    setTransactions([]);
    setError(null);
  }, [workspaceId]);

  // Render-time workspace identity guard: eliminate stale data rendering during workspace transitions
  const isWorkspaceStale = currentWorkspaceIdRef.current !== workspaceId;
  const activeBillingState = isWorkspaceStale ? null : billingState;
  const activeWalletBalance = isWorkspaceStale ? null : walletBalance;
  const activeTransactions = isWorkspaceStale ? [] : transactions;
  const isLoading = loading || isWorkspaceStale;

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    let ignore = false;
    const fetchAll = async () => {
      try {
        const [billingRes, balRes, txRes] = await Promise.all([
          apiFetch(`/workspaces/${workspaceId}/billing`),
          apiFetch(`/workspaces/${workspaceId}/billing/balance`),
          apiFetch(`/workspaces/${workspaceId}/billing/wallet/transactions`)
        ]);
        if (!ignore) {
          setBillingState(billingRes);
          setWalletBalance(balRes.balance);
          setTransactions(txRes);
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
    fetchAll();
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

  const handleMockTopUp = async (amountMinor: number) => {
    try {
      await apiFetch(`/workspaces/${workspaceId}/billing/wallet/mock-topup`, {
        method: 'POST',
        body: JSON.stringify({ amountMinor }),
      });
      
      const [balRes, txRes] = await Promise.all([
        apiFetch(`/workspaces/${workspaceId}/billing/balance`),
        apiFetch(`/workspaces/${workspaceId}/billing/wallet/transactions`)
      ]);
      
      setWalletBalance(balRes.balance);
      setTransactions(txRes);
      
      // Tell global header to refresh
      window.dispatchEvent(new Event('wallet-topup'));
      
      alert('Mock top-up successful - Development Mode Only');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const formatMoney = (minor: number) => `$${(minor / 100).toFixed(2)}`;

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

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading billing data...</div>
      ) : (
        <div className="flex flex-col gap-8">
          
          {/* WALLET SECTION */}
          <Card className="border-blue-500/20 shadow-sm overflow-hidden">
            <div className="bg-blue-50/50 dark:bg-blue-950/20 px-6 py-3 border-b flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Development Mode — Mock payment (no real money is charged)
              </span>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-muted-foreground" />
                Prepaid Wallet
              </CardTitle>
              <CardDescription>Add funds for usage-based services like calls and numbers.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Current Balance</p>
                  <p className="text-4xl font-bold text-foreground">
                    {activeWalletBalance ? formatMoney(activeWalletBalance.amountMinor) : '$0.00'}
                  </p>
                </div>
                
                <div className="flex-1 space-y-3 w-full border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-8">
                  <p className="text-sm font-medium text-foreground">Add Mock Funds</p>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => handleMockTopUp(2500)} className="gap-1">
                      <Plus className="w-3 h-3" /> $25.00
                    </Button>
                    <Button variant="outline" onClick={() => handleMockTopUp(5000)} className="gap-1">
                      <Plus className="w-3 h-3" /> $50.00
                    </Button>
                    <Button variant="outline" onClick={() => handleMockTopUp(10000)} className="gap-1">
                      <Plus className="w-3 h-3" /> $100.00
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* WALLET TRANSACTIONS */}
          <Card>
            <CardHeader>
              <CardTitle>Wallet Ledger History</CardTitle>
              <CardDescription>Recent credits, debits, and adjustments to your prepaid balance.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!activeTransactions || activeTransactions.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    icon={<Wallet />}
                    title="No wallet transactions"
                    description="When you add funds or are billed for usage, it will appear here."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="min-w-[120px]">Date</TableHead>
                      <TableHead className="min-w-[100px]">Type</TableHead>
                      <TableHead className="min-w-[120px]">Description</TableHead>
                      <TableHead className="text-right min-w-[100px]">Amount</TableHead>
                      <TableHead className="text-right min-w-[100px]">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.type === 'CREDIT' ? 'success' : tx.type === 'DEBIT' ? 'error' : 'default'}>
                            {tx.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {tx.description || tx.reference_type}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={tx.type === 'CREDIT' ? 'text-green-600 dark:text-green-400' : 'text-foreground'}>
                            {tx.type === 'CREDIT' ? '+' : '-'}{formatMoney(tx.amount_minor)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatMoney(tx.balance_after)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {activeBillingState && (
            <Card>
              <CardHeader>
                <CardTitle>Current Subscription</CardTitle>
                <CardDescription>Your active base subscription details.</CardDescription>
              </CardHeader>
              <CardContent>
                {activeBillingState.subscription ? (
                  <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Status</p>
                        <Badge variant={activeBillingState.subscription.status === 'active' || activeBillingState.subscription.status === 'trialing' ? 'success' : 'warning'} className="uppercase">
                          {activeBillingState.subscription.status}
                        </Badge>
                      </div>
                      {activeBillingState.subscription.plan && (
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-muted-foreground">Plan</p>
                          <p className="font-semibold text-foreground">{activeBillingState.subscription.plan.name}</p>
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Period End</p>
                        <p className="font-semibold text-foreground">
                          {new Date(activeBillingState.subscription.current_period_end).toLocaleDateString()}
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
                    
                    {activeBillingState.plans && activeBillingState.plans.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {activeBillingState.plans.map((plan) => (
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
          )}

          {activeBillingState && (
            <Card>
              <CardHeader>
                <CardTitle>Invoice History</CardTitle>
                <CardDescription>Past billing statements for this workspace.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!activeBillingState.invoices || activeBillingState.invoices.length === 0 ? (
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
                        <TableHead className="min-w-[120px]">Date</TableHead>
                        <TableHead className="min-w-[100px]">Amount</TableHead>
                        <TableHead className="min-w-[100px]">Status</TableHead>
                        <TableHead className="text-right min-w-[100px]">Receipt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeBillingState.invoices.map((inv) => (
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
          )}
        </div>
      )}
    </div>
  );
}
