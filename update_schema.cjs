const fs = require('fs');
let schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

const workspaceBalanceModel = `
model WorkspaceBalance {
  workspace_id    String   @id
  balance_minor   Int      @default(0)
  currency        String   @default("USD")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  workspace       Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@map("workspace_balances")
}

model WalletTransaction {
  id             String   @id @default(uuid())
  workspace_id   String
  amount_minor   Int
  currency       String   @default("USD")
  balance_after  Int
  reference_type String
  reference_id   String
  description    String?
  created_at     DateTime @default(now())

  workspace      Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@map("wallet_transactions")
}
`;

if (!schema.includes('model WorkspaceBalance')) {
  schema = schema + '\n' + workspaceBalanceModel;
  
  // Add relation to Workspace model
  const wsIndex = schema.indexOf('model Workspace {');
  if (wsIndex !== -1) {
    const wsEnd = schema.indexOf('}', wsIndex);
    const beforeWs = schema.substring(0, wsEnd);
    const afterWs = schema.substring(wsEnd);
    schema = beforeWs + '  balance           WorkspaceBalance?\n  wallet_txs        WalletTransaction[]\n' + afterWs;
  }

  fs.writeFileSync('apps/api/prisma/schema.prisma', schema);
  console.log('Schema updated.');
} else {
  console.log('Schema already updated.');
}
