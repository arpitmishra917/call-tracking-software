import { createClient } from '@/utils/supabase/client';

export function getBaseApiUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  return rawUrl.trim().replace(/\/+$/, '');
}

export function buildApiUrl(path: string): string {
  const base = getBaseApiUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  const url = buildApiUrl(path);

  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, fetchOptions);
  } catch (networkError: unknown) {
    const errorDetails =
      networkError instanceof Error ? networkError.message : String(networkError);
    throw new Error(
      `Network request failed to ${url}: ${errorDetails}. Please verify backend health and CORS configuration.`,
    );
  }

  // If token is expired (401), attempt an automatic session refresh once and retry
  if (res.status === 401) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (!refreshError && refreshData?.session?.access_token) {
      session = refreshData.session;
      try {
        res = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            ...options.headers,
          },
        });
      } catch (retryError: unknown) {
        const retryDetails =
          retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`Network request retry failed to ${url}: ${retryDetails}`);
      }
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) {
        detail = Array.isArray(parsed.message)
          ? parsed.message.join(', ')
          : parsed.message;
      }
    } catch {
      // Non-JSON error body, preserve raw text
    }
    const err = new Error(`API error (${res.status}): ${detail}`);
    (err as any).status = res.status;
    (err as any).statusCode = res.status;
    throw err;
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

export async function apiDownload(
  path: string,
  options: RequestInit = {},
): Promise<ApiDownloadResult> {
  const supabase = createClient();
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  const url = buildApiUrl(path);

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
    });
  } catch (networkError: unknown) {
    const errorDetails =
      networkError instanceof Error ? networkError.message : String(networkError);
    throw new Error(
      `Network download failed to ${url}: ${errorDetails}. Please verify backend health and CORS configuration.`,
    );
  }

  if (res.status === 401) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (!refreshError && refreshData?.session?.access_token) {
      session = refreshData.session;
      try {
        res = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            ...options.headers,
          },
        });
      } catch (retryError: unknown) {
        const retryDetails =
          retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`Network download retry failed to ${url}: ${retryDetails}`);
      }
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let errorMessage = `API error (${res.status}): ${text}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) {
        errorMessage = Array.isArray(parsed.message)
          ? parsed.message.join(', ')
          : parsed.message;
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
