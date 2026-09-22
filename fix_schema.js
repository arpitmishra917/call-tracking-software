const fs = require('fs');
let c = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

c += `
model Invoice {
  id                  String        @id @default(uuid())
  workspace_id        String
  subscription_id     String?
  provider_invoice_id String        @unique
  amount_due          Int           
  amount_paid         Int
  status              InvoiceStatus
  currency            String        @default("usd")
  hosted_invoice_url  String?
  invoice_date        DateTime
  created_at          DateTime      @default(now())
  updated_at          DateTime      @updatedAt

  workspace           Workspace     @relation(fields: [workspace_id], references: [id], onDelete: Cascade)
  subscription        Subscription? @relation(fields: [subscription_id], references: [id], onDelete: SetNull)

  @@index([workspace_id])
  @@map("invoices")
}

model ApiKey {
  id            String    @id @default(uuid())
  workspace_id  String
  name          String
  key_prefix    String
  hashed_secret String
  last_used_at  DateTime?
  revoked_at    DateTime?
  created_at    DateTime  @default(now())

  workspace     Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@index([key_prefix])
  @@map("api_keys")
}
`;

fs.writeFileSync('apps/api/prisma/schema.prisma', c);
