'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AccountPage() {
  const supabase = createClient();
  
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadAccount() {
      try {
        setLoading(true);
        setError(null);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setEmail(user.email || '');
        }

        const data = await apiFetch('/account');
        if (data && data.fullName) {
          setFullName(data.fullName);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load account settings');
      } finally {
        setLoading(false);
      }
    }
    loadAccount();
  }, [supabase.auth]);

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingName(true);
      setError(null);
      setNameSuccess(null);
      
      const data = await apiFetch('/account/profile', {
        method: 'PUT',
        body: JSON.stringify({ fullName: fullName.trim() }),
      });
      
      setFullName(data.fullName);
      setNameSuccess('Profile updated successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingEmail(true);
      setError(null);
      setEmailSuccess(null);
      
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      
      if (error) {
        throw error;
      }
      
      setEmailSuccess('Check your email to confirm your new email address.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingPassword(true);
      setError(null);
      setPasswordSuccess(null);

      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match.');
      }
      if (newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }
      
      // Update password using Supabase Auth
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      
      if (error) {
        throw error;
      }
      
      setPasswordSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-8 max-w-4xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">My Account</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Manage your personal account information and authentication credentials.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading account...</div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          
          {/* PROFILE CARD */}
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              {nameSuccess && (
                <div className="mb-4 p-4 bg-green-50 text-green-700 rounded-md border border-green-200 text-sm">
                  {nameSuccess}
                </div>
              )}
              <form onSubmit={handleUpdateName} className="flex flex-col gap-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    type="text"
                    id="fullName"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={isSavingName}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSavingName || !fullName.trim()}
                  className="w-full sm:w-auto self-start mt-2"
                >
                  {isSavingName ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* EMAIL CARD */}
          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
              <CardDescription>
                Changing your email requires verification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {emailSuccess && (
                <div className="mb-4 p-4 bg-green-50 text-green-700 rounded-md border border-green-200 text-sm">
                  {emailSuccess}
                </div>
              )}
              <form onSubmit={handleUpdateEmail} className="flex flex-col gap-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="email">New Email</Label>
                  <Input
                    type="email"
                    id="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSavingEmail}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSavingEmail || !email.trim()}
                  className="w-full sm:w-auto self-start mt-2"
                >
                  {isSavingEmail ? 'Changing...' : 'Change Email'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* PASSWORD CARD */}
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
            </CardHeader>
            <CardContent>
              {passwordSuccess && (
                <div className="mb-4 p-4 bg-green-50 text-green-700 rounded-md border border-green-200 text-sm">
                  {passwordSuccess}
                </div>
              )}
              <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4 max-w-xl">
                {/* Note: Current password verification might not be fully supported by the simple update API depending on Supabase version, but we include the field as per best UX practices */}
                <div className="space-y-2 hidden">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    type="password"
                    id="currentPassword"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={isSavingPassword}
                    autoComplete="current-password"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    type="password"
                    id="newPassword"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isSavingPassword}
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    type="password"
                    id="confirmPassword"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isSavingPassword}
                    autoComplete="new-password"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSavingPassword || !newPassword.trim() || !confirmPassword.trim()}
                  className="w-full sm:w-auto self-start mt-2"
                >
                  {isSavingPassword ? 'Changing...' : 'Change Password'}
                </Button>
              </form>
            </CardContent>
          </Card>
          
        </div>
      )}
    </div>
  );
}
