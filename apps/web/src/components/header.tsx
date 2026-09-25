'use client';

import React from 'react';
import { Menu } from 'lucide-react';
import WorkspaceSelector from '@/components/workspace-selector';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/client';
import { useRouter } from 'next/navigation';

interface HeaderProps {
  workspaces: { id: string; name: string; role: string }[];
  user: { email?: string };
  onMenuClick: () => void;
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
