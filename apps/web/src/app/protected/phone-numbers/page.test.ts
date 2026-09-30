import { describe, it, expect } from 'vitest';
import { getPhoneTypeDisplay } from './page';

describe('PhoneNumbersPage Helpers', () => {
  describe('getPhoneTypeDisplay', () => {
    it('returns "Local" when phone_number_type is local', () => {
      const input = {
        phone_number: "+13363886505",
        phone_number_type: "local"
      };
      expect(getPhoneTypeDisplay(input)).toBe('Local');
    });

    it('returns "Toll-Free" when phone_number_type is toll_free', () => {
      const input = {
        phone_number: "+18005551234",
        phone_number_type: "toll_free"
      };
      expect(getPhoneTypeDisplay(input)).toBe('Toll-Free');
    });

    it('returns "Unknown" when phone_number_type is missing', () => {
      const input = {
        phone_number: "+13363886505"
      };
      expect(getPhoneTypeDisplay(input)).toBe('Unknown');
    });
    
    it('returns "Unknown" when phone_number_type is unhandled', () => {
      const input = {
        phone_number: "+13363886505",
        phone_number_type: "mobile"
      };
      expect(getPhoneTypeDisplay(input)).toBe('Unknown');
    });
  });
});
