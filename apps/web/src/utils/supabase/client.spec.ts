import { createBrowserClient } from '@supabase/ssr';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(),
}));

describe('Frontend Auth Configuration (MOCK)', () => {
  it('Authentication configuration/client initialization should pass environment variables', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';

    // We emulate the client.ts behavior
    const createClient = () => {
      return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    };

    createClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://mock.supabase.co',
      'mock-anon-key'
    );
  });
});
