/**
 * CallFlow Phase 7B-4D: QA Workspace Provisioning Architecture (Two-Stage Decoupled) - CommonJS
 * 
 * STRICT ARCHITECTURAL & FINANCIAL CONSTRAINTS:
 * - Stage A: Core QA Workspace (Zero balance, 0 credit transactions, no carrier DID, no PhoneNumber)
 * - Stage B: Carrier Attachment (Requires real dedicated Telnyx DID, provider_number_id, Call Control App ID)
 * - Target Database Guard: Mandates apps/api/.env.qa targeting 127.0.0.1:5433/callflow_qa
 * - Hard rejection of Supabase project "uwycbvnqnpnfisvvbabu" and production DIDs (+14845560110, etc.)
 * - Zero top-level PrismaClient instantiation on module import
 * - Full transactional rollback and compound constraint enforcement
 */
const { PrismaClient, TransactionType, PhoneNumberStatus } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

// Production Protected Values (HARD SAFETY BOUNDARIES)
const FORBIDDEN_PRODUCTION_DIDS = new Set([
  '+14845560110',
  '+17658268661',
  '+13215033884',
  '+18668300066',
]);

const FORBIDDEN_WORKSPACE_IDS = new Set([
  '5c3d8331-04a6-4264-888f-d0ebf57e3c7d', // production workspace xyz
]);

const FORBIDDEN_HOST_PATTERNS = [
  'supabase.co',
  'uwycbvnqnpnfisvvbabu',
  'aws-0-ap-northeast-1',
];

const QA_CONSTANTS = {
  SLUG: 'callflow-qa-autonomous',
  WORKSPACE_NAME: 'CallFlow QA Autonomous Workspace',
  CAMPAIGN_NAME: 'QA Autonomous Telephony Campaign',
  BUYER_NAME: 'QA Test SIP Buyer',
  LOGICAL_QA_BUYER_CLI: '+12025550199',
  DEFAULT_PORT: '5433',
  DEFAULT_DB_NAME: 'callflow_qa',
  DEFAULT_USER: 'callflow_qa_user',
  DEFAULT_FUNDING_MICRO: 50000000n,
};

/**
 * Validates that the target database is strictly the isolated local QA database.
 * Rejects any production Supabase or ambiguous host.
 */
function validateQaDatabaseTarget(customUrl) {
  let targetUrl = customUrl;
  if (!targetUrl) {
    const envQaPath = path.resolve(process.cwd(), 'apps/api/.env.qa');
    if (!fs.existsSync(envQaPath)) {
      throw new Error(
        'CRITICAL ABORT: apps/api/.env.qa not found. QA provisioning must target the isolated QA database.',
      );
    }
    const envContent = fs.readFileSync(envQaPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DATABASE_URL=')) {
        targetUrl = trimmed.slice('DATABASE_URL='.length).trim();
        break;
      }
    }
  }

  if (!targetUrl) {
    throw new Error('CRITICAL ABORT: DATABASE_URL not found in apps/api/.env.qa');
  }

  // Reject Supabase / production patterns
  for (const pat of FORBIDDEN_HOST_PATTERNS) {
    if (targetUrl.includes(pat)) {
      throw new Error(
        `CRITICAL ABORT: Production database pattern "${pat}" detected in DATABASE_URL! Refusing to execute on production database.`,
      );
    }
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (err) {
    throw new Error(`CRITICAL ABORT: Malformed DATABASE_URL: ${err.message}`);
  }

  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `CRITICAL ABORT: Database host "${parsed.hostname}" is not an authorized local QA host (must be 127.0.0.1 or localhost)`,
    );
  }

  if (parsed.port !== QA_CONSTANTS.DEFAULT_PORT) {
    throw new Error(
      `CRITICAL ABORT: Database port "${parsed.port}" is not the isolated QA port ${QA_CONSTANTS.DEFAULT_PORT}`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName !== QA_CONSTANTS.DEFAULT_DB_NAME) {
    throw new Error(
      `CRITICAL ABORT: Database name "${dbName}" is not "${QA_CONSTANTS.DEFAULT_DB_NAME}"`,
    );
  }

  if (parsed.username !== QA_CONSTANTS.DEFAULT_USER) {
    throw new Error(
      `CRITICAL ABORT: Database username "${parsed.username}" is not "${QA_CONSTANTS.DEFAULT_USER}"`,
    );
  }

  return {
    url: targetUrl,
    host: parsed.hostname,
    port: parsed.port,
    db: dbName,
    user: parsed.username,
  };
}

