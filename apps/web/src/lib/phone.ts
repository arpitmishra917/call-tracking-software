export interface CallerIdentity {
  user: string;
  host?: string;
  isSip: boolean;
}

/**
 * Extracts the user part or phone number from a raw caller ID.
 * Explicitly parses:
 * - Plain phone numbers: "+1919926005557", "+919926005557"
 * - User@Host: "+1919926005557@208.69.83.26"
 * - SIP URIs: "sip:+1919926005557@208.69.83.26", "sips:+15551234567@..."
 * - Scheme with parameters: "sip:+1919926005557@208.69.83.26;user=phone"
 * - Bracketed / Display Name URIs: '"John Doe" <sip:+1919926005557@208.69.83.26>'
 * - Non-numeric SIP users: "sip:alice@sip.provider.com" -> user: "alice"
 */
export function extractCallerIdentity(raw: any): CallerIdentity {
  if (raw === null || raw === undefined) return { user: '', isSip: false };
  let str = String(raw).trim();
  if (!str) return { user: '', isSip: false };

  // 1. Remove display name and angle brackets if present
  if (str.includes('<') && str.includes('>')) {
    const match = str.match(/<([^>]+)>/);
    if (match) str = match[1].trim();
  }

  // 2. Strip URI scheme
  let isSip = false;
  if (/^(sips?|tel):/i.test(str)) {
    isSip = true;
    str = str.replace(/^(sips?|tel):/i, '');
  }

  // 3. Strip URI parameters and headers after ';' or '?'
  const paramIndex = str.indexOf(';');
  if (paramIndex !== -1) {
    str = str.slice(0, paramIndex);
  }
  const queryIndex = str.indexOf('?');
  if (queryIndex !== -1) {
    str = str.slice(0, queryIndex);
  }

  // 4. Split user@host if present
  if (str.includes('@')) {
    const atIndex = str.indexOf('@');
    const user = str.slice(0, atIndex).trim();
    const host = str.slice(atIndex + 1).trim();
    return { user, host: host || undefined, isSip: true };
  }

  return { user: str, isSip };
}

export function normalizeE164(number: string): string {
  if (!number) return '';
  const identity = extractCallerIdentity(number);
  const target = identity.user || '';

  // strip all non-digits
  const digits = target.replace(/\D/g, '');
  if (!digits) {
    return target;
  }
  // basic US fallback if 10 digits
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (target.startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function normalizeCallerNumber(raw: any): string {
  if (raw === null || raw === undefined) return '';
  return normalizeE164(String(raw));
}

export function formatCallerDisplay(num: any, isVendor: boolean = false): string {
  if (!num) return '—';
  if (isVendor) {
    return maskCallerPhoneNumber(num);
  }
  const identity = extractCallerIdentity(num);
  const user = identity.user;
  const digitsOnly = user.replace(/\D/g, '');
  if (digitsOnly.length >= 7) {
    return normalizeE164(user);
  }
  return user || '—';
}

export function maskCallerPhoneNumber(num: any): string {
  if (!num) return '';
  const identity = extractCallerIdentity(num);
  const user = identity.user;
  const digits = user.replace(/\D/g, '');
  if (digits.length < 7) {
    if (!digits) return user;
    return '***';
  }
  if (digits.length === 10) return `+1${digits.slice(0, 3)}***${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1${digits.slice(1, 4)}***${digits.slice(7)}`;
  const prefix = user.startsWith('+') ? '+' : '';
  const visiblePrefix = digits.slice(0, Math.min(4, Math.floor(digits.length / 3)));
  const visibleSuffix = digits.slice(-Math.min(4, Math.floor(digits.length / 3)));
  return `${prefix}${visiblePrefix}***${visibleSuffix}`;
}
