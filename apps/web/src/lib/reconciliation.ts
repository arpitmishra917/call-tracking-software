import { apiFetch } from './api';

export interface ReconciliationIssue {
  id: string;
  reconciliation_run_id: string;
  issue_type: 'SUM_MISMATCH' | 'DUPLICATE_CALL' | 'CURRENCY_MISMATCH' | 'MISSING_PAYMENT';
  description: string;
  call_commercial_id?: string | null;
  expected_amount?: number | string | null;
  actual_amount?: number | string | null;
  created_at: string;
}

export interface ReconciliationRun {
  id: string;
  workspace_id: string;
  run_type: 'BATCH_LEVEL' | 'WORKSPACE_LEVEL';
  settlement_batch_id?: string | null;
  status: 'UNRECONCILED' | 'RECONCILED' | 'DISCREPANCY';
  items_checked: number;
  discrepancy_count: number;
  created_at: string;
  updated_at: string;
  settlement_batch?: {
    id: string;
    batch_number: string;
    net_amount: number | string;
    currency: string;
    settlement_status: string;
    reconciliation_status: string;
  } | null;
  issues?: ReconciliationIssue[];
}

export interface ListReconciliationRunsParams {
  limit?: number;
  offset?: number;
  run_type?: string;
  status?: string;
}

export interface ListReconciliationRunsResult {
  items: ReconciliationRun[];
  total: number;
  limit: number;
  offset: number;
}

export async function runBatchReconciliation(
  workspaceId: string,
  batchId: string,
): Promise<ReconciliationRun> {
  return apiFetch(`/workspaces/${workspaceId}/reconciliation/batches/${batchId}/run`, {
    method: 'POST',
  });
}

export async function runWorkspaceReconciliation(
  workspaceId: string,
): Promise<ReconciliationRun> {
  return apiFetch(`/workspaces/${workspaceId}/reconciliation/run`, {
    method: 'POST',
  });
}

export async function listReconciliationRuns(
  workspaceId: string,
  params?: ListReconciliationRunsParams,
): Promise<ListReconciliationRunsResult> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  if (params?.run_type) query.set('run_type', params.run_type);
  if (params?.status) query.set('status', params.status);

  const qs = query.toString();
  return apiFetch(`/workspaces/${workspaceId}/reconciliation/runs${qs ? `?${qs}` : ''}`);
}

export async function getReconciliationRun(
  workspaceId: string,
  runId: string,
): Promise<ReconciliationRun> {
  return apiFetch(`/workspaces/${workspaceId}/reconciliation/runs/${runId}`);
}

export async function listReconciliationIssues(
  workspaceId: string,
  runId: string,
): Promise<ReconciliationIssue[]> {
  return apiFetch(`/workspaces/${workspaceId}/reconciliation/runs/${runId}/issues`);
}
