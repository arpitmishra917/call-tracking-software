import { Prisma } from '@prisma/client';

export interface VendorAuthorizableCall {
  workspace_id: string;
  attributed_vendor_id?: string | null;
  attribution_source?: string | null;
  commercial?: {
    vendor_id?: string | null;
  } | null;
}

/**
 * Builds a Prisma `where` clause fragment that enforces the strict, fail-closed
 * Phase 2 Vendor Call Attribution authorization predicate.
 *
 * Rules enforced:
 * - workspace_id matches authenticated workspace
 * - INGRESS_ASSIGNED: requires attributed_vendor_id === vendorId
 * - LEGACY_COMMERCIAL: requires commercial.vendor_id === vendorId
 * - INGRESS_UNASSIGNED, UNRESOLVED, LEGACY_UNATTRIBUTED, and NULL/unexpected sources fail closed.
 */
export function buildVendorCallWhere(
  workspaceId: string,
  vendorId: string,
): Prisma.CallWhereInput {
  if (!workspaceId || !vendorId) {
    return {
      workspace_id: workspaceId || '__invalid__',
      id: '__invalid__',
    };
  }

  return {
    workspace_id: workspaceId,
    OR: [
      {
        attribution_source: 'INGRESS_ASSIGNED',
        attributed_vendor_id: vendorId,
      },
      {
        attribution_source: 'LEGACY_COMMERCIAL',
        commercial: { vendor_id: vendorId },
      },
    ],
  };
}

/**
 * In-memory evaluation of the Phase 2 Vendor Call Attribution authorization predicate.
 *
 * Rules enforced:
 * - Cross-workspace calls are denied immediately.
 * - INGRESS_ASSIGNED: allowed if attributed_vendor_id === vendorId.
 * - Conflicting Call.vendor_id alone NEVER overrides or grants access if attributed_vendor_id conflicts or is null.
 * - LEGACY_COMMERCIAL: allowed if commercial.vendor_id === vendorId.
 * - INGRESS_UNASSIGNED: denied (commercial fallback strictly forbidden).
 * - UNRESOLVED: denied.
 * - LEGACY_UNATTRIBUTED: denied.
 * - Null or unexpected attribution sources: fail closed (denied).
 */
export function isCallAuthorizedForVendor(
  call: VendorAuthorizableCall | null | undefined,
  workspaceId: string,
  vendorId: string,
): boolean {
  if (!call || !workspaceId || !vendorId) {
    return false;
  }

  if (call.workspace_id !== workspaceId) {
    return false;
  }

  if (call.attribution_source === 'INGRESS_ASSIGNED') {
    return Boolean(call.attributed_vendor_id && call.attributed_vendor_id === vendorId);
  }

  if (call.attribution_source === 'LEGACY_COMMERCIAL') {
    return Boolean(call.commercial && call.commercial.vendor_id === vendorId);
  }

  // All other states (INGRESS_UNASSIGNED, UNRESOLVED, LEGACY_UNATTRIBUTED, NULL, unexpected) fail closed
  return false;
}
