export function normalizeE164(number: string): string {
  // strip all non-digits
  const digits = number.replace(/\D/g, '');
  if (!digits) return '';
  // basic US fallback if 10 digits
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
}
