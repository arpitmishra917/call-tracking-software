import { BadRequestException } from '@nestjs/common';

export interface PaginationParams {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function parsePaginationParams(query: any, allowedSortFields: string[] = []): PaginationParams {
  const limit = query.limit ? parseInt(query.limit, 10) : 50;
  const offset = query.offset ? parseInt(query.offset, 10) : 0;
  const search = query.search?.toString().trim();
  const status = query.status?.toString().trim();
  const sortBy = query.sortBy?.toString().trim();
  let sortOrder = query.sortOrder?.toString().trim().toLowerCase();

  if (limit < 1 || limit > 100) {
    throw new BadRequestException('Limit must be between 1 and 100');
  }
  if (offset < 0) {
    throw new BadRequestException('Offset cannot be negative');
  }
  if (search && search.length > 100) {
    throw new BadRequestException('Search string is too long');
  }

  if (sortBy) {
    if (!allowedSortFields.includes(sortBy)) {
      throw new BadRequestException(`Invalid sortBy field. Allowed fields: ${allowedSortFields.join(', ')}`);
    }
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      sortOrder = 'desc'; // default to desc if invalid
    }
  }

  return {
    search: search || undefined,
    status: status || undefined,
    limit,
    offset,
    sortBy: sortBy || undefined,
    sortOrder: (sortOrder as 'asc' | 'desc') || undefined
  };
}
