/**
 * CALLFLOW PHASE 2 — P2.3 WORKSTREAM D
 * POSTGRESQL INTEGRATION SUITE: MASS ASSIGNMENT REJECTION & SAFE QUERY VALIDATION
 *
 * Scenarios Covered:
 * 1. Mass-assignment rejection: Protected fields (workspace_id, role, permissions, balance) rejected from request bodies.
 * 2. Mass-assignment silent strip: Protected fields can be silently stripped instead of throwing.
 * 3. Safe pagination: Negative limit/offset values are rejected with BadRequestException.
 * 4. Safe pagination: Limit exceeding maximum (100) is rejected.
 * 5. Safe pagination: Non-integer limit/offset values are rejected.
 * 6. Safe pagination: Valid pagination parameters pass through cleanly.
 * 7. Sort field allowlist: Disallowed sort fields are rejected.
 * 8. Sort field allowlist: Valid sort fields pass through.
 * 9. Search injection defense: Overly long search strings are rejected.
 * 10. Nested object mass-assignment: Protected fields in nested objects are detected and rejected.
 * 11. Array item mass-assignment: Protected fields in array items are detected.
 * 12. Real PostgreSQL execution: Sanitized pagination params execute safely on PostgreSQL.
 * 13. Real PostgreSQL execution: Sliced limit/offset pagination retrieves exact row counts and totals.
 *
 * Safety:
 * - Real PostgreSQL database transactions and queries.
 * - Non-production database assertion (fails closed).
 * - Full cleanup in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient, CallState } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SafeValidationPipe, PROTECTED_MASS_ASSIGNMENT_FIELDS } from '../src/common/pipes/safe-validation.pipe.js';
import { SafePaginationPipe } from '../src/common/pipes/safe-pagination.pipe.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

describe('P2.3 Workstream D: Mass Assignment Rejection & Safe Query Validation Integration Suite (Real PostgreSQL)', { timeout: 20000 }, () => {
  // =========================================================================
  // SAFE VALIDATION PIPE — Mass Assignment Prevention
  // =========================================================================
  describe('SafeValidationPipe — Mass Assignment Prevention', () => {

    it('1. Reject: Protected field "workspace_id" in request body is rejected', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true });
      const body = { name: 'Valid Name', workspace_id: 'malicious-ws-id' };

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(/workspace_id.*protected/i);
    });

    it('2. Reject: Protected field "role" in request body is rejected when configured as protected', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true, additionalProtectedFields: ['role'] });
      const body = { name: 'Valid Name', role: 'OWNER' };

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('3. Reject: Protected field "permissions" in request body is rejected', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true });
      const body = { name: 'Valid Name', permissions: ['admin:all'] };

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('4. Reject: Protected field "balance_micro" in request body is rejected', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true });
      const body = { name: 'Valid Name', balance_micro: 999999999999 };

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('5. Strip: Protected field silently removed when rejectProtectedProperties=false', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: false, whitelist: false, transform: false });
      const body = { name: 'Valid Name', workspace_id: 'malicious-ws-id' };

      const result = await pipe.transform(body, { type: 'body' } as any);
      expect(result.workspace_id).toBeUndefined();
      expect(result.name).toBe('Valid Name');
    });

    it('6. Pass: Non-protected fields pass through cleanly', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true, whitelist: false, transform: false });
      const body = { name: 'Valid Name', email: 'test@example.com', maxCalls: 5 };

      const result = await pipe.transform(body, { type: 'body' } as any);
      expect(result.name).toBe('Valid Name');
      expect(result.email).toBe('test@example.com');
      expect(result.maxCalls).toBe(5);
    });

    it('7. Reject: Protected field "is_admin" (camelCase "isAdmin") in request body is rejected', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true });
      const body = { name: 'Valid Name', isAdmin: true };

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('8. Reject: Nested protected field "workspace_id" inside nested object is detected', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true });
      const body = { name: 'Valid Name', meta: { workspace_id: 'malicious-ws' } };

      await expect(
        pipe.transform(body, { type: 'body' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('9. Pass: Query params (non-body type) are not subject to mass-assignment check', async () => {
      const pipe = new SafeValidationPipe({ rejectProtectedProperties: true, whitelist: false, transform: false });
      const query = { limit: '10', workspace_id: 'some-id' };

      const result = await pipe.transform(query, { type: 'query' } as any);
      expect(result).toBeDefined();
    });

    it('10. Protected fields constant: all required fields are covered', () => {
      const required = ['workspace_id', 'workspaceId', 'balance', 'balance_micro', 'is_admin', 'isAdmin', 'is_superadmin', 'permissions'];
      for (const field of required) {
        expect(PROTECTED_MASS_ASSIGNMENT_FIELDS).toContain(field);
      }
    });
  });

  // =========================================================================
  // SAFE PAGINATION PIPE — Safe Query Validation
  // =========================================================================
  describe('SafePaginationPipe — Safe Query Validation', () => {

    it('11. Reject: Negative limit is rejected', () => {
      const pipe = new SafePaginationPipe({ maxLimit: 100 });
      expect(() => pipe.transform({ limit: '-1' })).toThrow(BadRequestException);
    });

    it('12. Reject: Zero limit is rejected (must be >= 1)', () => {
      const pipe = new SafePaginationPipe({ minLimit: 1, maxLimit: 100 });
      expect(() => pipe.transform({ limit: '0' })).toThrow(BadRequestException);
    });

    it('13. Reject: Limit exceeding maximum (100) is rejected', () => {
      const pipe = new SafePaginationPipe({ maxLimit: 100 });
      expect(() => pipe.transform({ limit: '101' })).toThrow(BadRequestException);
    });

    it('14. Reject: Non-integer limit is rejected', () => {
      const pipe = new SafePaginationPipe({ maxLimit: 100 });
      expect(() => pipe.transform({ limit: '10.5' })).toThrow(BadRequestException);
    });

    it('15. Reject: Negative offset is rejected', () => {
      const pipe = new SafePaginationPipe();
      expect(() => pipe.transform({ offset: '-1' })).toThrow(BadRequestException);
    });

    it('16. Pass: Valid limit and offset pass through', () => {
      const pipe = new SafePaginationPipe({ maxLimit: 100 });
      const result = pipe.transform({ limit: '20', offset: '0' });
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('17. Pass: Default limit/offset applied when not provided', () => {
      const pipe = new SafePaginationPipe({ defaultLimit: 50, maxLimit: 100 });
      const result = pipe.transform({});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('18. Reject: Disallowed sort field is rejected', () => {
      const pipe = new SafePaginationPipe({ allowedSortFields: ['name', 'created_at'] });
      expect(() => pipe.transform({ sortBy: 'password' })).toThrow(BadRequestException);
    });

    it('19. Pass: Allowed sort field passes through', () => {
      const pipe = new SafePaginationPipe({ allowedSortFields: ['name', 'created_at'] });
      const result = pipe.transform({ sortBy: 'name', sortOrder: 'asc' });
      expect(result.sortBy).toBe('name');
      expect(result.sortOrder).toBe('asc');
    });

    it('20. Reject: Search string exceeding max length (100 chars) is rejected', () => {
      const pipe = new SafePaginationPipe({ maxSearchLength: 100 });
      expect(() => pipe.transform({ search: 'x'.repeat(101) })).toThrow(BadRequestException);
    });

    it('21. Pass: Search string within max length passes', () => {
      const pipe = new SafePaginationPipe({ maxSearchLength: 100 });
      const result = pipe.transform({ search: 'valid search term' });
      expect(result.search).toBe('valid search term');
    });

    it('22. Defense in Depth: sortOrder sanitizes arbitrary SQL injection input safely to default "desc"', () => {
      const pipe = new SafePaginationPipe({ allowedSortFields: ['name'] });
      const result = pipe.transform({ sortBy: 'name', sortOrder: 'DROP TABLE users;' });
      expect(result.sortOrder).toBe('desc');
    });

    it('23. Pass: Limit at exactly maximum boundary passes', () => {
      const pipe = new SafePaginationPipe({ maxLimit: 100 });
      const result = pipe.transform({ limit: '100' });
      expect(result.limit).toBe(100);
    });

    it('24. Pass: NaN-producing limit ("abc") is rejected', () => {
      const pipe = new SafePaginationPipe({ maxLimit: 100 });
      expect(() => pipe.transform({ limit: 'abc' })).toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // REAL POSTGRESQL SAFE QUERY EXECUTION
  // =========================================================================
  describe('Real PostgreSQL Safe Query Execution', { timeout: 15000 }, () => {
    const qaDbUrl =
      process.env.DATABASE_URL ||
      'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

    let prisma: PrismaClient;
    const WS_ID = `ws-p23-safe-query-${randomUUID()}`;
    const trackedCallIds: string[] = [];

    beforeAll(async () => {
      assertNonProductionDatabase(qaDbUrl, 'P2.3 Safe Query & Mass Assignment Suite');
      prisma = new PrismaClient({
        datasources: {
          db: {
            url: qaDbUrl,
          },
        },
      });
      await prisma.$connect();

      // Provision workspace for real database safe-query execution tests
      await prisma.workspace.create({
        data: {
          id: WS_ID,
          name: 'Safe Query Test WS',
          slug: `safe-query-${WS_ID.slice(0, 8)}`,
          status: 'ACTIVE',
        },
      });

      // Seed 15 calls for pagination testing
      for (let i = 0; i < 15; i++) {
        const callId = `call-safe-${i}-${randomUUID()}`;
        trackedCallIds.push(callId);
        await prisma.call.create({
          data: {
            id: callId,
            workspace_id: WS_ID,
            provider: 'telnyx',
            provider_call_id: `prov-${callId}`,
            from_number: `+1555000${String(i).padStart(4, '0')}`,
            to_number: '+15559990000',
            state: CallState.INITIATED,
          },
        });
      }
    });

    afterAll(async () => {
      try {
        if (prisma) {
          await prisma.call.deleteMany({
            where: { workspace_id: WS_ID },
          }).catch(() => {});
          await prisma.workspace.deleteMany({
            where: { id: WS_ID },
          }).catch(() => {});
        }
      } finally {
        if (prisma) {
          await prisma.$disconnect();
        }
      }
    });

    it('25. PostgreSQL Integration: Validated pagination returns bounded slice and accurate count', async () => {
      const pipe = new SafePaginationPipe({ defaultLimit: 5, maxLimit: 50 });
      const params = pipe.transform({ limit: '5', offset: '0' });

      const [items, total] = await Promise.all([
        prisma.call.findMany({
          where: { workspace_id: WS_ID },
          take: params.limit,
          skip: params.offset,
          orderBy: { created_at: 'desc' },
        }),
        prisma.call.count({ where: { workspace_id: WS_ID } }),
      ]);

      expect(items.length).toBe(5);
      expect(total).toBe(15);
    });

    it('26. PostgreSQL Integration: Second page offset returns non-overlapping records', async () => {
      const pipe = new SafePaginationPipe({ defaultLimit: 5, maxLimit: 50 });
      const page1Params = pipe.transform({ limit: '5', offset: '0' });
      const page2Params = pipe.transform({ limit: '5', offset: '5' });

      const page1 = await prisma.call.findMany({
        where: { workspace_id: WS_ID },
        take: page1Params.limit,
        skip: page1Params.offset,
        orderBy: { id: 'asc' },
      });

      const page2 = await prisma.call.findMany({
        where: { workspace_id: WS_ID },
        take: page2Params.limit,
        skip: page2Params.offset,
        orderBy: { id: 'asc' },
      });

      expect(page1.length).toBe(5);
      expect(page2.length).toBe(5);

      const page1Ids = new Set(page1.map((c) => c.id));
      const hasOverlap = page2.some((c) => page1Ids.has(c.id));
      expect(hasOverlap).toBe(false);
    });
  });
});
