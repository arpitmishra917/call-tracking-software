const fs = require('fs');
let sidebar = fs.readFileSync('apps/web/src/components/sidebar.tsx', 'utf8');

// Remove Dashboard NavItem
sidebar = sidebar.replace(/<NavItem href="\/protected".*?>Dashboard<\/NavItem>\s*/g, '');

// Remove LayoutDashboard import if present
sidebar = sidebar.replace(/LayoutDashboard,\s*/g, '');

fs.writeFileSync('apps/web/src/components/sidebar.tsx', sidebar);

const pageTsx = `'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ProtectedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');

  useEffect(() => {
    // Redirect the old Dashboard route to Reporting
    if (workspaceId) {
      router.replace(\`/protected/reporting?workspace=\${workspaceId}\`);
    } else {
      router.replace('/protected/reporting');
    }
  }, [router, workspaceId]);

  return null;
}
`;

fs.writeFileSync('apps/web/src/app/protected/page.tsx', pageTsx);
