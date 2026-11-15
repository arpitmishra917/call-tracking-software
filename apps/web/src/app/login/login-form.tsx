'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginFormProps {
  loginAction: (formData: FormData) => Promise<void>;
  token?: string;
  invitationDetails?: { workspace_name: string; email: string } | null;
  initialMessage?: string;
}

export default function LoginForm({
  loginAction,
  token,
  invitationDetails,
  initialMessage,
}: LoginFormProps) {
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    // Clear displayed message on new submission
    setMessage(undefined);
    setIsSubmitting(true);

    // Strip stale message query parameter from URL bar to prevent persistence across re-renders
    if (typeof window !== 'undefined' && window.location.search) {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('message')) {
          url.searchParams.delete('message');
          window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
        }
      } catch {
        // Fallback gracefully if window.location cannot be parsed
      }
    }

    try {
      await loginAction(formData);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" action={handleSubmit}>
      {token && <input type="hidden" name="inviteToken" value={token} />}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          defaultValue={invitationDetails?.email || ''}
          readOnly={!!invitationDetails}
          className={invitationDetails ? 'bg-gray-100' : ''}
          onChange={() => {
            if (message) setMessage(undefined);
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          name="password"
          placeholder="••••••••"
          required
          onChange={() => {
            if (message) setMessage(undefined);
          }}
        />
      </div>

      {message && (
        <p className="text-red-500 text-sm mt-2 text-center" role="alert">
          {message}
        </p>
      )}

      <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
        {isSubmitting ? 'Logging in...' : 'Log In'}
      </Button>
    </form>
  );
}
