export function normalizeE164(number) {
    const digits = number.replace(/\D/g, '');
    if (!digits)
        return '';
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    return `+${digits}`;
}
//# sourceMappingURL=phone.utils.js.map