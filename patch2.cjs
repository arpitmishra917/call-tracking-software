const fs = require('fs');
let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

const replacement = `model WalletTransaction {
  id              String          @id @default(uuid())
  workspace_id    String
  amount_minor    Int
  currency        String          @default("USD")
  type            TransactionType @default(CREDIT)
  balance_after   Int
  reference_type  String
  reference_id    String
  idempotency_key String          @unique
  description     String?
  created_at      DateTime        @default(now())

  workspace       Workspace       @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@map("wallet_transactions")
}`;

s = s.replace(/model WalletTransaction \{[\s\S]*?\}/, replacement);
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