/**
 * Lazy PrismaClient factory. Never creates a client targeting production.
 */
function getPrismaClient(override, skipTargetValidation = false) {
  if (override) return override;
  if (!skipTargetValidation) {
    const target = validateQaDatabaseTarget();
    return new PrismaClient({ datasources: { db: { url: target.url } } });
  }
  return new PrismaClient();
}

/**
 * =============================================================================
 * STAGE A: Core QA Workspace Provisioning (Carrier-Decoupled & Zero-Funding)
 * =============================================================================
 */
async function provisionCoreQaWorkspace(options) {
  console.log('=== [CallFlow QA] Stage A: Core Workspace Provisioning ===');

  if (!options?.skipDbTargetValidation && !options?.prismaOverride) {
    const target = validateQaDatabaseTarget();
    console.log(`[PASS] Database target verified: ${target.user}@${target.host}:${target.port}/${target.db}`);
  }

  const prisma = getPrismaClient(options?.prismaOverride, options?.skipDbTargetValidation);

  const result = await prisma.$transaction(async (tx) => {
    // -------------------------------------------------------------------------
    // STEP 1: Create or Retrieve Dedicated QA Workspace
    // -------------------------------------------------------------------------
    let workspace = await tx.workspace.findUnique({
      where: { slug: QA_CONSTANTS.SLUG },
    });

    if (workspace) {
      if (FORBIDDEN_WORKSPACE_IDS.has(workspace.id)) {
        throw new Error('CRITICAL ABORT: QA slug matches protected production workspace!');
      }
      if (workspace.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing QA workspace ${workspace.id} has unexpected status: "${workspace.status}". Expected "ACTIVE".`,
        );
      }
      if (workspace.name !== QA_CONSTANTS.WORKSPACE_NAME) {
        throw new Error(
          `ABORT: Existing QA workspace name mismatch. Expected "${QA_CONSTANTS.WORKSPACE_NAME}", found "${workspace.name}".`,
        );
      }
      console.log(`[INFO] Existing verified QA workspace found: ${workspace.id}`);
    } else {
      workspace = await tx.workspace.create({
        data: {
          name: QA_CONSTANTS.WORKSPACE_NAME,
          slug: QA_CONSTANTS.SLUG,
          status: 'ACTIVE',
        },
      });
      console.log(`[1/5] Created QA Workspace: ${workspace.id}`);
    }

    const workspaceId = workspace.id;

    // -------------------------------------------------------------------------
    // STEP 2: Initialize or Verify Zero Wallet Balance (Ledger-Consistent)
    // -------------------------------------------------------------------------
    let balance = await tx.workspaceBalance.findUnique({
      where: { workspace_id: workspaceId },
    });

    if (balance) {
      if (balance.balance_micro !== 0n || balance.balance_minor !== 0) {
        throw new Error(
          `ABORT: Stage A expects zero wallet balance, but existing balance is ${balance.balance_micro} micro (${balance.balance_minor} minor).`,
        );
      }

      const txs = await tx.walletTransaction.findMany({
        where: { workspace_id: workspaceId },
      });
      let calculatedMicro = 0n;
      for (const t of txs) {
        if (t.type === TransactionType.CREDIT || t.type === TransactionType.REFUND) {
          calculatedMicro += t.amount_micro;
        } else if (t.type === TransactionType.DEBIT) {
          calculatedMicro -= t.amount_micro;
        }
      }

      if (calculatedMicro !== 0n) {
        throw new Error(
          `ABORT: Ledger discrepancy! Sum of audit transactions (${calculatedMicro} micro) is not zero.`,
        );
      }
      console.log(`[INFO] QA Wallet balance verified consistent: $0.00 (0 micro-units, 0 transactions)`);
    } else {
      balance = await tx.workspaceBalance.create({
        data: {
          workspace_id: workspaceId,
          balance_minor: 0,
          balance_micro: 0n,
          reserved_micro: 0n,
          currency: 'USD',
        },
      });
      console.log(`[2/5] QA Wallet initialized with zero balance: $0.00 (0 micro-units)`);
    }

    // -------------------------------------------------------------------------
    // STEP 3: Create or Retrieve Dedicated QA Campaign (Ownership & Status Guard)
    // -------------------------------------------------------------------------
    const existingGlobalCampaign = await tx.campaign.findFirst({
      where: { name: QA_CONSTANTS.CAMPAIGN_NAME },
    });
    if (existingGlobalCampaign && existingGlobalCampaign.workspace_id !== workspaceId) {
      throw new Error(
        `ABORT: Campaign ownership mismatch for ${existingGlobalCampaign.id} (owned by ${existingGlobalCampaign.workspace_id})`,
      );
    }

    let campaign = await tx.campaign.findFirst({
      where: { workspace_id: workspaceId, name: QA_CONSTANTS.CAMPAIGN_NAME },
    });

    if (campaign) {
      if (campaign.workspace_id !== workspaceId) {
        throw new Error(`ABORT: Campaign ownership mismatch for ${campaign.id}`);
      }
      if (campaign.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing QA Campaign ${campaign.id} is not ACTIVE (status: ${campaign.status})`,
        );
      }
      console.log(`[INFO] Existing QA Campaign verified: ${campaign.id}`);
    } else {
      campaign = await tx.campaign.create({
        data: {
          workspace_id: workspaceId,
          name: QA_CONSTANTS.CAMPAIGN_NAME,
          status: 'ACTIVE',
          conversion_duration_secs: 90,
          duplicate_window_secs: 2592000,
          default_payout_amount: 1.0,
          currency: 'USD',
        },
      });
      console.log(`[3/5] QA Campaign created: ${campaign.id}`);
    }

    // -------------------------------------------------------------------------
    // STEP 4: Create or Retrieve Logical QA Buyer
    // -------------------------------------------------------------------------
    const existingGlobalBuyer = await tx.buyer.findFirst({
      where: { destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI },
    });
    if (existingGlobalBuyer && existingGlobalBuyer.workspace_id !== workspaceId) {
      throw new Error(
        `ABORT: Logical QA Buyer destination number ${QA_CONSTANTS.LOGICAL_QA_BUYER_CLI} is assigned to non-QA workspace ${existingGlobalBuyer.workspace_id}`,
      );
    }

    let buyer = await tx.buyer.findFirst({
      where: {
        workspace_id: workspaceId,
        destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI,
      },
    });

    if (buyer) {
      if (buyer.workspace_id !== workspaceId) {
        throw new Error(`ABORT: Buyer ownership mismatch for ${buyer.id}`);
      }
      if (buyer.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing Logical QA Buyer ${buyer.id} is not ACTIVE (status: ${buyer.status})`,
        );
      }
      console.log(`[INFO] Existing Logical QA Buyer verified: ${buyer.id}`);
    } else {
      buyer = await tx.buyer.create({
        data: {
          workspace_id: workspaceId,
          name: QA_CONSTANTS.BUYER_NAME,
          destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI,
          status: 'ACTIVE',
          timeout: 30,
          max_concurrent_calls: 1,
        },
      });
      console.log(`[4/5] Logical QA Buyer created: ${buyer.id} -> ${QA_CONSTANTS.LOGICAL_QA_BUYER_CLI}`);
    }

    // -------------------------------------------------------------------------
    // STEP 5: Map Campaign to Buyer with Priority Collision & Compound Constraints
    // -------------------------------------------------------------------------
    const priorityCollision = await tx.campaignBuyer.findUnique({
      where: {
        campaign_id_priority: {
          campaign_id: campaign.id,
          priority: 1,
        },
      },
    });

    if (priorityCollision && priorityCollision.buyer_id !== buyer.id) {
      throw new Error(
        `ABORT: Priority collision! Campaign ${campaign.id} priority 1 is already assigned to a different buyer (${priorityCollision.buyer_id}).`,
      );
    }

    const existingMapping = await tx.campaignBuyer.findUnique({
      where: {
        campaign_id_buyer_id: {
          campaign_id: campaign.id,
          buyer_id: buyer.id,
        },
      },
    });

    if (existingMapping) {
      if (existingMapping.workspace_id !== workspaceId) {
        throw new Error('ABORT: CampaignBuyer mapping ownership mismatch');
      }
      if (existingMapping.priority !== 1) {
        throw new Error(
          `ABORT: Existing CampaignBuyer mapping has invalid priority ${existingMapping.priority}. Expected 1.`,
        );
      }
      if (existingMapping.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing CampaignBuyer mapping is not ACTIVE (status: ${existingMapping.status})`,
        );
      }
      console.log('[INFO] CampaignBuyer mapping verified (priority: 1)');
    } else {
      await tx.campaignBuyer.create({
        data: {
          workspace_id: workspaceId,
          campaign_id: campaign.id,
          buyer_id: buyer.id,
          priority: 1,
          status: 'ACTIVE',
        },
      });
      console.log('[5/5] CampaignBuyer mapped (priority: 1)');
    }

    // Explicit Assertion: Confirm NO PhoneNumber record was created in Stage A
    let phoneCount = 0;
    if (typeof tx.phoneNumber?.count === 'function') {
      phoneCount = await tx.phoneNumber.count({
        where: { workspace_id: workspaceId },
      });
    } else if (typeof tx.phoneNumber?.findMany === 'function') {
      const phones = await tx.phoneNumber.findMany({
        where: { workspace_id: workspaceId },
      });
      phoneCount = phones.length;
    }
    if (phoneCount !== 0) {
      throw new Error(
        `CRITICAL ABORT: PhoneNumber record exists in Stage A QA workspace (${phoneCount} found). PhoneNumber creation must occur only in Stage B!`,
      );
    }

    return {
      workspaceId,
      campaignId: campaign.id,
      buyerId: buyer.id,
      balanceMicro: 0n,
      stage: 'STAGE_A_CORE_COMPLETE',
      phoneNumberAssigned: false,
    };
  });

  console.log('\n=== STAGE A PROVISIONING SUCCESSFUL ===');
  console.log(`QA_WORKSPACE_ID=${result.workspaceId}`);
  console.log(`QA_CAMPAIGN_ID=${result.campaignId}`);
  console.log(`QA_BUYER_ID=${result.buyerId}`);
  console.log(`WALLET_BALANCE_MICRO=${result.balanceMicro}`);

  return result;
}

