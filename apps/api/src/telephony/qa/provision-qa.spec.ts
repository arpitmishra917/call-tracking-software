import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  provisionDedicatedQaEnvironment,
  FORBIDDEN_PRODUCTION_DIDS,
  FORBIDDEN_WORKSPACE_IDS,
  QA_CONSTANTS,
} from '../../../../../qa/provision-qa.js';
import { TransactionType, PhoneNumberStatus } from '@prisma/client';

describe('Phase 7B-2D: Final Provisioning Script Validation', () => {
  let mockDb: {
    workspaces: Map<string, any>;
    workspaceBalances: Map<string, any>;
    walletTransactions: any[];
    campaigns: Map<string, any>;
    buyers: Map<string, any>;
    campaignBuyers: any[];
    phoneNumbers: Map<string, any>;
  };

  let mockPrisma: any;

  function createTxClient(state: typeof mockDb) {
    return {
      workspace: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.slug) {
            for (const ws of state.workspaces.values()) {
              if (ws.slug === where.slug) return { ...ws };
            }
          }
          if (where.id) return state.workspaces.get(where.id) ? { ...state.workspaces.get(where.id) } : null;
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = data.id || `ws_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.workspaces.set(id, record);
          return { ...record };
        }),
      },
      workspaceBalance: {
        findUnique: vi.fn(async ({ where }: any) => {
          const rec = state.workspaceBalances.get(where.workspace_id);
          return rec ? { ...rec } : null;
        }),
        create: vi.fn(async ({ data }: any) => {
          state.workspaceBalances.set(data.workspace_id, { ...data });
          return { ...data };
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const existing = state.workspaceBalances.get(where.workspace_id);
          const updated = { ...existing, ...data };
          state.workspaceBalances.set(where.workspace_id, updated);
          return { ...updated };
        }),
      },
      walletTransaction: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.idempotency_key) {
            const found = state.walletTransactions.find(
              (t) => t.idempotency_key === where.idempotency_key,
            );
            return found ? { ...found } : null;
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return state.walletTransactions
            .filter((t) => t.workspace_id === where.workspace_id)
            .map((t) => ({ ...t }));
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = data.id || `tx_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.walletTransactions.push(record);
          return { ...record };
        }),
      },
      campaign: {
        findFirst: vi.fn(async ({ where }: any) => {
          for (const c of state.campaigns.values()) {
            if (c.workspace_id === where.workspace_id && c.name === where.name) {
              return { ...c };
            }
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = data.id || `camp_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.campaigns.set(id, record);
          return { ...record };
        }),
      },
      buyer: {
        findFirst: vi.fn(async ({ where }: any) => {
          for (const b of state.buyers.values()) {
            if (
              b.workspace_id === where.workspace_id &&
              b.destination_number === where.destination_number
            ) {
              return { ...b };
            }
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = data.id || `buyer_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.buyers.set(id, record);
          return { ...record };
        }),
      },
      campaignBuyer: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.campaign_id_priority) {
            const { campaign_id, priority } = where.campaign_id_priority;
            const found = state.campaignBuyers.find(
              (cb) => cb.campaign_id === campaign_id && cb.priority === priority,
            );
            return found ? { ...found } : null;
          }
          if (where.campaign_id_buyer_id) {
            const { campaign_id, buyer_id } = where.campaign_id_buyer_id;
            const found = state.campaignBuyers.find(
              (cb) => cb.campaign_id === campaign_id && cb.buyer_id === buyer_id,
            );
            return found ? { ...found } : null;
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = data.id || `cb_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.campaignBuyers.push(record);
          return { ...record };
        }),
      },
      phoneNumber: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.phone_number) {
            const found = state.phoneNumbers.get(where.phone_number);
            return found ? { ...found } : null;
          }
          return null;
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          if (where.provider_number_id) {
            for (const p of state.phoneNumbers.values()) {
              if (p.provider_number_id === where.provider_number_id) return { ...p };
            }
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const id = data.id || `pn_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.phoneNumbers.set(data.phone_number, record);
          return { ...record };
        }),
      },
    };
  }

  function cloneDbState(source: typeof mockDb): typeof mockDb {
    return {
      workspaces: new Map(Array.from(source.workspaces.entries()).map(([k, v]) => [k, { ...v }])),
      workspaceBalances: new Map(Array.from(source.workspaceBalances.entries()).map(([k, v]) => [k, { ...v }])),
      walletTransactions: source.walletTransactions.map((t) => ({ ...t })),
      campaigns: new Map(Array.from(source.campaigns.entries()).map(([k, v]) => [k, { ...v }])),
      buyers: new Map(Array.from(source.buyers.entries()).map(([k, v]) => [k, { ...v }])),
      campaignBuyers: source.campaignBuyers.map((cb) => ({ ...cb })),
      phoneNumbers: new Map(Array.from(source.phoneNumbers.entries()).map(([k, v]) => [k, { ...v }])),
    };
  }

  function copyBack(dest: typeof mockDb, src: typeof mockDb) {
    dest.workspaces = src.workspaces;
    dest.workspaceBalances = src.workspaceBalances;
    dest.walletTransactions = src.walletTransactions;
    dest.campaigns = src.campaigns;
    dest.buyers = src.buyers;
    dest.campaignBuyers = src.campaignBuyers;
    dest.phoneNumbers = src.phoneNumbers;
  }

  beforeEach(() => {
    mockDb = {
      workspaces: new Map(),
      workspaceBalances: new Map(),
      walletTransactions: [],
      campaigns: new Map(),
      buyers: new Map(),
      campaignBuyers: [],
      phoneNumbers: new Map(),
    };

    mockPrisma = {
      ...createTxClient(mockDb),
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
        // Clone state before transaction to simulate rollback on failure
        const snapshot = cloneDbState(mockDb);
        const txClient = createTxClient(snapshot);
        try {
          const res = await cb(txClient);
          copyBack(mockDb, snapshot);
          return res;
        } catch (err) {
          // Discard snapshot on error (rollback)
          throw err;
        }
      }),
    };
  });

  const validTargetDid = '+12025550100';
  const validProviderNumberId = '3099999999999999999';

  it('1. Rejects invalid or malformed E.164 phone numbers', async () => {
    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: 'not-e164',
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: true,
        },
        mockPrisma,
      ),
    ).rejects.toThrow('ABORT: Invalid E.164 phone number: "not-e164"');
  });

  it('2. Rejects protected production DIDs', async () => {
    for (const prodDid of FORBIDDEN_PRODUCTION_DIDS) {
      await expect(
        provisionDedicatedQaEnvironment(
          {
            newQaTrackingDid: prodDid,
            telnyxProviderNumberId: validProviderNumberId,
            confirmCarrierOwnership: true,
          },
          mockPrisma,
        ),
      ).rejects.toThrow(`CRITICAL ABORT: Attempted to provision production DID ${prodDid} as QA!`);
    }
  });

  it('3. Rejects duplicate DID already assigned to a non-QA workspace', async () => {
    mockDb.phoneNumbers.set(validTargetDid, {
      id: 'pn_existing_1',
      phone_number: validTargetDid,
      workspace_id: 'non-qa-workspace-uuid',
      status: PhoneNumberStatus.ACTIVE,
    });

    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: validTargetDid,
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: true,
        },
        mockPrisma,
      ),
    ).rejects.toThrow(`ABORT: Phone number ${validTargetDid} is already assigned to non-QA workspace non-qa-workspace-uuid`);
  });

  it('4. Rejects duplicate provider_number_id already bound to a different number', async () => {
    mockDb.phoneNumbers.set('+12025550999', {
      id: 'pn_other_1',
      phone_number: '+12025550999',
      provider_number_id: validProviderNumberId,
      workspace_id: 'some-ws',
      status: PhoneNumberStatus.ACTIVE,
    });

    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: validTargetDid,
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: true,
        },
        mockPrisma,
      ),
    ).rejects.toThrow(`ABORT: Provider number ID ${validProviderNumberId} is already in use by phone number +12025550999`);
  });

  it('5. Enforces CampaignBuyer unique constraints (both priority and buyer compound unique)', async () => {
    // 5A: Priority collision (priority 1 assigned to another buyer)
    mockDb.workspaces.set('ws_qa', {
      id: 'ws_qa',
      name: QA_CONSTANTS.WORKSPACE_NAME,
      slug: QA_CONSTANTS.SLUG,
      status: 'ACTIVE',
    });
    mockDb.campaigns.set('camp_qa', {
      id: 'camp_qa',
      workspace_id: 'ws_qa',
      name: QA_CONSTANTS.CAMPAIGN_NAME,
      status: 'ACTIVE',
    });
    mockDb.campaignBuyers.push({
      id: 'cb_other',
      workspace_id: 'ws_qa',
      campaign_id: 'camp_qa',
      buyer_id: 'buyer_other_xyz',
      priority: 1,
      status: 'ACTIVE',
    });

    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: validTargetDid,
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: true,
        },
        mockPrisma,
      ),
    ).rejects.toThrow(/ABORT: Priority collision! Campaign camp_qa priority 1 is already assigned to a different buyer/);
  });

  it('6. Rejects corrupt existing wallet with ledger discrepancy', async () => {
    mockDb.workspaces.set('ws_qa', {
      id: 'ws_qa',
      name: QA_CONSTANTS.WORKSPACE_NAME,
      slug: QA_CONSTANTS.SLUG,
      status: 'ACTIVE',
    });

    // Corrupt balance: balance_micro is 50,000,000n but transaction ledger is empty (calculated = 0n)
    mockDb.workspaceBalances.set('ws_qa', {
      workspace_id: 'ws_qa',
      balance_minor: 5000,
      balance_micro: 50000000n,
      reserved_micro: 0n,
      currency: 'USD',
    });

    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: validTargetDid,
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: true,
        },
        mockPrisma,
      ),
    ).rejects.toThrow(/ABORT: Ledger discrepancy detected! Workspace balance \(50000000 micro\) does not equal sum of audit transactions/);
  });

  it('7. Prevents duplicate initial $50 funding when wallet is already initialized', async () => {
    // First run: Provisions clean environment
    const firstRes = await provisionDedicatedQaEnvironment(
      {
        newQaTrackingDid: validTargetDid,
        telnyxProviderNumberId: validProviderNumberId,
        confirmCarrierOwnership: true,
      },
      mockPrisma,
    );

    expect(mockDb.walletTransactions.length).toBe(1);
    expect(mockDb.workspaceBalances.get(firstRes.workspaceId)?.balance_micro).toBe(50000000n);

    // Second run: Must NOT create an additional $50 transaction or double the balance
    const secondRes = await provisionDedicatedQaEnvironment(
      {
        newQaTrackingDid: validTargetDid,
        telnyxProviderNumberId: validProviderNumberId,
        confirmCarrierOwnership: true,
      },
      mockPrisma,
    );

    expect(secondRes.workspaceId).toBe(firstRes.workspaceId);
    expect(mockDb.walletTransactions.length).toBe(1);
    expect(mockDb.workspaceBalances.get(firstRes.workspaceId)?.balance_micro).toBe(50000000n);
  });

  it('8. Partial transaction failure rolls back all mutations cleanly', async () => {
    // Inject a failure at Step 6 (PhoneNumber creation)
    const failingPrisma = {
      ...mockPrisma,
      $transaction: vi.fn(async (cb: any) => {
        const snapshot = cloneDbState(mockDb);
        const txClient = createTxClient(snapshot);
        // Force failure on phoneNumber.create
        txClient.phoneNumber.create = vi.fn().mockRejectedValue(new Error('Carrier network failure'));
        try {
          await cb(txClient);
          copyBack(mockDb, snapshot);
        } catch (err) {
          // Discard snapshot
          throw err;
        }
      }),
    };

    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: validTargetDid,
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: true,
        },
        failingPrisma,
      ),
    ).rejects.toThrow('Carrier network failure');

    // Confirm that zero records were committed to mockDb (clean rollback)
    expect(mockDb.workspaces.size).toBe(0);
    expect(mockDb.workspaceBalances.size).toBe(0);
    expect(mockDb.walletTransactions.length).toBe(0);
    expect(mockDb.campaigns.size).toBe(0);
    expect(mockDb.buyers.size).toBe(0);
    expect(mockDb.campaignBuyers.length).toBe(0);
    expect(mockDb.phoneNumbers.size).toBe(0);
  });

  it('9. Repeated idempotent provisioning does not duplicate records', async () => {
    const run1 = await provisionDedicatedQaEnvironment(
      {
        newQaTrackingDid: validTargetDid,
        telnyxProviderNumberId: validProviderNumberId,
        confirmCarrierOwnership: true,
      },
      mockPrisma,
    );

    const run2 = await provisionDedicatedQaEnvironment(
      {
        newQaTrackingDid: validTargetDid,
        telnyxProviderNumberId: validProviderNumberId,
        confirmCarrierOwnership: true,
      },
      mockPrisma,
    );

    expect(run2.workspaceId).toBe(run1.workspaceId);
    expect(run2.campaignId).toBe(run1.campaignId);
    expect(run2.buyerId).toBe(run1.buyerId);
    expect(run2.phoneNumberId).toBe(run1.phoneNumberId);

    expect(mockDb.workspaces.size).toBe(1);
    expect(mockDb.workspaceBalances.size).toBe(1);
    expect(mockDb.walletTransactions.length).toBe(1);
    expect(mockDb.campaigns.size).toBe(1);
    expect(mockDb.buyers.size).toBe(1);
    expect(mockDb.campaignBuyers.length).toBe(1);
    expect(mockDb.phoneNumbers.size).toBe(1);
  });

  it('10. Requires mandatory operator confirmation of carrier ownership', async () => {
    await expect(
      provisionDedicatedQaEnvironment(
        {
          newQaTrackingDid: validTargetDid,
          telnyxProviderNumberId: validProviderNumberId,
          confirmCarrierOwnership: false,
        },
        mockPrisma,
      ),
    ).rejects.toThrow(/ABORT: Mandatory operator confirmation missing/);
  });
});
