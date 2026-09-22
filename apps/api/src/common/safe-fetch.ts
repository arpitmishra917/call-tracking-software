import * as dns from 'dns/promises';
import { URL } from 'url';

/**
 * Checks if an IPv4 address is in a private, loopback, or link-local range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  // Loopback (127.0.0.0/8)
  if (parts[0] === 127) return true;
  // Private (10.0.0.0/8)
  if (parts[0] === 10) return true;
  // Private (172.16.0.0/12)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // Private (192.168.0.0/16)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Link-local (169.254.0.0/16)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // Current network (0.0.0.0/8)
  if (parts[0] === 0) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private, loopback, or link-local range.
 */
function isPrivateIPv6(ip: string): boolean {
  // Loopback
  if (ip === '::1' || ip === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  // Unique Local Address (fc00::/7)
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
  // Link-local (fe80::/10)
  if (ip.toLowerCase().startsWith('fe8') || ip.toLowerCase().startsWith('fe9') || ip.toLowerCase().startsWith('fea') || ip.toLowerCase().startsWith('feb')) return true;
  // Unspecified
  if (ip === '::' || /^0000:0000:0000:0000:0000:0000:0000:0000$/.test(ip)) return true;

  return false;
}

/**
 * Validates a URL against SSRF attacks.
 * Throws an error if the URL is dangerous.
 */
export async function validateSsrfUrl(urlString: string): Promise<URL> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch (e) {
    throw new Error('Invalid URL');
  }

  // 1. Only allow HTTP and HTTPS
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Forbidden protocol: ${parsedUrl.protocol}`);
  }

  // 2. No embedded credentials
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Embedded credentials are not allowed');
  }

  const hostname = parsedUrl.hostname;

  // 3. Resolve DNS
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    
    if (addresses.length === 0) {
      throw new Error('Could not resolve hostname');
    }

    for (const addr of addresses) {
      if (addr.family === 4 && isPrivateIPv4(addr.address)) {
        throw new Error(`SSRF Blocked: Host resolves to private IPv4 ${addr.address}`);
      }
      if (addr.family === 6 && isPrivateIPv6(addr.address)) {
        throw new Error(`SSRF Blocked: Host resolves to private IPv6 ${addr.address}`);
      }
    }
  } catch (err: any) {
    throw new Error(`DNS Resolution failed: ${err.message}`);
  }

  return parsedUrl;
}

export async function safeFetch(url: string, init?: RequestInit, maxRedirects = 3): Promise<Response> {
  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    await validateSsrfUrl(currentUrl);

    const safeInit = {
      ...init,
      redirect: 'manual' as RequestRedirect,
    };

    const response = await fetch(currentUrl, safeInit);

    // If it's a redirect, we validate the new location
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      redirects++;
      const location = response.headers.get('location')!;
      // Resolve relative redirects
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects');
}
