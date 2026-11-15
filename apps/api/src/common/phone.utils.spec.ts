import { describe, it, expect } from 'vitest';
import {
  extractCallerIdentity,
  normalizeE164,
  normalizeCallerNumber,
  formatCallerDisplay,
  maskCallerPhoneNumber,
  isValidPhoneNumber,
  isIdentifiableCallerNumber,
  parseAndValidateE164,
} from './phone.utils.js';

describe('PhoneUtils & Caller Identity Matrix', () => {
  describe('extractCallerIdentity', () => {
    it('1. Raw caller value with host/IP: "+1919926005557@208.69.83.26"', () => {
      const res = extractCallerIdentity('+1919926005557@208.69.83.26');
      expect(res.user).toBe('+1919926005557');
      expect(res.host).toBe('208.69.83.26');
      expect(res.isSip).toBe(true);
    });

    it('2. Plain E.164 caller numbers', () => {
      const res1 = extractCallerIdentity('+1919926005557');
      expect(res1.user).toBe('+1919926005557');
      expect(res1.host).toBeUndefined();
      expect(res1.isSip).toBe(false);

      const res2 = extractCallerIdentity('+919926005557');
      expect(res2.user).toBe('+919926005557');
      expect(res2.host).toBeUndefined();
      expect(res2.isSip).toBe(false);
    });

    it('3. Valid SIP URIs with schemes, ports, and parameters', () => {
      const res1 = extractCallerIdentity('sip:+1919926005557@208.69.83.26');
      expect(res1.user).toBe('+1919926005557');
      expect(res1.host).toBe('208.69.83.26');
      expect(res1.isSip).toBe(true);

      const res2 = extractCallerIdentity('sips:+15551234567@sip.telnyx.com:5061;transport=tls');
      expect(res2.user).toBe('+15551234567');
      expect(res2.host).toBe('sip.telnyx.com:5061');
      expect(res2.isSip).toBe(true);

      const res3 = extractCallerIdentity('"John Doe" <sip:+15551234567@gateway.net;user=phone>');
      expect(res3.user).toBe('+15551234567');
      expect(res3.host).toBe('gateway.net');
      expect(res3.isSip).toBe(true);
    });

    it('4. Non-numeric SIP usernames and unknown/anonymous callers', () => {
      const res1 = extractCallerIdentity('sip:alice@sip.provider.com');
      expect(res1.user).toBe('alice');
      expect(res1.host).toBe('sip.provider.com');
      expect(res1.isSip).toBe(true);

      const res2 = extractCallerIdentity('anonymous');
      expect(res2.user).toBe('anonymous');
      expect(res2.isSip).toBe(false);

      const res3 = extractCallerIdentity(null);
      expect(res3.user).toBe('');
      expect(res3.isSip).toBe(false);
    });
  });

  describe('normalizeE164 & normalizeCallerNumber', () => {
    it('normalizes raw SIP user@host to clean E.164 without host IP digits', () => {
      expect(normalizeE164('+1919926005557@208.69.83.26')).toBe('+1919926005557');
      expect(normalizeCallerNumber('sip:+1919926005557@208.69.83.26')).toBe('+1919926005557');
    });

    it('normalizes international numbers', () => {
      expect(normalizeE164('+919926005557')).toBe('+919926005557');
      expect(normalizeE164('919926005557')).toBe('+919926005557');
    });

    it('normalizes 10-digit US numbers with +1', () => {
      expect(normalizeE164('9199260055')).toBe('+19199260055');
    });

    it('preserves non-numeric caller labels', () => {
      expect(normalizeE164('anonymous')).toBe('anonymous');
      expect(normalizeE164('restricted')).toBe('restricted');
    });
  });

  describe('formatCallerDisplay', () => {
    it('formats plain and SIP caller IDs cleanly for non-vendor view', () => {
      expect(formatCallerDisplay('+1919926005557@208.69.83.26', false)).toBe('+1919926005557');
      expect(formatCallerDisplay('+919926005557', false)).toBe('+919926005557');
      expect(formatCallerDisplay('sip:+15551234567@gateway.net;user=phone', false)).toBe('+15551234567');
      expect(formatCallerDisplay('anonymous', false)).toBe('anonymous');
      expect(formatCallerDisplay('', false)).toBe('—');
      expect(formatCallerDisplay(null, false)).toBe('—');
    });

    it('masks caller numbers for vendor view without leaking or incorporating host IP', () => {
      const maskedSip = formatCallerDisplay('+1919926005557@208.69.83.26', true);
      expect(maskedSip).toBe('+1919***5557');
      expect(maskedSip).not.toContain('208');
      expect(maskedSip).not.toContain('@');

      const maskedPlain = formatCallerDisplay('+919926005557', true);
      expect(maskedPlain).toBe('+9199***5557');

      const maskedUs = formatCallerDisplay('+15551234567', true);
      expect(maskedUs).toBe('+1555***4567');
    });
  });

  describe('isValidPhoneNumber', () => {
    it('validates phone numbers with and without SIP wrappers', () => {
      expect(isValidPhoneNumber('+1919926005557')).toBe(true);
      expect(isValidPhoneNumber('+1919926005557@208.69.83.26')).toBe(true);
      expect(isValidPhoneNumber('sip:+15551234567@gateway.net')).toBe(true);
      expect(isValidPhoneNumber('anonymous')).toBe(false);
      expect(isValidPhoneNumber('')).toBe(false);
      expect(isValidPhoneNumber(null)).toBe(false);
    });
  });

  describe('isIdentifiableCallerNumber', () => {
    it('returns true for valid E.164 and SIP phone numbers', () => {
      expect(isIdentifiableCallerNumber('+15551234567')).toBe(true);
      expect(isIdentifiableCallerNumber('5551234567')).toBe(true);
      expect(isIdentifiableCallerNumber('+442071838750')).toBe(true);
      expect(isIdentifiableCallerNumber('sip:+15551234567@provider.com')).toBe(true);
      expect(isIdentifiableCallerNumber('"Jane" <sip:+15551234567@provider.com>')).toBe(true);
    });

    it('rejects null, undefined, empty, and whitespace strings', () => {
      expect(isIdentifiableCallerNumber(null)).toBe(false);
      expect(isIdentifiableCallerNumber(undefined)).toBe(false);
      expect(isIdentifiableCallerNumber('')).toBe(false);
      expect(isIdentifiableCallerNumber('   ')).toBe(false);
    });

    it('rejects anonymous, private, withheld, and restricted identifiers', () => {
      expect(isIdentifiableCallerNumber('anonymous')).toBe(false);
      expect(isIdentifiableCallerNumber('Anonymous')).toBe(false);
      expect(isIdentifiableCallerNumber('ANONYMOUS')).toBe(false);
      expect(isIdentifiableCallerNumber('sip:anonymous@sip.provider.com')).toBe(false);
      expect(isIdentifiableCallerNumber('private')).toBe(false);
      expect(isIdentifiableCallerNumber('withheld')).toBe(false);
      expect(isIdentifiableCallerNumber('restricted')).toBe(false);
      expect(isIdentifiableCallerNumber('unknown')).toBe(false);
      expect(isIdentifiableCallerNumber('unavailable')).toBe(false);
      expect(isIdentifiableCallerNumber('blocked')).toBe(false);
    });

    it('rejects repetitive single-digit and sequential dummy placeholders', () => {
      expect(isIdentifiableCallerNumber('0000000000')).toBe(false);
      expect(isIdentifiableCallerNumber('+10000000000')).toBe(false);
      expect(isIdentifiableCallerNumber('1111111111')).toBe(false);
      expect(isIdentifiableCallerNumber('+11111111111')).toBe(false);
      expect(isIdentifiableCallerNumber('1234567890')).toBe(false);
      expect(isIdentifiableCallerNumber('1234567')).toBe(false);
    });
  });

  describe('parseAndValidateE164', () => {
    it('parses valid E.164 formats to normalized E.164', () => {
      expect(parseAndValidateE164('+17207159445')).toBe('+17207159445');
      expect(parseAndValidateE164('+14845560110')).toBe('+14845560110');
      expect(parseAndValidateE164('17207159445')).toBe('+17207159445');
      expect(parseAndValidateE164('(720) 715-9445')).toBe('+17207159445');
      expect(parseAndValidateE164('+442071838750')).toBe('+442071838750');
      expect(parseAndValidateE164('  +17207159445  ')).toBe('+17207159445');
    });

    it('rejects SIP URIs in Phase 4 strict E.164 parsing', () => {
      expect(parseAndValidateE164('sip:arpitmishra9178@sip.telnyx.com')).toBeNull();
      expect(parseAndValidateE164('sip:+17207159445@sip.telnyx.com')).toBeNull();
      expect(parseAndValidateE164('sips:+17207159445@example.com')).toBeNull();
    });

    it('rejects malformed, empty, invalid strings and null', () => {
      expect(parseAndValidateE164(null)).toBeNull();
      expect(parseAndValidateE164(undefined)).toBeNull();
      expect(parseAndValidateE164('')).toBeNull();
      expect(parseAndValidateE164('   ')).toBeNull();
      expect(parseAndValidateE164('invalid')).toBeNull();
      expect(parseAndValidateE164('123')).toBeNull();
      expect(parseAndValidateE164('+0123456789')).toBeNull();
      expect(parseAndValidateE164('+17207159445, +14845560110')).toBeNull();
    });
  });
});
