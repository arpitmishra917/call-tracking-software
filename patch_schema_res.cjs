const fs = require('fs');
let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

s = s.replace(/balance_micro\\s+BigInt\\s+@default\\(0\\)/g, 
  'balance_micro   BigInt   @default(0)\\n  reserved_micro  BigInt   @default(0)');

s += \`
enum ReservationStatus {
  ACTIVE
  SETTLED
  RELEASED
  EXPIRED
}

model CallReservation {
  id                      String            @id @default(uuid())
  call_id                 String            @unique
  workspace_id            String
  status                  ReservationStatus @default(ACTIVE)
  original_reserved_micro BigInt
  total_reserved_micro    BigInt
  expires_at              DateTime?
  created_at              DateTime          @default(now())
  updated_at              DateTime          @updatedAt

  call      Call      @relation(fields: [call_id], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id, status])
  @@index([status, expires_at])
  @@map("call_reservations")
}
\`;

fs.writeFileSync('apps/api/prisma/schema.prisma', s);
