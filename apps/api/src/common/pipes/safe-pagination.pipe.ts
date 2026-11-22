import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

export interface SafePaginationPipeOptions {
  defaultLimit?: number;
  maxLimit?: number;
  minLimit?: number;
  allowedSortFields?: string[];
  maxSearchLength?: number;
}

export interface ValidatedPaginationQuery {
  limit: number;
  offset: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [key: string]: any;
}

@Injectable()
export class SafePaginationPipe implements PipeTransform<any, ValidatedPaginationQuery> {
  private readonly defaultLimit: number;
  private readonly maxLimit: number;
  private readonly minLimit: number;
  private readonly allowedSortFields: string[];
  private readonly maxSearchLength: number;

  constructor(options?: SafePaginationPipeOptions | string[]) {
    if (Array.isArray(options)) {
      this.defaultLimit = 50;
      this.maxLimit = 100;
      this.minLimit = 1;
      this.allowedSortFields = options;
      this.maxSearchLength = 100;
    } else {
      this.defaultLimit = options?.defaultLimit ?? 50;
      this.maxLimit = options?.maxLimit ?? 100;
      this.minLimit = options?.minLimit ?? 1;
      this.allowedSortFields = options?.allowedSortFields ?? [];
      this.maxSearchLength = options?.maxSearchLength ?? 100;
    }
  }

  transform(value: any, metadata?: ArgumentMetadata): ValidatedPaginationQuery {
    const query = value && typeof value === 'object' ? { ...value } : {};

    // 1. Limit validation
    let limit = this.defaultLimit;
    if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
      const parsedLimit = Number(query.limit);
      if (
        isNaN(parsedLimit) ||
        !Number.isInteger(parsedLimit) ||
        parsedLimit < this.minLimit ||
        parsedLimit > this.maxLimit
      ) {
        throw new BadRequestException(
          `Limit must be an integer between ${this.minLimit} and ${this.maxLimit}`,
        );
      }
      limit = parsedLimit;
    }

    // 2. Offset validation
    let offset = 0;
    if (query.offset !== undefined && query.offset !== null && query.offset !== '') {
      const parsedOffset = Number(query.offset);
      if (isNaN(parsedOffset) || !Number.isInteger(parsedOffset) || parsedOffset < 0) {
        throw new BadRequestException('Offset must be a non-negative integer (>= 0)');
      }
      offset = parsedOffset;
    }

    // 3. Search validation
    let search: string | undefined;
    if (query.search !== undefined && query.search !== null && query.search !== '') {
      const rawSearch = String(query.search).trim();
      if (rawSearch.length > this.maxSearchLength) {
        throw new BadRequestException(
          `Search query is too long (maximum ${this.maxSearchLength} characters)`,
        );
      }
      search = rawSearch || undefined;
    }

    // 4. Status normalization
    let status: string | undefined;
    if (query.status !== undefined && query.status !== null && query.status !== '') {
      const rawStatus = String(query.status).trim();
      if (rawStatus.length > 50) {
        throw new BadRequestException('Status filter is too long');
      }
      status = rawStatus || undefined;
    }

    // 5. Sorting validation
    let sortBy: string | undefined;
    let sortOrder: 'asc' | 'desc' | undefined;

    if (query.sortBy !== undefined && query.sortBy !== null && query.sortBy !== '') {
      const candidateSortBy = String(query.sortBy).trim();
      if (this.allowedSortFields.length > 0) {
        if (!this.allowedSortFields.includes(candidateSortBy)) {
          throw new BadRequestException(
            `Invalid sortBy field. Allowed fields: ${this.allowedSortFields.join(', ')}`,
          );
        }
      } else if (candidateSortBy.length > 50 || /[^a-zA-Z0-9_]/.test(candidateSortBy)) {
        throw new BadRequestException('Invalid sortBy parameter format');
      }
      sortBy = candidateSortBy;

      const rawOrder = query.sortOrder ? String(query.sortOrder).trim().toLowerCase() : 'desc';
      if (rawOrder === 'asc' || rawOrder === 'desc') {
        sortOrder = rawOrder;
      } else {
        sortOrder = 'desc';
      }
    }

    return {
      ...query,
      limit,
      offset,
      search,
      status,
      sortBy,
      sortOrder,
    };
  }
}
