/**
 * Base URL Resolution and Validation Utility
 *
 * Implements deterministic public origin resolution with Render-native fallback.
 * Precedence:
 *   1. process.env.BASE_URL (explicit configuration, highest priority)
 *   2. process.env.RENDER_EXTERNAL_URL (Render-native automatic runtime environment variable)
 *
 * Safety & Security:
 *   - Enforces strict public HTTPS validation in production.
 *   - Fails closed if missing or invalid when required by live telephony carriers.
 *   - Normalizes trailing slashes so downstream URL concatenation is safe from double slashes.
 */

export interface BaseUrlResolutionOptions {
  /**
   * Whether to strictly validate that the resolved URL is a public HTTPS URL.
   * If true: always runs validatePublicHttpsUrl.
   * If false: normalizes without throwing on missing or private URLs (dev/test mode).
   * If undefined: automatically true in production (NODE_ENV === 'production' && APP_ENV !== 'qa').
   */
  validate?: boolean;
}

export interface BaseUrlResolutionResult {
  url?: string;
  source: 'BASE_URL' | 'RENDER_EXTERNAL_URL' | 'none';
  origin?: string;
}

/**
 * Normalizes a URL by stripping any trailing slashes.
 */
export function normalizeTrailingSlash(url: string | undefined): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

/**
 * Strict validator for public HTTPS origins required by external telephony carriers.
 * Fails closed on invalid protocol, embedded credentials, localhost, loopback, or private IP ranges.
 * Returns the origin (e.g. 'https://callflow-backend.onrender.com') without trailing slash.
 */
export function validatePublicHttpsUrl(urlStr: string | undefined, varName: string): string {
  if (!urlStr || !urlStr.trim()) {
    throw new Error(
      `[CRITICAL STARTUP ERROR] ${varName} is missing! In production with Telnyx, a valid public HTTPS URL is required.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new Error(`[CRITICAL STARTUP ERROR] ${varName} (${urlStr}) is not a valid URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`[CRITICAL STARTUP ERROR] ${varName} must use HTTPS protocol (got: ${parsed.protocol}).`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`[CRITICAL STARTUP ERROR] ${varName} must not contain embedded credentials.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Guard against localhost, loopback, link-local, and RFC 1918 private IPv4/IPv6 ranges
  const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost');
  const isLoopbackIp =
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.');
  const isPrivateIp =
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc00:') ||
    hostname.startsWith('fd00:') ||
    hostname === '0.0.0.0';

  if (isLocalhost || isLoopbackIp || isPrivateIp) {
    throw new Error(
      `[CRITICAL STARTUP ERROR] ${varName} (${urlStr}) resolves to a loopback or private network address. External carriers cannot reach private addresses.`,
    );
  }

  return parsed.origin;
}

/**
 * Resolves the application base URL.
 *
 * Precedence:
 *   1. process.env.BASE_URL (explicit configuration, highest priority)
 *   2. process.env.RENDER_EXTERNAL_URL (Render-native automatic runtime variable)
 *
 * In production (NODE_ENV === 'production' && APP_ENV !== 'qa') or when options.validate is true,
 * runs validatePublicHttpsUrl to ensure the URL is a valid public HTTPS endpoint.
 * Fails closed if missing or invalid.
 */
export function resolveBaseUrl(options?: BaseUrlResolutionOptions): string | undefined {
  const explicitBaseUrl = process.env.BASE_URL?.trim();
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.trim();

  let candidate: string | undefined;
  let sourceVar: 'BASE_URL' | 'RENDER_EXTERNAL_URL' = 'BASE_URL';

  if (explicitBaseUrl) {
    candidate = explicitBaseUrl;
    sourceVar = 'BASE_URL';
  } else if (renderExternalUrl) {
    candidate = renderExternalUrl;
    sourceVar = 'RENDER_EXTERNAL_URL';
  } else {
    candidate = undefined;
    sourceVar = 'BASE_URL';
  }

  const shouldValidate =
    options?.validate !== undefined
      ? options.validate
      : process.env.NODE_ENV === 'production' && process.env.APP_ENV !== 'qa';

  if (shouldValidate) {
    // validatePublicHttpsUrl will throw if candidate is missing or invalid.
    // If both are missing, candidate is undefined and sourceVar is 'BASE_URL',
    // producing: "[CRITICAL STARTUP ERROR] BASE_URL is missing! In production with Telnyx, a valid public HTTPS URL is required."
    const validatedOrigin = validatePublicHttpsUrl(candidate, sourceVar);
    return validatedOrigin;
  }

  // Non-production or unvalidated: return candidate without trailing slash if present
  if (candidate) {
    return normalizeTrailingSlash(candidate);
  }

  return undefined;
}

/**
 * Detailed resolution result for diagnostic logging and inspection.
 */
export function inspectBaseUrlResolution(): BaseUrlResolutionResult {
  const explicitBaseUrl = process.env.BASE_URL?.trim();
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.trim();

  if (explicitBaseUrl) {
    return {
      url: normalizeTrailingSlash(explicitBaseUrl),
      source: 'BASE_URL',
      origin: tryGetOrigin(explicitBaseUrl),
    };
  }

  if (renderExternalUrl) {
    return {
      url: normalizeTrailingSlash(renderExternalUrl),
      source: 'RENDER_EXTERNAL_URL',
      origin: tryGetOrigin(renderExternalUrl),
    };
  }

  return {
    url: undefined,
    source: 'none',
    origin: undefined,
  };
}

function tryGetOrigin(urlStr: string): string | undefined {
  try {
    return new URL(urlStr).origin;
  } catch {
    return undefined;
  }
}