/**
 * =============================================================================
 * STAGE B: Carrier Attachment Provisioning (Dedicated DID & Provider ID)
 * =============================================================================
 */
async function attachQaCarrierNumber(input, options) {
  console.log('=== [CallFlow QA] Stage B: Carrier Attachment ===');

  if (!options?.skipDbTargetValidation && !options?.prismaOverride) {
    const target = validateQaDatabaseTarget();
    console.log(`[PASS] Database target verified: ${target.user}@${target.host}:${target.port}/${target.db}`);
  }

  const { newQaTrackingDid, telnyxProviderNumberId, confirmCarrierOwnership } = input;

  // 1. Mandatory Operator Confirmation
  if (confirmCarrierOwnership !== true) {
    throw new Error(
      'ABORT: Mandatory operator confirmation missing. You must explicitly set "confirmCarrierOwnership: true" after verifying in the Telnyx Portal that the DID and provider_number_id belong together.',
    );
  }

  // 2. Validate E.164 and format
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  if (!newQaTrackingDid || !e164Regex.test(newQaTrackingDid.trim())) {
    throw new Error(`ABORT: Invalid E.164 phone number: "${newQaTrackingDid}"`);
  }
  const cleanDid = newQaTrackingDid.trim();

  if (!telnyxProviderNumberId || !telnyxProviderNumberId.trim()) {
    throw new Error('ABORT: telnyxProviderNumberId must be provided');
  }
  const cleanProviderNumberId = telnyxProviderNumberId.trim();

  // 3. Reject Production DIDs
  if (FORBIDDEN_PRODUCTION_DIDS.has(cleanDid)) {
    throw new Error(`CRITICAL ABORT: Attempted to provision production DID ${cleanDid} as QA!`);
  }

  const prisma = getPrismaClient(options?.prismaOverride, options?.skipDbTargetValidation);

  const result = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({
      where: { slug: QA_CONSTANTS.SLUG },
    });
    if (!workspace) {
      throw new Error(
        'ABORT: Core QA Workspace not found! Stage A must be executed before Stage B carrier attachment.',
      );
    }
    const workspaceId = workspace.id;

    const campaign = await tx.campaign.findFirst({
      where: { workspace_id: workspaceId, name: QA_CONSTANTS.CAMPAIGN_NAME },
    });
    if (!campaign) {
      throw new Error(
        'ABORT: QA Campaign not found! Stage A must be executed before Stage B carrier attachment.',
      );
    }

    const existingPhone = await tx.phoneNumber.findUnique({
      where: { phone_number: cleanDid },
    });

    let phoneRecord;
    if (existingPhone) {
      if (existingPhone.workspace_id !== workspaceId) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} is owned by another workspace: ${existingPhone.workspace_id}`,
        );
      }
      if (existingPhone.provider_number_id !== cleanProviderNumberId) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} has mismatched provider_number_id. DB: "${existingPhone.provider_number_id}" vs Input: "${cleanProviderNumberId}"`,
        );
      }
      if (existingPhone.campaign_id !== campaign.id) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} is assigned to campaign ${existingPhone.campaign_id}, expected ${campaign.id}`,
        );
      }
      if (existingPhone.status !== PhoneNumberStatus.ACTIVE) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} is not ACTIVE (status: ${existingPhone.status})`,
        );
      }
      phoneRecord = existingPhone;
      console.log(`[INFO] Existing QA Tracking DID verified: ${phoneRecord.phone_number}`);
    } else {
      phoneRecord = await tx.phoneNumber.create({
        data: {
          workspace_id: workspaceId,
          phone_number: cleanDid,
          provider: 'telnyx',
          provider_number_id: cleanProviderNumberId,
          status: PhoneNumberStatus.ACTIVE,
          campaign_id: campaign.id,
          name: 'Autonomous QA Tracking DID',
        },
      });
      console.log(`[PASS] Dedicated QA DID assigned: ${phoneRecord.phone_number}`);
    }

    return {
      workspaceId,
      campaignId: campaign.id,
      phoneNumberId: phoneRecord.id,
      trackingDid: cleanDid,
      stage: 'STAGE_B_CARRIER_ATTACHED',
    };
  });

  console.log('\n=== STAGE B CARRIER ATTACHMENT SUCCESSFUL ===');
  console.log(`TELNYX_QA_TRACKING_DID=${result.trackingDid}`);
  return result;
}

