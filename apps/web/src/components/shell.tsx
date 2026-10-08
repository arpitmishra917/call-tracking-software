'use client';

import React, { useState, Suspense } from 'react';
import { X } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import WorkspaceValidator from '@/components/workspace-validator';
import { cn } from '@/utils/cn';

interface ShellProps {
  workspaces: { id: string; name: string; role: string; participant_type?: string }[];
  user: { email?: string };
  children: React.ReactNode;
}

export default function Shell({ workspaces, user, children }: ShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 z-10 border-r border-border bg-surface">
        <Suspense fallback={null}>
          <Sidebar workspaces={workspaces} />
        </Suspense>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="relative z-50 md:hidden">
          <div className="fixed inset-0 bg-primary/80 transition-opacity" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="fixed inset-0 flex">
            <div className="relative mr-16 flex w-full max-w-xs flex-1 bg-surface">
              <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                <button type="button" className="-m-2.5 p-2.5" onClick={() => setIsMobileMenuOpen(false)}>
                  <span className="sr-only">Close sidebar</span>
                  <X className="h-6 w-6 text-white" aria-hidden="true" />
                </button>
              </div>
              <Suspense fallback={null}>
                <Sidebar workspaces={workspaces} onNavClick={() => setIsMobileMenuOpen(false)} />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 flex-col md:pl-64">
        <Suspense fallback={<div className="h-16 border-b border-border bg-surface" />}>
          <Header 
            workspaces={workspaces} 
            user={user} 
            onMenuClick={() => setIsMobileMenuOpen(true)} 
          />
        </Suspense>
        <main className="flex-1 overflow-auto bg-background p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <Suspense fallback={<div>Loading workspace...</div>}>
              <WorkspaceValidator workspaces={workspaces}>
                {children}
              </WorkspaceValidator>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
