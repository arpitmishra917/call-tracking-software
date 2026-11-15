export const PERMISSIONS_LIST = [
  { key: 'workspace:read', group: 'WORKSPACE', description: 'Read workspace details' },
  { key: 'workspace:update', group: 'WORKSPACE', description: 'Update workspace details' },

  { key: 'member:read', group: 'MEMBERS', description: 'Read workspace members' },
  { key: 'member:invite', group: 'MEMBERS', description: 'Invite workspace members' },
  { key: 'member:update', group: 'MEMBERS', description: 'Update workspace members' },
  { key: 'member:remove', group: 'MEMBERS', description: 'Remove workspace members' },

  { key: 'vendor:read', group: 'VENDORS', description: 'Read vendors' },
  { key: 'vendor:create', group: 'VENDORS', description: 'Create vendors' },
  { key: 'vendor:update', group: 'VENDORS', description: 'Update vendors' },
  { key: 'vendor:archive', group: 'VENDORS', description: 'Archive vendors' },

  { key: 'buyer:read', group: 'BUYERS', description: 'Read buyers' },
  { key: 'buyer:create', group: 'BUYERS', description: 'Create buyers' },
  { key: 'buyer:update', group: 'BUYERS', description: 'Update buyers' },
  { key: 'buyer:archive', group: 'BUYERS', description: 'Archive buyers' },

  { key: 'campaign:read', group: 'CAMPAIGNS', description: 'Read campaigns' },
  { key: 'campaign:create', group: 'CAMPAIGNS', description: 'Create campaigns' },
  { key: 'campaign:update', group: 'CAMPAIGNS', description: 'Update campaigns' },
  { key: 'campaign:archive', group: 'CAMPAIGNS', description: 'Archive campaigns' },

  { key: 'phone_number:read', group: 'PHONE_NUMBERS', description: 'Read phone numbers' },
  { key: 'phone_number:manage', group: 'PHONE_NUMBERS', description: 'Manage phone numbers' },

  { key: 'call:read', group: 'CALLS', description: 'Read calls' },
  { key: 'call:recording_read', group: 'CALLS', description: 'Read call recordings' },

  { key: 'report:read', group: 'REPORTING', description: 'Read reports' },
  { key: 'report:export', group: 'REPORTING', description: 'Export reports' },
  { key: 'report:manage', group: 'REPORTING', description: 'Create, update, or delete saved reports' },

  { key: 'webhook:read', group: 'WEBHOOKS', description: 'Read webhooks' },
  { key: 'webhook:manage', group: 'WEBHOOKS', description: 'Manage webhooks' },

  { key: 'api_key:read', group: 'API_KEYS', description: 'Read API keys' },
  { key: 'api_key:manage', group: 'API_KEYS', description: 'Manage API keys' },

  { key: 'billing:read', group: 'BILLING', description: 'Read billing details' },
  { key: 'billing:manage', group: 'BILLING', description: 'Manage billing' },

  { key: 'usage:read', group: 'USAGE', description: 'Read usage metrics' },

  { key: 'audit_log:read', group: 'SECURITY', description: 'Read security audit logs' },

  // COMMERCIAL (AD-04)
  { key: 'commercial:read', group: 'COMMERCIAL', description: 'Read commercial and financial call data' },
  { key: 'commercial:export', group: 'COMMERCIAL', description: 'Export commercial reports and data' },
  { key: 'dispute:create', group: 'COMMERCIAL', description: 'Create commercial disputes' },
  { key: 'dispute:manage', group: 'COMMERCIAL', description: 'Manage and resolve commercial disputes' },

  // SETTLEMENT (AD-04)
  { key: 'settlement:read', group: 'SETTLEMENT', description: 'Read settlement batches and items' },
  { key: 'settlement:generate', group: 'SETTLEMENT', description: 'Generate settlement batches' },

  // PAYMENT (COMM-INTEGRATION-8B)
  { key: 'payment:read', group: 'PAYMENT', description: 'Read payment instructions and executions' },
  { key: 'payment:manage', group: 'PAYMENT', description: 'Manage and execute settlement payments' },

  // RECONCILIATION (COMM-INTEGRATION-8B)
  { key: 'reconciliation:read', group: 'RECONCILIATION', description: 'Read reconciliation runs and issues' },
  { key: 'reconciliation:run', group: 'RECONCILIATION', description: 'Run settlement and workspace reconciliation audits' }
];

// Admin has comprehensive access baseline identical to legacy ADMIN role.
// Under AD-04, settlement:generate is strictly excluded (OWNER-only by default).
// Under COMM-INTEGRATION-8B, payment:manage and reconciliation:run are strictly excluded (OWNER-only by default).
export const ADMIN_BASELINE_PERMISSIONS = PERMISSIONS_LIST
  .map(p => p.key)
  .filter(key => key !== 'settlement:generate' && key !== 'payment:manage' && key !== 'reconciliation:run');

// Participant Vendor baseline permissions:
// Allows invited vendor members to view workspace details, read calls/metrics, read recordings, read/export reports, and view settlement batches.
// Owner-only financial permissions (settlement:generate, payment:manage, reconciliation:run) and Buyer permissions (buyer:*, dispute:*, etc.) remain strictly excluded.
export const VENDOR_BASELINE_PERMISSIONS = [
  'workspace:read',
  'call:read',
  'call:recording_read',
  'report:read',
  'report:export',
  'settlement:read',
  'vendor:read',
  'phone_number:read',
];

// Participant Buyer baseline permissions:
export const BUYER_BASELINE_PERMISSIONS = [
  'workspace:read',
  'call:read',
  'call:recording_read',
  'report:read',
  'report:export',
  'commercial:read',
  'dispute:create',
  'settlement:read',
  'campaign:read',
  'buyer:read',
  'phone_number:read',
];
