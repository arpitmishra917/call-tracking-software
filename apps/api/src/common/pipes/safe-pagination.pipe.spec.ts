import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SafePaginationPipe } from './safe-pagination.pipe.js';

describe('SafePaginationPipe', () => {
  describe('Limit & Offset Enforcements', () => {
    const pipe = new SafePaginationPipe();

    it('should assign default limit 50 and offset 0 when query is empty', () => {
      const result = pipe.transform({});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('should correctly parse valid numeric limit and offset strings', () => {
      const result = pipe.transform({ limit: '25', offset: '10' });
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(10);
      expect(typeof result.limit).toBe('number');
      expect(typeof result.offset).toBe('number');
    });

    it('should accept valid boundary values (limit=1, limit=100, offset=0)', () => {
      const minResult = pipe.transform({ limit: '1', offset: '0' });
      expect(minResult.limit).toBe(1);
      expect(minResult.offset).toBe(0);

      const maxResult = pipe.transform({ limit: '100', offset: '99999' });
      expect(maxResult.limit).toBe(100);
      expect(maxResult.offset).toBe(99999);
    });

    it('should reject limit > 100 with BadRequestException', () => {
      expect(() => pipe.transform({ limit: '101' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ limit: '500' })).toThrow(BadRequestException);
    });

    it('should reject limit < 1 with BadRequestException', () => {
      expect(() => pipe.transform({ limit: '0' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ limit: '-10' })).toThrow(BadRequestException);
    });

    it('should reject negative offset with BadRequestException', () => {
      expect(() => pipe.transform({ offset: '-1' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ offset: '-50' })).toThrow(BadRequestException);
    });

    it('should reject non-integer limit and offset', () => {
      expect(() => pipe.transform({ limit: 'not-a-number' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ limit: '12.5' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ offset: 'abc' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ offset: '5.2' })).toThrow(BadRequestException);
    });
  });

  describe('Search & Filter Normalization', () => {
    const pipe = new SafePaginationPipe();

    it('should trim and accept valid search strings', () => {
      const result = pipe.transform({ search: '  Acme Corp  ' });
      expect(result.search).toBe('Acme Corp');
    });

    it('should reject search strings exceeding 100 characters', () => {
      const longSearch = 'a'.repeat(101);
      expect(() => pipe.transform({ search: longSearch })).toThrow(BadRequestException);
    });

    it('should normalize empty search strings to undefined', () => {
      const result = pipe.transform({ search: '   ' });
      expect(result.search).toBeUndefined();
    });

    it('should reject status strings exceeding 50 characters', () => {
      const longStatus = 's'.repeat(51);
      expect(() => pipe.transform({ status: longStatus })).toThrow(BadRequestException);
    });
  });

  describe('Sort Field Allowlists', () => {
    const allowedFields = ['created_at', 'name', 'status', 'total_duration'];
    const pipe = new SafePaginationPipe({ allowedSortFields: allowedFields });

    it('should accept whitelisted sort fields and normalize order', () => {
      const ascResult = pipe.transform({ sortBy: 'name', sortOrder: 'ASC' });
      expect(ascResult.sortBy).toBe('name');
      expect(ascResult.sortOrder).toBe('asc');

      const descResult = pipe.transform({ sortBy: 'created_at', sortOrder: 'desc' });
      expect(descResult.sortBy).toBe('created_at');
      expect(descResult.sortOrder).toBe('desc');
    });

    it('should default sortOrder to desc when missing or invalid', () => {
      const missingOrderResult = pipe.transform({ sortBy: 'status' });
      expect(missingOrderResult.sortBy).toBe('status');
      expect(missingOrderResult.sortOrder).toBe('desc');

      const invalidOrderResult = pipe.transform({ sortBy: 'status', sortOrder: 'DROP_TABLE' });
      expect(invalidOrderResult.sortBy).toBe('status');
      expect(invalidOrderResult.sortOrder).toBe('desc');
    });

    it('should reject unwhitelisted sort fields with BadRequestException', () => {
      expect(() => pipe.transform({ sortBy: 'password_hash' })).toThrow(BadRequestException);
      expect(() => pipe.transform({ sortBy: 'id; DROP TABLE users;' })).toThrow(
        BadRequestException,
      );
      expect(() => pipe.transform({ sortBy: 'unauthorized_internal_metric' })).toThrow(
        BadRequestException,
      );
    });

    it('should support array-shorthand constructor for allowed sort fields', () => {
      const arrayPipe = new SafePaginationPipe(['created_at', 'amount']);
      expect(arrayPipe.transform({ sortBy: 'created_at' }).sortBy).toBe('created_at');
      expect(() => arrayPipe.transform({ sortBy: 'name' })).toThrow(BadRequestException);
    });
  });
});
