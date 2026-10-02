const fs = require('fs');
let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');
s = s.replace(
  /model WorkspaceBalance \\{\\r?\\n\\s*workspace_id\\s*String\\s*@id\\r?\\n\\s*balance_minor\\s*Int\\s*@default\\(0\\)/g,
  \`model WorkspaceBalance {
  workspace_id    String   @id
  balance_minor   Int      @default(0)
  balance_micro   BigInt   @default(0)\`
);
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
