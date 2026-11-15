import { apiFetch } from './api';

export interface PaymentExecution {
  id: string;
  payment_instruction_id: string;
  attempt_number: number;
  provider: string; // 'manual' | 'wire' | 'mock'
  provider_transaction_id?: string | null;
  status: 'INITIATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  error_message?: string | null;
  failure_code?: string | null;
  initiated_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentInstruction {
  id: string;
  workspace_id: string;
  settlement_batch_id: string;
  direction: 'COLLECTION' | 'DISBURSEMENT';
  amount: number | string;
  currency: string;
  participant_type: 'BUYER' | 'VENDOR';
  buyer_id?: string | null;
  vendor_id?: string | null;
  status: 'CREATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  created_at: string;
  updated_at: string;
  settlement_batch?: {
    id: string;
    batch_number: string;
    net_amount: number | string;
    currency: string;
    settlement_status: string;
    payment_status: string;
  } | null;
  executions?: PaymentExecution[];
}

export interface ListPaymentInstructionsParams {
  limit?: number;
  offset?: number;
  status?: string;
  participant_type?: string;
  direction?: string;
}

export interface ListPaymentInstructionsResult {
  items: PaymentInstruction[];
  total: number;
  limit: number;
  offset: number;
}

export async function createPaymentInstruction(
  workspaceId: string,
  batchId: string,
): Promise<PaymentInstruction> {
  return apiFetch(`/workspaces/${workspaceId}/settlements/batches/${batchId}/payment-instruction`, {
    method: 'POST',
  });
}

export async function listPaymentInstructions(
  workspaceId: string,
  params?: ListPaymentInstructionsParams,
): Promise<ListPaymentInstructionsResult> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  if (params?.status) query.set('status', params.status);
  if (params?.participant_type) query.set('participant_type', params.participant_type);
  if (params?.direction) query.set('direction', params.direction);

  const qs = query.toString();
  return apiFetch(`/workspaces/${workspaceId}/payments/instructions${qs ? `?${qs}` : ''}`);
}

export async function getPaymentInstruction(
  workspaceId: string,
  instructionId: string,
): Promise<PaymentInstruction> {
  return apiFetch(`/workspaces/${workspaceId}/payments/instructions/${instructionId}`);
}

export async function createPaymentExecution(
  workspaceId: string,
  instructionId: string,
  data: {
    provider: 'manual' | 'wire' | 'mock';
    simulate_status?: 'SUCCEEDED' | 'FAILED';
  },
): Promise<PaymentExecution> {
  return apiFetch(`/workspaces/${workspaceId}/payments/instructions/${instructionId}/executions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function retryPaymentExecution(
  workspaceId: string,
  instructionId: string,
  data?: {
    provider?: 'manual' | 'wire' | 'mock';
    simulate_status?: 'SUCCEEDED' | 'FAILED';
  },
): Promise<PaymentExecution> {
  return apiFetch(`/workspaces/${workspaceId}/payments/instructions/${instructionId}/retry`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function getPaymentExecution(
  workspaceId: string,
  executionId: string,
): Promise<PaymentExecution> {
  return apiFetch(`/workspaces/${workspaceId}/payments/executions/${executionId}`);
}
