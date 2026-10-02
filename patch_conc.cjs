const fs = require('fs');
let s = fs.readFileSync('apps/api/src/telephony/concurrency.spec.ts', 'utf8');

s = s.replace("import { UsageService } from '../usage/usage.service.js';",
  "import { UsageService } from '../usage/usage.service.js';\\nimport { UsageBillingService } from '../billing/usage-billing.service.js';");

s = s.replace("let usageService: any;",
  "let usageService: any;\\n  let usageBillingService: any;");

s = s.replace("usageService = {\\n      recordUsage: vi.fn(),\\n    };",
  "usageService = {\\n      recordUsage: vi.fn(),\\n    };\\n\\n    usageBillingService = {\\n      billCallUsage: vi.fn(),\\n      billRecordingUsage: vi.fn(),\\n    };");

s = s.replace("{ provide: UsageService, useValue: usageService },",
  "{ provide: UsageService, useValue: usageService },\\n        { provide: UsageBillingService, useValue: usageBillingService },");

fs.writeFileSync('apps/api/src/telephony/concurrency.spec.ts', s);
