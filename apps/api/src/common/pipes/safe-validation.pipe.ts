import {
  ValidationPipe,
  ValidationPipeOptions,
  ArgumentMetadata,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

export const PROTECTED_MASS_ASSIGNMENT_FIELDS: readonly string[] = [
  'workspace_id',
  'workspaceId',
  'balance',
  'balances',
  'balance_micro',
  'reserved_micro',
  'is_admin',
  'isAdmin',
  'is_superadmin',
  'permissions',
];

export interface SafeValidationPipeOptions extends ValidationPipeOptions {
  /**
   * Additional protected property names that must be rejected from untrusted request bodies.
   */
  additionalProtectedFields?: string[];
  /**
   * Whether to reject or silently strip protected mass-assignment fields.
   * Default: true (strictly reject with 400 Bad Request).
   */
  rejectProtectedProperties?: boolean;
}

@Injectable()
export class SafeValidationPipe extends ValidationPipe {
  private readonly protectedFields: Set<string>;
  private readonly shouldReject: boolean;

  constructor(options?: SafeValidationPipeOptions) {
    super({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      ...options,
    });

    const fields = new Set<string>(
      PROTECTED_MASS_ASSIGNMENT_FIELDS.map((f) => f.toLowerCase()),
    );
    if (options?.additionalProtectedFields) {
      for (const field of options.additionalProtectedFields) {
        fields.add(field.toLowerCase());
      }
    }
    this.protectedFields = fields;
    this.shouldReject = options?.rejectProtectedProperties !== false;
  }

  override async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    if (metadata.type === 'body' && value && typeof value === 'object') {
      this.checkAndSanitizeProtectedFields(value);
    }
    return super.transform(value, metadata);
  }

  private checkAndSanitizeProtectedFields(target: any): void {
    if (!target || typeof target !== 'object') {
      return;
    }

    if (Array.isArray(target)) {
      for (const item of target) {
        this.checkAndSanitizeProtectedFields(item);
      }
      return;
    }

    for (const key of Object.keys(target)) {
      const normalizedKey = key.toLowerCase();
      if (this.protectedFields.has(normalizedKey)) {
        if (this.shouldReject) {
          throw new BadRequestException(
            `Mass assignment rejected: field "${key}" is protected and cannot be assigned through request body.`,
          );
        } else {
          delete target[key];
          continue;
        }
      }

      if (typeof target[key] === 'object' && target[key] !== null) {
        this.checkAndSanitizeProtectedFields(target[key]);
      }
    }
  }
}