/**
 * Combined single-transaction provisioning for backward compatibility with Phase 7B-2D tests.
 */
async function provisionDedicatedQaEnvironment(input, prismaOverride) {
  const prisma = getPrismaClient(prismaOverride, !!prismaOverride);
  const {
    newQaTrackingDid,
    telnyxProviderNumberId,
    initialFundingMicro = QA_CONSTANTS.DEFAULT_FUNDING_MICRO,
    confirmCarrierOwnership,
  } = input;

  console.log('=== [CallFlow QA] Pre-Provisioning Safety Validation ===');

  if (confirmCarrierOwnership !== true) {
    throw new Error(
      'ABORT: Mandatory operator confirmation missing. You must explicitly set "confirmCarrierOwnership: true" after verifying in the Telnyx Portal that the DID and provider_number_id belong together.',
    );
  }

  const e164Regex = /^\+[1-9]\d{1,14}$/;
  if (!newQaTrackingDid || !e164Regex.test(newQaTrackingDid.trim())) {
    throw new Error(`ABORT: Invalid E.164 phone number: "${newQaTrackingDid}"`);
  }
  const cleanDid = newQaTrackingDid.trim();

  if (!telnyxProviderNumberId || !telnyxProviderNumberId.trim()) {
    throw new Error('ABORT: telnyxProviderNumberId must be provided');
  }
  const cleanProviderNumberId = telnyxProviderNumberId.trim();

  const rawFunding = input.initialFundingMicro ?? QA_CONSTANTS.DEFAULT_FUNDING_MICRO;
  const fundingMicro =
    typeof rawFunding === 'bigint'
      ? rawFunding
      : BigInt(rawFunding);

  if (fundingMicro <= 0n) {
    throw new Error(`ABORT: Initial funding must be greater than zero (got ${fundingMicro})`);
  }

  if (FORBIDDEN_PRODUCTION_DIDS.has(cleanDid)) {
    throw new Error(`CRITICAL ABORT: Attempted to provision production DID ${cleanDid} as QA!`);
  }

  const existingNumber = await prisma.phoneNumber.findUnique({
    where: { phone_number: cleanDid },
  });
  if (existingNumber) {
    const existingWs = await prisma.workspace.findUnique({
      where: { id: existingNumber.workspace_id },
    });
    if (!existingWs || existingWs.slug !== QA_CONSTANTS.SLUG) {
      throw new Error(
        `ABORT: Phone number ${cleanDid} is already assigned to non-QA workspace ${existingNumber.workspace_id}`,
      );
    }
  }

  const existingProviderNumber = await prisma.phoneNumber.findFirst({
    where: { provider_number_id: cleanProviderNumberId },
  });
  if (existingProviderNumber && existingProviderNumber.phone_number !== cleanDid) {
    throw new Error(
      `ABORT: Provider number ID ${cleanProviderNumberId} is already in use by phone number ${existingProviderNumber.phone_number} in workspace ${existingProviderNumber.workspace_id}`,
    );
  }

  const existingBuyerCli = await prisma.buyer.findFirst({
    where: { destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI },
  });
  if (existingBuyerCli) {
    const existingWs = await prisma.workspace.findUnique({
      where: { id: existingBuyerCli.workspace_id },
    });
    if (!existingWs || existingWs.slug !== QA_CONSTANTS.SLUG) {
      throw new Error(
        `ABORT: Logical QA Buyer destination number ${QA_CONSTANTS.LOGICAL_QA_BUYER_CLI} is already assigned to non-QA workspace ${existingBuyerCli.workspace_id}`,
      );
    }
  }

  console.log(`[PASS] Input validated. Target QA DID: ${cleanDid}`);
  console.log('=== [CallFlow QA] Executing Atomic Provisioning Transaction ===');

  const result = await prisma.$transaction(async (tx) => {
    let workspace = await tx.workspace.findUnique({
      where: { slug: QA_CONSTANTS.SLUG },
    });

    if (workspace) {
      if (FORBIDDEN_WORKSPACE_IDS.has(workspace.id)) {
        throw new Error('CRITICAL ABORT: QA slug matches protected production workspace!');
      }
      if (workspace.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing QA workspace ${workspace.id} has unexpected status: "${workspace.status}". Expected "ACTIVE".`,
        );
      }
      if (workspace.name !== QA_CONSTANTS.WORKSPACE_NAME) {
        throw new Error(
          `ABORT: Existing QA workspace name mismatch. Expected "${QA_CONSTANTS.WORKSPACE_NAME}", found "${workspace.name}".`,
        );
      }
    } else {
      workspace = await tx.workspace.create({
        data: {
          name: QA_CONSTANTS.WORKSPACE_NAME,
          slug: QA_CONSTANTS.SLUG,
          status: 'ACTIVE',
        },
      });
    }

    const workspaceId = workspace.id;

    const existingBalance = await tx.workspaceBalance.findUnique({
      where: { workspace_id: workspaceId },
    });

    const initIdempotencyKey = `qa_wallet_init_${workspaceId}`;
    const initRefId = `qa_prov_${workspaceId}`;
    const targetBalanceMinor = Number(fundingMicro / 10000n);

    if (existingBalance) {
      const expectedMinor = Number(existingBalance.balance_micro / 10000n);
      if (existingBalance.balance_minor !== expectedMinor) {
        throw new Error(
          `ABORT: Corrupt existing wallet balance! balance_minor (${existingBalance.balance_minor}) does not match balance_micro (${existingBalance.balance_micro}).`,
        );
      }

      const txs = await tx.walletTransaction.findMany({
        where: { workspace_id: workspaceId },
      });

      let calculatedMicro = 0n;
      for (const t of txs) {
        if (t.type === TransactionType.CREDIT || t.type === TransactionType.REFUND) {
          calculatedMicro += t.amount_micro;
        } else if (t.type === TransactionType.DEBIT) {
          calculatedMicro -= t.amount_micro;
        }
      }

      if (calculatedMicro !== existingBalance.balance_micro) {
        throw new Error(
          `ABORT: Ledger discrepancy detected! Workspace balance (${existingBalance.balance_micro} micro) does not equal sum of audit transactions (${calculatedMicro} micro).`,
        );
      }

      const existingInitTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: initIdempotencyKey },
      });

      if (existingInitTx) {
        if (existingInitTx.amount_micro !== fundingMicro) {
          throw new Error(
            `ABORT: Initial funding transaction exists with mismatched amount: ${existingInitTx.amount_micro} vs requested ${fundingMicro}`,
          );
        }
      } else {
        const newMicro = existingBalance.balance_micro + fundingMicro;
        const newMinor = Number(newMicro / 10000n);

        await tx.walletTransaction.create({
          data: {
            workspace_id: workspaceId,
            amount_minor: targetBalanceMinor,
            amount_micro: fundingMicro,
            currency: 'USD',
            type: TransactionType.CREDIT,
            balance_after: newMinor,
            balance_after_micro: newMicro,
            reference_type: 'INITIAL_QA_PROVISIONING',
            reference_id: initRefId,
            idempotency_key: initIdempotencyKey,
            description: 'Initial funding for Autonomous QA telephony testing',
          },
        });

        await tx.workspaceBalance.update({
          where: { workspace_id: workspaceId },
          data: {
            balance_minor: newMinor,
            balance_micro: newMicro,
          },
        });
      }
    } else {
      await tx.workspaceBalance.create({
        data: {
          workspace_id: workspaceId,
          balance_minor: targetBalanceMinor,
          balance_micro: fundingMicro,
          reserved_micro: 0n,
          currency: 'USD',
        },
      });

      await tx.walletTransaction.create({
        data: {
          workspace_id: workspaceId,
          amount_minor: targetBalanceMinor,
          amount_micro: fundingMicro,
          currency: 'USD',
          type: TransactionType.CREDIT,
          balance_after: targetBalanceMinor,
          balance_after_micro: fundingMicro,
          reference_type: 'INITIAL_QA_PROVISIONING',
          reference_id: initRefId,
          idempotency_key: initIdempotencyKey,
          description: 'Initial funding for Autonomous QA telephony testing',
        },
      });
    }

    let campaign = await tx.campaign.findFirst({
      where: { workspace_id: workspaceId, name: QA_CONSTANTS.CAMPAIGN_NAME },
    });

    if (campaign) {
      if (campaign.workspace_id !== workspaceId) {
        throw new Error(`ABORT: Campaign ownership mismatch for ${campaign.id}`);
      }
      if (campaign.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing QA Campaign ${campaign.id} is not ACTIVE (status: ${campaign.status})`,
        );
      }
    } else {
      campaign = await tx.campaign.create({
        data: {
          workspace_id: workspaceId,
          name: QA_CONSTANTS.CAMPAIGN_NAME,
          status: 'ACTIVE',
          conversion_duration_secs: 90,
          duplicate_window_secs: 2592000,
          default_payout_amount: 1.0,
          currency: 'USD',
        },
      });
    }

    let buyer = await tx.buyer.findFirst({
      where: {
        workspace_id: workspaceId,
        destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI,
      },
    });

    if (buyer) {
      if (buyer.workspace_id !== workspaceId) {
        throw new Error(`ABORT: Buyer ownership mismatch for ${buyer.id}`);
      }
      if (buyer.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing Logical QA Buyer ${buyer.id} is not ACTIVE (status: ${buyer.status})`,
        );
      }
    } else {
      buyer = await tx.buyer.create({
        data: {
          workspace_id: workspaceId,
          name: QA_CONSTANTS.BUYER_NAME,
          destination_number: QA_CONSTANTS.LOGICAL_QA_BUYER_CLI,
          status: 'ACTIVE',
          timeout: 30,
          max_concurrent_calls: 1,
        },
      });
    }

    const priorityCollision = await tx.campaignBuyer.findUnique({
      where: {
        campaign_id_priority: {
          campaign_id: campaign.id,
          priority: 1,
        },
      },
    });

    if (priorityCollision && priorityCollision.buyer_id !== buyer.id) {
      throw new Error(
        `ABORT: Priority collision! Campaign ${campaign.id} priority 1 is already assigned to a different buyer (${priorityCollision.buyer_id}).`,
      );
    }

    const existingMapping = await tx.campaignBuyer.findUnique({
      where: {
        campaign_id_buyer_id: {
          campaign_id: campaign.id,
          buyer_id: buyer.id,
        },
      },
    });

    if (existingMapping) {
      if (existingMapping.workspace_id !== workspaceId) {
        throw new Error('ABORT: CampaignBuyer mapping ownership mismatch');
      }
      if (existingMapping.priority !== 1) {
        throw new Error(
          `ABORT: Existing CampaignBuyer mapping has invalid priority ${existingMapping.priority}. Expected 1.`,
        );
      }
      if (existingMapping.status !== 'ACTIVE') {
        throw new Error(
          `ABORT: Existing CampaignBuyer mapping is not ACTIVE (status: ${existingMapping.status})`,
        );
      }
    } else {
      await tx.campaignBuyer.create({
        data: {
          workspace_id: workspaceId,
          campaign_id: campaign.id,
          buyer_id: buyer.id,
          priority: 1,
          status: 'ACTIVE',
        },
      });
    }

    const existingPhone = await tx.phoneNumber.findUnique({
      where: { phone_number: cleanDid },
    });

    let phoneRecord;
    if (existingPhone) {
      if (existingPhone.workspace_id !== workspaceId) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} is owned by another workspace: ${existingPhone.workspace_id}`,
        );
      }
      if (existingPhone.provider_number_id !== cleanProviderNumberId) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} has mismatched provider_number_id. DB: "${existingPhone.provider_number_id}" vs Input: "${cleanProviderNumberId}"`,
        );
      }
      if (existingPhone.campaign_id !== campaign.id) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} is assigned to campaign ${existingPhone.campaign_id}, expected ${campaign.id}`,
        );
      }
      if (existingPhone.status !== PhoneNumberStatus.ACTIVE) {
        throw new Error(
          `ABORT: Phone number ${cleanDid} is not ACTIVE (status: ${existingPhone.status})`,
        );
      }
      phoneRecord = existingPhone;
    } else {
      phoneRecord = await tx.phoneNumber.create({
        data: {
          workspace_id: workspaceId,
          phone_number: cleanDid,
          provider: 'telnyx',
          provider_number_id: cleanProviderNumberId,
          status: PhoneNumberStatus.ACTIVE,
          campaign_id: campaign.id,
          name: 'Autonomous QA Tracking DID',
        },
      });
    }

    return {
      workspaceId,
      campaignId: campaign.id,
      buyerId: buyer.id,
      phoneNumberId: phoneRecord.id,
      trackingDid: cleanDid,
    };
  });

  return result;
}

module.exports = {
  validateQaDatabaseTarget,
  provisionCoreQaWorkspace,
  attachQaCarrierNumber,
  provisionDedicatedQaEnvironment,
  FORBIDDEN_PRODUCTION_DIDS,
  FORBIDDEN_WORKSPACE_IDS,
  FORBIDDEN_HOST_PATTERNS,
  QA_CONSTANTS,
};
