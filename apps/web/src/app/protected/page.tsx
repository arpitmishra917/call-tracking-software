'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ProtectedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  useEffect(() => {
    // Redirect the old Dashboard route to Reporting
    if (workspaceId) {
      router.replace(`/protected/reporting?workspace=${workspaceId}`);
    } else {
      router.replace('/protected/reporting');
    }
  }, [router, workspaceId]);

  return null;
}
