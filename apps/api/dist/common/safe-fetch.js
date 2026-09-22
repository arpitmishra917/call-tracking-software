import * as dns from 'dns/promises';
import { URL } from 'url';
function isPrivateIPv4(ip) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN))
        return false;
    if (parts[0] === 127)
        return true;
    if (parts[0] === 10)
        return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        return true;
    if (parts[0] === 192 && parts[1] === 168)
        return true;
    if (parts[0] === 169 && parts[1] === 254)
        return true;
    if (parts[0] === 0)
        return true;
    return false;
}
function isPrivateIPv6(ip) {
    if (ip === '::1' || ip === '0000:0000:0000:0000:0000:0000:0000:0001')
        return true;
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd'))
        return true;
    if (ip.toLowerCase().startsWith('fe8') || ip.toLowerCase().startsWith('fe9') || ip.toLowerCase().startsWith('fea') || ip.toLowerCase().startsWith('feb'))
        return true;
    if (ip === '::' || /^0000:0000:0000:0000:0000:0000:0000:0000$/.test(ip))
        return true;
    return false;
}
export async function validateSsrfUrl(urlString) {
    let parsedUrl;
    try {
        parsedUrl = new URL(urlString);
    }
    catch (e) {
        throw new Error('Invalid URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Forbidden protocol: ${parsedUrl.protocol}`);
    }
    if (parsedUrl.username || parsedUrl.password) {
        throw new Error('Embedded credentials are not allowed');
    }
    const hostname = parsedUrl.hostname;
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
    }
    catch (err) {
        throw new Error(`DNS Resolution failed: ${err.message}`);
    }
    return parsedUrl;
}
export async function safeFetch(url, init, maxRedirects = 3) {
    let currentUrl = url;
    let redirects = 0;
    while (redirects <= maxRedirects) {
        await validateSsrfUrl(currentUrl);
        const safeInit = {
            ...init,
            redirect: 'manual',
        };
        const response = await fetch(currentUrl, safeInit);
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
            redirects++;
            const location = response.headers.get('location');
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }
        return response;
    }
    throw new Error('Too many redirects');
}
//# sourceMappingURL=safe-fetch.js.map