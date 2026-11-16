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
  const mismatches = await prisma.$queryRaw`
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
      r.workspace_id,
      r.active_res_count::text,
      r.res_reserved_micro::text AS res_reserved_micro,
      wb.reserved_micro::text AS wb_reserved_micro,
      wb.balance_micro::text AS wb_balance_micro,
      (r.res_reserved_micro - wb.reserved_micro)::text AS diff_micro
    FROM res_per_ws r
    LEFT JOIN "workspace_balances" wb ON r.workspace_id = wb.workspace_id
    WHERE r.res_reserved_micro != wb.reserved_micro;
  `;
  console.log('Mismatched workspaces:', mismatches);

  // Let's check other reservations for these workspaces
  for (const m of mismatches) {
    const allRes = await prisma.$queryRaw`
      SELECT id, call_id, status::text, total_reserved_micro::text
      FROM "call_reservations"
      WHERE workspace_id = ${m.workspace_id};
    `;
    console.log(`Other reservations for ${m.workspace_id}:`, allRes);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
