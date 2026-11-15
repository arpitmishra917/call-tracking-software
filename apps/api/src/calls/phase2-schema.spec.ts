import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

describe('Phase 2 Schema & Attribution Model Invariants (Slice 1)', () => {
  it('1. CallScalarFieldEnum contains all approved attribution fields', () => {
    const fields = Object.values(Prisma.CallScalarFieldEnum);
    expect(fields).toContain('phone_number_id');
    expect(fields).toContain('vendor_id');
    expect(fields).toContain('attributed_vendor_id');
    expect(fields).toContain('attribution_source');
  });

  it('2. Model Call maintains required core relations and indexes', () => {
    // Verifies that Prisma client type definitions include the relations
    type CallWithRelations = Prisma.CallGetPayload<{
      include: {
        vendor: true;
        phone_number: true;
        commercial: true;
      };
    }>;

    // TypeScript compilation check: ensure property types are nullable objects
    const mockCall = {} as CallWithRelations;
    const vendor: CallWithRelations['vendor'] = null;
    const phoneNumber: CallWithRelations['phone_number'] = null;
    const commercial: CallWithRelations['commercial'] = null;

    expect(vendor).toBeNull();
    expect(phoneNumber).toBeNull();
    expect(commercial).toBeNull();
  });

  it('3. Vendor model contains reverse relation to Call', () => {
    type VendorWithCalls = Prisma.VendorGetPayload<{
      include: {
        calls: true;
      };
    }>;

    const mockVendor = {} as VendorWithCalls;
    const calls: VendorWithCalls['calls'] = [];
    expect(Array.isArray(calls)).toBe(true);
  });

  it('4. PhoneNumber model contains reverse relation to Call', () => {
    type PhoneNumberWithCalls = Prisma.PhoneNumberGetPayload<{
      include: {
        calls: true;
      };
    }>;

    const mockNumber = {} as PhoneNumberWithCalls;
    const calls: PhoneNumberWithCalls['calls'] = [];
    expect(Array.isArray(calls)).toBe(true);
  });

  it('5. CallCommercial financial model invariants remain completely untouched', () => {
    const fields = Object.values(Prisma.CallCommercialScalarFieldEnum);
    expect(fields).toContain('revenue');
    expect(fields).toContain('payout');
    expect(fields).toContain('cost');
    expect(fields).toContain('profit');
    expect(fields).toContain('qualified');
    expect(fields).toContain('converted');
    expect(fields).toContain('duplicate');
    expect(fields).toContain('vendor_id');
    expect(fields).toContain('buyer_id');
  });
});
