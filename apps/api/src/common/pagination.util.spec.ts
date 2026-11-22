import { describe, it, expect } from 'vitest';
import { parsePaginationParams } from './pagination.util.js';
import { BadRequestException } from '@nestjs/common';

describe('Pagination Utility', () => {
  describe('parsePaginationParams', () => {
    it('should parse valid pagination params with defaults', () => {
      const result = parsePaginationParams({});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(result.search).toBeUndefined();
      expect(result.sortBy).toBeUndefined();
      expect(result.sortOrder).toBeUndefined();
    });

    it('should parse valid offset and limit', () => {
      const result = parsePaginationParams({ offset: '20', limit: '10' });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should throw on excessive limit', () => {
      expect(() => parsePaginationParams({ limit: '200' })).toThrow(BadRequestException);
    });

    it('should throw on negative offset', () => {
      expect(() => parsePaginationParams({ offset: '-1' })).toThrow(BadRequestException);
    });

    it('should throw on negative limit', () => {
      expect(() => parsePaginationParams({ limit: '-5' })).toThrow(BadRequestException);
    });

    it('should process valid search', () => {
      const result = parsePaginationParams({ search: 'test query' });
      expect(result.search).toBe('test query');
    });

    it('should throw on excessively long search string', () => {
      const longString = 'a'.repeat(101);
      expect(() => parsePaginationParams({ search: longString })).toThrow(BadRequestException);
    });

    it('should process valid sortBy and sortOrder', () => {
      const result = parsePaginationParams({ sortBy: 'created_at', sortOrder: 'asc' }, ['created_at', 'name']);
      expect(result.sortBy).toBe('created_at');
      expect(result.sortOrder).toBe('asc');
    });

    it('should throw on unwhitelisted sortBy', () => {
      expect(() => parsePaginationParams({ sortBy: 'password' }, ['created_at'])).toThrow(BadRequestException);
    });

    it('should default invalid sortOrder to desc', () => {
      const result = parsePaginationParams({ sortBy: 'name', sortOrder: 'DROP TABLE' }, ['name']);
      expect(result.sortOrder).toBe('desc');
    });
  });
});
