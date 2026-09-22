const fs = require('fs');
let c = fs.readFileSync('src/webhooks/webhooks.service.spec.ts', 'utf8');
c = c.replace(
  "global.fetch = vi.fn() as unknown as ReturnType<typeof vi.fn>;",
  "// Removed global fetch mock"
);
c = c.replace(
  "import { PrismaService } from '../prisma/prisma.service.js';",
  "import { PrismaService } from '../prisma/prisma.service.js';\nimport { safeFetch } from '../common/safe-fetch.js';\nvi.mock('../common/safe-fetch.js', () => ({ safeFetch: vi.fn() }));"
);
c = c.replace(/global\.fetch as unknown as ReturnType<typeof vi\.fn>/g, "(safeFetch as any)");
fs.writeFileSync('src/webhooks/webhooks.service.spec.ts', c);
