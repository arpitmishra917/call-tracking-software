const fs = require('fs');

let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

const oldWorkspace = `model WorkspaceBalance {
  id            String    @id @default(uuid())
  workspace_id  String    @unique
  balance_minor Int
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  workspace     Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@map("workspace_balances")
}`;

const newWorkspace = `model WorkspaceBalance {
  id            String    @id @default(uuid())
  workspace_id  String    @unique
  balance_minor Int
  balance_micro BigInt    @default(0)
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  workspace     Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
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
  amount_micro    BigInt          @default(0)
  currency        String          @default("USD")
  type            TransactionType @default(CREDIT)
  balance_after   Int
  balance_after_micro BigInt      @default(0)
  reference_type  String
  reference_id    String
  idempotency_key String          @unique
  description     String?
  created_at      DateTime        @default(now())

  workspace       Workspace       @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@map("wallet_transactions")
}`;

s = s.replace(oldWorkspace, newWorkspace);
s = s.replace(oldTx, newTx);
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
