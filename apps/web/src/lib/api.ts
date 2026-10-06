import { createClient } from '@/utils/supabase/client';

export async function apiFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw new Error('Not authenticated');
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }

  // Returns JSON or null if empty
  const responseText = await res.text();
  return responseText ? JSON.parse(responseText) : null;
}

export interface ApiDownloadResult {
  blob: Blob;
  filename: string | null;
  headers: Headers;
}

export async function apiDownload(path: string, options: RequestInit = {}): Promise<ApiDownloadResult> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw new Error('Not authenticated');
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let errorMessage = `API error (${res.status}): ${text}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) {
        errorMessage = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
      }
    } catch {
      // Non-JSON error body, preserve default formatted message
    }
    throw new Error(errorMessage);
  }

  const blob = await res.blob();
  const contentDisposition = res.headers.get('content-disposition');
  let filename: string | null = null;
  if (contentDisposition && contentDisposition.includes('filename=')) {
    const matches = /filename="?([^"]+)"?/.exec(contentDisposition);
    if (matches && matches[1]) {
      filename = matches[1].replace(/['"]/g, '').trim();
    }
  }

  return {
    blob,
    filename,
    headers: res.headers,
  };
}
