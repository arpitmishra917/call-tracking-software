const fs = require('fs');

let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

const oldWorkspace = `model WorkspaceBalance {
  workspace_id    String   @id
  balance_minor   Int      @default(0)
  currency        String   @default("USD")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  workspace       Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@map("workspace_balances")
}`;

const newWorkspace = `model WorkspaceBalance {
  workspace_id    String   @id
  balance_minor   Int      @default(0)
  balance_micro   BigInt
  currency        String   @default("USD")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  workspace       Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@map("workspace_balances")
}`;

const oldTx = `model WalletTransaction {
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

const newTx = `model WalletTransaction {
  id              String          @id @default(uuid())
  workspace_id    String
  amount_minor    Int
  amount_micro    BigInt
  currency        String          @default("USD")
  type            TransactionType @default(CREDIT)
  balance_after   Int
  balance_after_micro BigInt
  reference_type  String
  reference_id    String
  idempotency_key String          @unique
  description     String?
  created_at      DateTime        @default(now())

  workspace       Workspace       @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@map("wallet_transactions")
}`;

s = s.replace(oldWorkspace.replace(/\\n/g, "\\r\\n"), newWorkspace.replace(/\\n/g, "\\r\\n"));
s = s.replace(oldTx.replace(/\\n/g, "\\r\\n"), newTx.replace(/\\n/g, "\\r\\n"));
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
