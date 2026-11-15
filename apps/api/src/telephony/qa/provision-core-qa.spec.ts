import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  provisionCoreQaWorkspace,
  validateQaDatabaseTarget,
  FORBIDDEN_WORKSPACE_IDS,
  QA_CONSTANTS,
} from '../../../../../qa/provision-qa.js';
import { TransactionType } from '@prisma/client';

describe('Phase 7B-4D: Core QA Workspace Provisioning (Stage A Mocked Tests)', () => {
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
  let errorToInject: Error | null = null;

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
            if (where.workspace_id) {
              if (c.workspace_id === where.workspace_id && c.name === where.name) {
                return { ...c };
              }
            } else if (where.name && c.name === where.name) {
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
            if (where.destination_number && b.destination_number === where.destination_number) {
              if (where.workspace_id) {
                if (b.workspace_id === where.workspace_id) return { ...b };
              } else {
                return { ...b };
              }
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
          if (errorToInject) throw errorToInject;
          const id = data.id || `cb_${Date.now()}_${Math.random()}`;
          const record = { id, ...data };
          state.campaignBuyers.push(record);
          return { ...record };
        }),
      },
      phoneNumber: {
        count: vi.fn(async ({ where }: any) => {
          let count = 0;
          for (const p of state.phoneNumbers.values()) {
            if (where.workspace_id && p.workspace_id === where.workspace_id) count++;
          }
          return count;
        }),
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.phone_number) {
            const found = state.phoneNumbers.get(where.phone_number);
            return found ? { ...found } : null;
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
    errorToInject = null;
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
        const snapshot = cloneDbState(mockDb);
        const txWorkingState = cloneDbState(mockDb);
        const txClient = createTxClient(txWorkingState);

        try {
          const result = await cb(txClient);
          copyBack(mockDb, txWorkingState);
          return result;
        } catch (err) {
          copyBack(mockDb, snapshot);
          throw err;
        }
      }),
    };
  });

  // Test 1: Core workspace creation
  it('1. should create fresh core QA workspace and associated records', async () => {
    const res = await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    expect(res.stage).toBe('STAGE_A_CORE_COMPLETE');
    expect(res.workspaceId).toBeDefined();
    expect(res.campaignId).toBeDefined();
    expect(res.buyerId).toBeDefined();
    expect(res.balanceMicro).toBe(0n);
    expect(res.phoneNumberAssigned).toBe(false);

    // Verify workspace
    const ws = mockDb.workspaces.get(res.workspaceId);
    expect(ws).toBeDefined();
    expect(ws.slug).toBe(QA_CONSTANTS.SLUG);
    expect(ws.status).toBe('ACTIVE');

    // Verify balance
    const bal = mockDb.workspaceBalances.get(res.workspaceId);
    expect(bal).toBeDefined();
    expect(bal.balance_minor).toBe(0);
    expect(bal.balance_micro).toBe(0n);

    // Verify campaign
    const camp = mockDb.campaigns.get(res.campaignId);
    expect(camp).toBeDefined();
    expect(camp.workspace_id).toBe(res.workspaceId);
    expect(camp.status).toBe('ACTIVE');

    // Verify buyer
    const buyer = mockDb.buyers.get(res.buyerId);
    expect(buyer).toBeDefined();
    expect(buyer.destination_number).toBe(QA_CONSTANTS.LOGICAL_QA_BUYER_CLI);
    expect(buyer.status).toBe('ACTIVE');

    // Verify campaign buyer mapping
    expect(mockDb.campaignBuyers.length).toBe(1);
    expect(mockDb.campaignBuyers[0].priority).toBe(1);
    expect(mockDb.campaignBuyers[0].status).toBe('ACTIVE');
  });

  // Test 2: Repeat execution idempotency
  it('2. should be fully idempotent when re-executed without duplicating records', async () => {
    const firstRun = await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    const secondRun = await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    expect(secondRun.workspaceId).toBe(firstRun.workspaceId);
    expect(secondRun.campaignId).toBe(firstRun.campaignId);
    expect(secondRun.buyerId).toBe(firstRun.buyerId);
    expect(mockDb.workspaces.size).toBe(1);
    expect(mockDb.campaigns.size).toBe(1);
    expect(mockDb.buyers.size).toBe(1);
    expect(mockDb.campaignBuyers.length).toBe(1);
    expect(mockDb.workspaceBalances.size).toBe(1);
  });

  // Test 3: Foreign workspace rejection
  it('3. should reject provisioning if slug collides with protected production workspace', async () => {
    mockDb.workspaces.set('5c3d8331-04a6-4264-888f-d0ebf57e3c7d', {
      id: '5c3d8331-04a6-4264-888f-d0ebf57e3c7d',
      name: 'Production Workspace xyz',
      slug: QA_CONSTANTS.SLUG,
      status: 'ACTIVE',
    });

    await expect(
      provisionCoreQaWorkspace({
        prismaOverride: mockPrisma,
        skipDbTargetValidation: true,
      }),
    ).rejects.toThrow(/CRITICAL ABORT: QA slug matches protected production workspace/);
  });

  // Test 4: Campaign ownership validation
  it('4. should reject existing QA campaign if owned by a different workspace', async () => {
    const ws = { id: 'ws_qa', name: QA_CONSTANTS.WORKSPACE_NAME, slug: QA_CONSTANTS.SLUG, status: 'ACTIVE' };
    mockDb.workspaces.set(ws.id, ws);
    mockDb.campaigns.set('camp_rogue', {
      id: 'camp_rogue',
      workspace_id: 'ws_foreign',
      name: QA_CONSTANTS.CAMPAIGN_NAME,
      status: 'ACTIVE',
    });

    await expect(
      provisionCoreQaWorkspace({
        prismaOverride: mockPrisma,
        skipDbTargetValidation: true,
      }),
    ).rejects.toThrow(/Campaign ownership mismatch/);
  });

  // Test 5: Buyer ownership validation
  it('5. should reject existing Logical QA Buyer if owned by a different workspace', async () => {
    const ws = { id: 'ws_qa', name: QA_CONSTANTS.WORKSPACE_NAME, slug: QA_CONSTANTS.SLUG, status: 'ACTIVE' };
    mockDb.workspaces.set(ws.id, ws);
    mockDb.buyers.set('buyer_rogue', {
      id: 'buyer_rogue',
      workspace_id: 'ws_foreign',
      name: QA_CONSTANTS.BUYER_NAME,
      destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI,
      status: 'ACTIVE',
    });

    await expect(
      provisionCoreQaWorkspace({
        prismaOverride: mockPrisma,
        skipDbTargetValidation: true,
      }),
    ).rejects.toThrow(/Logical QA Buyer destination number .* is assigned to non-QA workspace/);
  });

  // Test 6: CampaignBuyer priority collision
  it('6. should reject provisioning if Campaign priority 1 is already assigned to a different buyer', async () => {
    const ws = { id: 'ws_qa', name: QA_CONSTANTS.WORKSPACE_NAME, slug: QA_CONSTANTS.SLUG, status: 'ACTIVE' };
    const camp = { id: 'camp_qa', workspace_id: ws.id, name: QA_CONSTANTS.CAMPAIGN_NAME, status: 'ACTIVE' };
    mockDb.workspaces.set(ws.id, ws);
    mockDb.campaigns.set(camp.id, camp);
    mockDb.campaignBuyers.push({
      id: 'cb_existing',
      campaign_id: camp.id,
      buyer_id: 'buyer_different',
      priority: 1,
      status: 'ACTIVE',
    });

    await expect(
      provisionCoreQaWorkspace({
        prismaOverride: mockPrisma,
        skipDbTargetValidation: true,
      }),
    ).rejects.toThrow(/Priority collision! Campaign .* priority 1 is already assigned to a different buyer/);
  });

  // Test 7: Duplicate buyer mapping
  it('7. should reconcile existing valid CampaignBuyer mapping without error', async () => {
    const ws = { id: 'ws_qa', name: QA_CONSTANTS.WORKSPACE_NAME, slug: QA_CONSTANTS.SLUG, status: 'ACTIVE' };
    const camp = { id: 'camp_qa', workspace_id: ws.id, name: QA_CONSTANTS.CAMPAIGN_NAME, status: 'ACTIVE' };
    const buyer = { id: 'buyer_qa', workspace_id: ws.id, name: QA_CONSTANTS.BUYER_NAME, destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI, status: 'ACTIVE' };
    mockDb.workspaces.set(ws.id, ws);
    mockDb.campaigns.set(camp.id, camp);
    mockDb.buyers.set(buyer.id, buyer);
    mockDb.campaignBuyers.push({
      id: 'cb_existing',
      workspace_id: ws.id,
      campaign_id: camp.id,
      buyer_id: buyer.id,
      priority: 1,
      status: 'ACTIVE',
    });

    const res = await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    expect(res.campaignId).toBe(camp.id);
    expect(res.buyerId).toBe(buyer.id);
    expect(mockDb.campaignBuyers.length).toBe(1);
  });

  // Test 8: Zero wallet balance
  it('8. should initialize WorkspaceBalance with exactly zero balance (micro and minor)', async () => {
    const res = await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    const bal = mockDb.workspaceBalances.get(res.workspaceId);
    expect(bal.balance_minor).toBe(0);
    expect(bal.balance_micro).toBe(0n);
    expect(bal.reserved_micro).toBe(0n);
    expect(bal.currency).toBe('USD');
  });

  // Test 9: No wallet credit transaction
  it('9. should NOT create any walletTransaction record in Stage A', async () => {
    await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    expect(mockDb.walletTransactions.length).toBe(0);
  });

  // Test 10: No PhoneNumber creation
  it('10. should NOT create any PhoneNumber record in Stage A', async () => {
    await provisionCoreQaWorkspace({
      prismaOverride: mockPrisma,
      skipDbTargetValidation: true,
    });

    expect(mockDb.phoneNumbers.size).toBe(0);
  });

  // Test 11: Production database target rejection
  it('11. should strictly reject production Supabase or invalid host targets', () => {
    expect(() =>
      validateQaDatabaseTarget('postgresql://postgres.uwycbvnqnpnfisvvbabu:pass@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'),
    ).toThrow(/Production database pattern .* detected in DATABASE_URL/);

    expect(() =>
      validateQaDatabaseTarget('postgresql://user:pass@127.0.0.1:5432/callflow_qa'),
    ).toThrow(/Database port "5432" is not the isolated QA port 5433/);

    expect(() =>
      validateQaDatabaseTarget('postgresql://callflow_qa_user:pass@127.0.0.1:5433/wrong_db'),
    ).toThrow(/Database name "wrong_db" is not "callflow_qa"/);

    expect(() =>
      validateQaDatabaseTarget('postgresql://wrong_user:pass@127.0.0.1:5433/callflow_qa'),
    ).toThrow(/Database username "wrong_user" is not "callflow_qa_user"/);
  });

  // Test 12: Transaction rollback
  it('12. should atomically roll back all changes if an error occurs mid-transaction', async () => {
    errorToInject = new Error('Simulated atomic crash');

    await expect(
      provisionCoreQaWorkspace({
        prismaOverride: mockPrisma,
        skipDbTargetValidation: true,
      }),
    ).rejects.toThrow('Simulated atomic crash');

    // Confirm that workspace, balance, campaign, buyer were completely rolled back
    expect(mockDb.workspaces.size).toBe(0);
    expect(mockDb.workspaceBalances.size).toBe(0);
    expect(mockDb.campaigns.size).toBe(0);
    expect(mockDb.buyers.size).toBe(0);
    expect(mockDb.campaignBuyers.length).toBe(0);
  });
});
