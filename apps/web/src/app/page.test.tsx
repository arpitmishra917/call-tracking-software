import { describe, it, expect, vi, beforeEach } from 'vitest';
import HomePage from './page';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('Root HomePage Auth Redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects authenticated user to /protected', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123', email: 'user@example.com' } },
        }),
      },
    } as any);

    await HomePage();

    expect(redirect).toHaveBeenCalledWith('/protected');
  });

  it('redirects unauthenticated user to /login', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
    } as any);

    await HomePage();

    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
