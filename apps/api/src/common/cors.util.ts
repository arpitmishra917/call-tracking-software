/**
 * Utility for normalizing and resolving CORS origins robustly.
 * Handles trailing slashes, whitespace, comma-delimited origin lists,
 * and case-insensitivity without weakening production security.
 */

export function normalizeOrigin(origin: string): string {
  if (!origin) return '';
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export function parseAllowedOrigins(rawOrigins: string | undefined): Set<string> {
  const allowed = new Set<string>();
  const defaultOrigins = [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  for (const def of defaultOrigins) {
    allowed.add(normalizeOrigin(def));
  }

  if (rawOrigins && rawOrigins.trim()) {
    // Support comma-separated origins, trailing slashes, and whitespace
    const parts = rawOrigins.split(',');
    for (const part of parts) {
      const cleaned = normalizeOrigin(part);
      if (cleaned) {
        allowed.add(cleaned);
      }
    }
  }

  return allowed;
}

export function isOriginAllowed(
  requestOrigin: string | undefined,
  allowedOriginsSet: Set<string>,
): boolean {
  // Allow non-browser requests (server-to-server, curl, mobile apps)
  if (!requestOrigin) {
    return true;
  }
  const normalized = normalizeOrigin(requestOrigin);
  return allowedOriginsSet.has(normalized);
}

export function createCorsOriginDelegate(rawOrigins: string | undefined) {
  const allowedSet = parseAllowedOrigins(rawOrigins);
  return (
    requestOrigin: string | undefined,
    callback: (err: Error | null, origin?: boolean) => void,
  ) => {
    if (isOriginAllowed(requestOrigin, allowedSet)) {
      return callback(null, true);
    }
    console.warn(
      `[CORS] Blocked request from origin "${requestOrigin}". Allowed origins: [${Array.from(allowedSet).join(', ')}]`,
    );
    return callback(null, false);
  };
}
