const fs = require('fs');

let schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

if (!schema.includes('enum TransactionType')) {
  schema = schema.replace(
    /enum SubscriptionStatus \{/, 
    'enum TransactionType {\n  CREDIT\n  DEBIT\n  REFUND\n  ADJUSTMENT\n}\n\nenum SubscriptionStatus {'
  );
}

const newWalletModel = `model WalletTransaction {
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

schema = schema.replace(/model WalletTransaction \{[\s\S]*?@@map\("wallet_transactions"\)\n\}/, newWalletModel);

fs.writeFileSync('apps/api/prisma/schema.prisma', schema);
