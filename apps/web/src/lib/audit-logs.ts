import { apiFetch } from './api';

export interface SecurityAuditLog {
  id: string;
  workspace_id: string;
  actor_user_id?: string | null;
  actor_member_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface ListAuditLogsParams {
  limit?: number;
  offset?: number;
  action?: string;
  targetType?: string;
  targetId?: string;
  actorMemberId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ListAuditLogsResult {
  items: SecurityAuditLog[];
  total: number;
}

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'secret',
  'key',
  'jwt',
  'stripe',
  'credential',
  'auth',
  'authorization',
  'cookie',
  'cvv',
  'card',
  'account_number',
  'private',
];

/**
 * Checks if an object key represents sensitive credentials/tokens/secrets.
 * Follows the backend rule: 'permissionKey' is explicitly preserved.
 */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'permissionkey') return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Checks if a string value appears to contain raw credentials, tokens, or hashes.
 */
export function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '[REDACTED]') return false;
  if (trimmed.startsWith('Bearer ') || trimmed.startsWith('sk_') || trimmed.startsWith('pk_')) {
    return true;
  }
  // Standard JWT pattern check (header.payload.signature)
  if (/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Recursively sanitizes audit event metadata to prevent exposing secrets,
 * tokens, or sensitive information.
 */
export function sanitizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  if (Array.isArray(metadata)) {
    const sanitizedArray = metadata.map((item) => {
      if (typeof item === 'object' && item !== null) {
        return sanitizeMetadata(item);
      }
      if (isSensitiveValue(item)) {
        return '[REDACTED]';
      }
      return item;
    });
    return sanitizedArray as unknown as Record<string, unknown>;
  }

  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      safe[k] = '[REDACTED]';
    } else if (isSensitiveValue(v)) {
      safe[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      safe[k] = sanitizeMetadata(v);
    } else {
      safe[k] = v;
    }
  }

  return safe;
}

/**
 * Fetches workspace-scoped audit logs with query filters and server-side pagination.
 */
export async function listAuditLogs(
  workspaceId: string,
  params?: ListAuditLogsParams,
): Promise<ListAuditLogsResult> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  if (params?.action) query.set('action', params.action);
  if (params?.targetType) query.set('targetType', params.targetType);
  if (params?.targetId) query.set('targetId', params.targetId);
  if (params?.actorMemberId) query.set('actorMemberId', params.actorMemberId);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);

  const qs = query.toString();
  return apiFetch(`/workspaces/${workspaceId}/audit-logs${qs ? `?${qs}` : ''}`);
}
