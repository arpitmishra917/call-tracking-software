import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import AcceptInvitationClient from './client';

export default async function AcceptInvitationPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams;
  const token = params.token;
  if (!token) {
    redirect('/protected');
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <AcceptInvitationClient token={token} />
    </div>
  );
}
