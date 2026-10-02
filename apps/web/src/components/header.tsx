'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Menu, PhoneCall, Wallet } from 'lucide-react';
import WorkspaceSelector from '@/components/workspace-selector';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface HeaderProps {
  workspaces: { id: string; name: string; role: string }[];
  user: { email?: string };
  onMenuClick: () => void;
}

function HeaderMetrics() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [liveCalls, setLiveCalls] = useState<number | null>(null);
  const [balance, setBalance] = useState<{ amountMinor: number; currency: string } | null>(null);

  const fetchMetrics = useCallback(async (isPolling = false) => {
    if (!workspaceId) return;

    try {
      const [liveRes, balRes] = await Promise.all([
        apiFetch(`/workspaces/${workspaceId}/calls/live-calls`),
        apiFetch(`/workspaces/${workspaceId}/billing/balance`)
      ]);
      setLiveCalls(liveRes.liveCalls);
      setBalance(balRes.balance);
    } catch (err) {
      // Retain last known value on temporary polling failure
      if (!isPolling) {
        setLiveCalls(null);
        setBalance(null);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    // Reset state on workspace switch
    setLiveCalls(null);
    setBalance(null);

    // Initial fetch
    fetchMetrics();

    const handleWalletUpdate = () => fetchMetrics(true);
    window.addEventListener('wallet-topup', handleWalletUpdate);

    // Polling interval
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMetrics(true);
      }
    }, 10000); // 10 seconds

    return () => {
      clearInterval(interval);
      window.removeEventListener('wallet-topup', handleWalletUpdate);
    };
  }, [fetchMetrics]);

  const formatBalance = (amountMinor: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amountMinor / 100);
  };

  if (!workspaceId) return null;

  return (
    <div className="flex items-center gap-x-6 mr-4 bg-muted/50 rounded-lg px-4 py-1.5 border border-border/50">
      <div className="flex items-center gap-x-2 text-sm">
        <PhoneCall className={`h-4 w-4 ${liveCalls && liveCalls > 0 ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground'}`} />
        <span className="font-medium text-foreground">
          {liveCalls !== null ? `${liveCalls} Live` : '—'}
        </span>
      </div>
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <div className="flex items-center gap-x-2 text-sm">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-foreground">
          {balance ? formatBalance(balance.amountMinor, balance.currency) : '—'}
        </span>
      </div>
    </div>
  );
}

export default function Header({ workspaces, user, onMenuClick }: HeaderProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-x-4 border-b border-border bg-surface px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
      <button
        type="button"
        className="-m-2.5 p-2.5 text-muted-foreground hover:text-foreground md:hidden"
        onClick={onMenuClick}
      >
        <span className="sr-only">Open sidebar</span>
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Separator */}
      <div className="h-6 w-px bg-border md:hidden" aria-hidden="true" />

      <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6 items-center justify-between">
        <div className="flex flex-1 items-center gap-x-4">
          <React.Suspense fallback={<div className="w-48 h-8 bg-muted rounded animate-pulse" />}>
            <WorkspaceSelector workspaces={workspaces} />
          </React.Suspense>
        </div>
        
        <div className="flex items-center gap-x-4 lg:gap-x-6">
          <React.Suspense fallback={<div className="w-32 h-8 bg-muted rounded animate-pulse" />}>
            <HeaderMetrics />
          </React.Suspense>
          <div className="hidden sm:block text-sm font-medium text-foreground">
            {user.email}
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
}
