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
  balance_micro   BigInt   @default(0)
  currency        String   @default("USD")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  workspace       Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@map("workspace_balances")
}`;

s = s.replace(oldWorkspace, newWorkspace);
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
