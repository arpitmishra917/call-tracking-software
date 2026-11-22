import { describe, it, expect } from 'vitest';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { SafeValidationPipe, PROTECTED_MASS_ASSIGNMENT_FIELDS } from './safe-validation.pipe.js';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class TestSampleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

describe('SafeValidationPipe', () => {
  const pipe = new SafeValidationPipe();
  const bodyMetadata: ArgumentMetadata = {
    type: 'body',
    metatype: TestSampleDto,
    data: '',
  };

  describe('Mass Assignment Defense', () => {
    for (const protectedField of PROTECTED_MASS_ASSIGNMENT_FIELDS) {
      it(`should strictly reject request body containing protected property "${protectedField}"`, async () => {
        const payload = {
          name: 'Valid Name',
          [protectedField]: 'malicious_override_value',
        };

        await expect(pipe.transform(payload, bodyMetadata)).rejects.toThrow(
          BadRequestException,
        );
      });

      it(`should reject protected property "${protectedField}" in case-insensitive check`, async () => {
        const upperField = protectedField.toUpperCase();
        const payload = {
          name: 'Valid Name',
          [upperField]: 'malicious_override_value',
        };

        await expect(pipe.transform(payload, bodyMetadata)).rejects.toThrow(
          BadRequestException,
        );
      });
    }

    it('should reject nested protected field inside request body', async () => {
      const payload = {
        name: 'Valid Name',
        nested: {
          workspace_id: 'ws-evil',
        },
      };

      await expect(pipe.transform(payload, bodyMetadata)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject protected field inside array payload', async () => {
      const payload = [
        { name: 'Item 1' },
        { name: 'Item 2', balance_micro: '9999999999' },
      ];

      await expect(pipe.transform(payload, bodyMetadata)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow configurable silent stripping when rejectProtectedProperties is false', async () => {
      const strippingPipe = new SafeValidationPipe({
        rejectProtectedProperties: false,
      });

      const payload = {
        name: 'Valid Name',
        workspace_id: 'ws-attempted-injection',
      };

      const result = await strippingPipe.transform(payload, bodyMetadata);
      expect(result.name).toBe('Valid Name');
      expect((result as any).workspace_id).toBeUndefined();
    });

    it('should allow custom additional protected properties', async () => {
      const customPipe = new SafeValidationPipe({
        additionalProtectedFields: ['internal_routing_token'],
      });

      const payload = {
        name: 'Valid Name',
        internal_routing_token: 'secret',
      };

      await expect(customPipe.transform(payload, bodyMetadata)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('DTO Whitelisting & Type Transformation', () => {
    it('should strip undeclared non-whitelisted properties from DTO instances', async () => {
      const payload = {
        name: 'Allowed Campaign',
        unknownProperty: 'should be stripped',
        randomInjectedField: 12345,
      };

      const result = await pipe.transform(payload, bodyMetadata);
      expect(result.name).toBe('Allowed Campaign');
      expect((result as any).unknownProperty).toBeUndefined();
      expect((result as any).randomInjectedField).toBeUndefined();
    });

    it('should transform types according to class-transformer decorators', async () => {
      const payload = {
        name: 'Allowed Campaign',
        limit: '25',
      };

      const result = await pipe.transform(payload, bodyMetadata);
      expect(result.name).toBe('Allowed Campaign');
      expect(result.limit).toBe(25);
      expect(typeof result.limit).toBe('number');
    });

    it('should throw validation error when required field is missing or invalid', async () => {
      const payload = {
        name: '',
      };

      await expect(pipe.transform(payload, bodyMetadata)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should ignore non-body metadata types for mass assignment check', async () => {
      const queryMetadata: ArgumentMetadata = {
        type: 'query',
        data: 'workspace_id',
      };

      const result = await pipe.transform('ws-123', queryMetadata);
      expect(result).toBe('ws-123');
    });
  });
});
