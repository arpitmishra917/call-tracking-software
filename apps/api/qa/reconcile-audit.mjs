import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('--- RECONCILE HISTORICAL CLEANUP FIGURES (STRICT READ-ONLY) ---');

  // Query 1: Exact count of ACTIVE recovery-mock-* reservations and sum of total_reserved_micro
  const q1 = await prisma.$queryRaw`
    SELECT 
      COUNT(*)::text AS active_reservation_count,
      COALESCE(SUM(cr.total_reserved_micro), 0)::text AS sum_total_reserved_micro,
      COUNT(DISTINCT cr.workspace_id)::text AS distinct_workspaces_count
    FROM "call_reservations" cr
    JOIN "calls" c ON cr.call_id = c.id
    WHERE cr.status = 'ACTIVE'
      AND c.provider_call_id LIKE 'recovery-mock-%';
  `;
  console.log('1. Basic Aggregates:', q1);

  // Query 2: Distribution of reservation amounts (GROUP BY total_reserved_micro)
  const q2 = await prisma.$queryRaw`
    SELECT 
      cr.total_reserved_micro::text AS total_reserved_micro,
      (cr.total_reserved_micro::numeric / 1000000)::text AS amount_dollars,
      COUNT(*)::text AS reservation_count,
      (SUM(cr.total_reserved_micro)::numeric / 1000000)::text AS subtotal_dollars
    FROM "call_reservations" cr
    JOIN "calls" c ON cr.call_id = c.id
    WHERE cr.status = 'ACTIVE'
      AND c.provider_call_id LIKE 'recovery-mock-%'
    GROUP BY cr.total_reserved_micro
    ORDER BY cr.total_reserved_micro DESC;
  `;
  console.log('2. Amount Distribution:', q2);

  // Query 3: WorkspaceBalance reserved amounts for these workspaces
  const q3 = await prisma.$queryRaw`
    WITH target_workspaces AS (
      SELECT DISTINCT cr.workspace_id
      FROM "call_reservations" cr
      JOIN "calls" c ON cr.call_id = c.id
      WHERE cr.status = 'ACTIVE'
        AND c.provider_call_id LIKE 'recovery-mock-%'
    )
    SELECT 
      COUNT(wb.workspace_id)::text AS balance_row_count,
      COALESCE(SUM(wb.reserved_micro), 0)::text AS total_workspace_reserved_micro,
      (COALESCE(SUM(wb.reserved_micro), 0)::numeric / 1000000)::text AS total_workspace_reserved_dollars,
      COALESCE(SUM(wb.balance_micro), 0)::text AS total_workspace_balance_micro,
      (COALESCE(SUM(wb.balance_micro), 0)::numeric / 1000000)::text AS total_workspace_balance_dollars
    FROM "workspace_balances" wb
    JOIN target_workspaces tw ON wb.workspace_id = tw.workspace_id;
  `;
  console.log('3. Workspace Balance Totals:', q3);

  // Query 4: Per-workspace mismatch check between call_reservations and workspace_balances
  const q4 = await prisma.$queryRaw`
    WITH res_per_ws AS (
      SELECT 
        cr.workspace_id,
        COUNT(*) AS active_res_count,
        SUM(cr.total_reserved_micro) AS res_reserved_micro
      FROM "call_reservations" cr
      JOIN "calls" c ON cr.call_id = c.id
      WHERE cr.status = 'ACTIVE'
        AND c.provider_call_id LIKE 'recovery-mock-%'
      GROUP BY cr.workspace_id
    )
    SELECT 
      COUNT(*)::text AS total_workspaces_analyzed,
      COUNT(CASE WHEN r.res_reserved_micro = wb.reserved_micro THEN 1 END)::text AS exact_matches,
      COUNT(CASE WHEN r.res_reserved_micro != wb.reserved_micro THEN 1 END)::text AS mismatches,
      COALESCE(SUM(CASE WHEN r.res_reserved_micro != wb.reserved_micro THEN ABS(r.res_reserved_micro - wb.reserved_micro) ELSE 0 END), 0)::text AS total_mismatch_micro
    FROM res_per_ws r
    LEFT JOIN "workspace_balances" wb ON r.workspace_id = wb.workspace_id;
  `;
  console.log('4. Workspace vs Reservation Mismatch Check:', q4);

  // Query 5: Check why earlier estimate was $1,375 (275 * $5 = $1,375 vs actual $1,223.10)
  const q5 = await prisma.$queryRaw`
    SELECT 
      COUNT(CASE WHEN cr.total_reserved_micro = 5000000 THEN 1 END)::text AS count_5_dollar,
      COUNT(CASE WHEN cr.total_reserved_micro != 5000000 THEN 1 END)::text AS count_not_5_dollar,
      COUNT(*)::text AS total_count,
      (COUNT(*)::numeric * 5.00)::text AS hypothetical_flat_5_total,
      (SUM(cr.total_reserved_micro)::numeric / 1000000)::text AS actual_total_dollars
    FROM "call_reservations" cr
    JOIN "calls" c ON cr.call_id = c.id
    WHERE cr.status = 'ACTIVE'
      AND c.provider_call_id LIKE 'recovery-mock-%';
  `;
  console.log('5. Reconciliation of $1,375 vs $1,223.10:', q5);

  // Query 6: Check non-ACTIVE recovery-mock-* records if any exist
  const q6 = await prisma.$queryRaw`
    SELECT 
      cr.status::text,
      COUNT(*)::text AS status_count,
      (SUM(cr.total_reserved_micro)::numeric / 1000000)::text AS total_dollars
    FROM "call_reservations" cr
    JOIN "calls" c ON cr.call_id = c.id
    WHERE c.provider_call_id LIKE 'recovery-mock-%'
    GROUP BY cr.status;
  `;
  console.log('6. All Statuses for recovery-mock-*:', q6);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
