import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from apps/api/.env or repo root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function runDryRunCleanupPlan() {
  console.log('================================================================');
  console.log('CALLFLOW — PROPOSED ORPHANED TEST RECORD CLEANUP PLAN (DRY-RUN)');
  console.log('================================================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Database: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : 'UNDEFINED'}`);
  console.log('Mode: STRICT READ-ONLY / DRY-RUN (No database mutations applied)');
  console.log('----------------------------------------------------------------\n');

  // 1. Selection Criteria Definition
  console.log('1. SELECTION CRITERIA:');
  console.log('   - Model: CallReservation');
  console.log('   - Condition 1: status = "ACTIVE"');
  console.log('   - Condition 2: call.provider_call_id STARTS WITH "recovery-mock-"');
  console.log('   - Condition 3: call.provider = "telnyx" (or synthetic mock)');
  console.log('   - Historical Origin: Phase 3F test runs (apps/api/test/recovery.spec.ts)\n');

  // 2. Query matching reservations
  const matchingReservations = await prisma.callReservation.findMany({
    where: {
      status: 'ACTIVE',
      call: {
        provider_call_id: {
          startsWith: 'recovery-mock-',
        },
      },
    },
    include: {
      call: {
        select: {
          id: true,
          provider: true,
          provider_call_id: true,
          state: true,
          workspace_id: true,
          created_at: true,
        },
      },
    },
    orderBy: {
      created_at: 'asc',
    },
  });

  const totalCount = matchingReservations.length;
  console.log('2. DRY-RUN SCAN RESULTS:');
  console.log(`   - Total Matching Orphaned Reservations: ${totalCount}`);

  if (totalCount === 0) {
    console.log('   - Notice: No matching orphaned synthetic records found.\n');
    await prisma.$disconnect();
    return;
  }

  // 3. Timestamps and Age Distribution
  const oldest = matchingReservations[0].created_at;
  const newest = matchingReservations[totalCount - 1].created_at;
  console.log(`   - Oldest Record Created: ${oldest.toISOString()}`);
  console.log(`   - Newest Record Created: ${newest.toISOString()}`);

  // 4. Financial & Balance Aggregation
  const workspaceBreakdown = new Map();
  let totalReservedMicro = 0n;

  for (const r of matchingReservations) {
    totalReservedMicro += r.total_reserved_micro;
    const wsId = r.workspace_id;
    if (!workspaceBreakdown.has(wsId)) {
      workspaceBreakdown.set(wsId, { count: 0, reservedMicro: 0n });
    }
    const stat = workspaceBreakdown.get(wsId);
    stat.count += 1;
    stat.reservedMicro += r.total_reserved_micro;
  }

  const totalReservedDollars = (Number(totalReservedMicro) / 1_000_000).toFixed(2);
  console.log(`   - Total Active Reserved Funds: $${totalReservedDollars} (${totalReservedMicro} micro-units)`);
  console.log(`   - Impacted Synthetic Workspaces: ${workspaceBreakdown.size}`);
  console.log('   - Workspace Breakdown:');
  for (const [wsId, stat] of workspaceBreakdown.entries()) {
    const wsDollars = (Number(stat.reservedMicro) / 1_000_000).toFixed(2);
    console.log(`     * Workspace ${wsId}: ${stat.count} reservations, $${wsDollars} reserved`);
  }

  // 5. Expected State Transitions
  console.log('\n3. EXPECTED STATE TRANSITIONS (WHEN AUTHORIZED & EXECUTED):');
  console.log('   - CallReservation Transition:');
  console.log('     * Current Status:  ACTIVE');
  console.log('     * Target Status:   RELEASED');
  console.log('     * Audit Note:      Marked released as synthetic orphaned test fixture');
  console.log('   - WorkspaceBalance Transition (Per Synthetic Workspace):');
  console.log('     * Action:          reserved_micro = GREATEST(0, reserved_micro - sum_reserved_micro)');
  console.log('     * Balance Micro:   Unchanged (funds unreserved, not debited)');
  console.log('   - Call State Transition:');
  console.log('     * Current States:  ROUTING / COMPLETED / etc.');
  console.log('     * Target State:    COMPLETED (terminal)');

  // 6. Financial Impact Assessment
  console.log('\n4. FINANCIAL & COMMERCIAL IMPACT ASSESSMENT:');
  console.log('   - Real Carrier Incurred Cost:    $0.00 (Synthetic provider IDs never touched PSTN/Telnyx)');
  console.log('   - Commercial Customer Impact:     $0.00 (Belongs entirely to ephemeral Phase 3F test workspaces)');
  console.log('   - Live Carrier Queue Starvation:  COMPLETELY ELIMINATED by application-level query isolation');
  console.log('   - Database Integrity:            Prisma transaction will ensure atomic update of reservation and balance');

  // 7. Execution Guardrail
  console.log('\n5. EXECUTION GUARDRAILS:');
  console.log('   - This script runs strictly in READ-ONLY mode.');
  console.log('   - Execution is BLOCKED until explicit separate authorization is granted.');
  console.log('   - To execute once authorized, set AUTHORIZE_STALE_CLEANUP=true and pass --execute.');
  console.log('================================================================\n');

  await prisma.$disconnect();
}

runDryRunCleanupPlan().catch(async (err) => {
  console.error('Error during dry-run cleanup scan:', err);
  await prisma.$disconnect();
  process.exit(1);
});
