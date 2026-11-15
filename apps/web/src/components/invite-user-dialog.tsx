'use client';

import React, { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Building2, UserSquare2, Mail, Check, Copy } from 'lucide-react';

export interface InviteUserDialogProps {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  participantType: 'BUYER' | 'VENDOR';
  entityId: string;
  entityName: string;
  onSuccess?: (token: string) => void;
}

export function InviteUserDialog({
  workspaceId,
  isOpen,
  onClose,
  participantType,
  entityId,
  entityName,
  onSuccess,
}: InviteUserDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !workspaceId || !entityId) return;

    setIsSubmitting(true);
    setError(null);

    const payload: {
      email: string;
      role: string;
      participant_type: 'BUYER' | 'VENDOR';
      buyer_id?: string;
      vendor_id?: string;
    } = {
      email: email.trim().toLowerCase(),
      role,
      participant_type: participantType,
    };

    if (participantType === 'BUYER') {
      payload.buyer_id = entityId;
    } else {
      payload.vendor_id = entityId;
    }

    try {
      const res = await apiFetch(`/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res?.token) {
        setInviteToken(res.token);
        onSuccess?.(res.token);
      } else {
        handleClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleClose() {
    setEmail('');
    setRole('MEMBER');
    setError(null);
    setInviteToken(null);
    setCopied(false);
    onClose();
  }

  const inviteUrl = inviteToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/invitations?token=${inviteToken}`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-6 border border-border">
        {inviteToken ? (
          <div>
            <h2 className="text-xl font-bold mb-2 text-foreground">Invitation Link Ready</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Direct email delivery is not configured. Copy this link and deliver it directly to the {participantType.toLowerCase()} user:
            </p>
            <div className="flex gap-2 mb-6">
              <input
                type="text"
                readOnly
                className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-xs font-mono shadow-sm"
                value={inviteUrl}
                aria-label="Invitation Link"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="w-4 h-4 mr-1 text-green-500" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-4">
              {participantType === 'BUYER' ? (
                <UserSquare2 className="w-5 h-5 text-primary" />
              ) : (
                <Building2 className="w-5 h-5 text-primary" />
              )}
              <h2 className="text-xl font-bold text-foreground">
                Invite {participantType === 'BUYER' ? 'Buyer' : 'Vendor'} User
              </h2>
            </div>

            <div className="mb-4 p-3 bg-muted rounded-md text-sm flex items-center justify-between">
              <span className="text-muted-foreground">{participantType === 'BUYER' ? 'Buyer' : 'Vendor'}:</span>
              <span className="font-semibold text-foreground flex items-center gap-2">
                {entityName}
                <Badge variant="outline">{participantType}</Badge>
              </span>
            </div>

            {error && (
              <div
                className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm"
                role="alert"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="dialog-invite-email">
                  User Email <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="dialog-invite-email"
                    type="email"
                    required
                    placeholder="partner@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dialog-invite-role">Role</Label>
                <select
                  id="dialog-invite-role"
                  className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="MEMBER">MEMBER (Standard Access)</option>
                  <option value="VIEWER">VIEWER (Read Only)</option>
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !email.trim()}>
                  {isSubmitting ? 'Sending Invite...' : 'Generate Invitation'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
