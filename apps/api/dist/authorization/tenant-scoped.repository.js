export class TenantScopedRepository {
    workspaceId;
    constructor(workspaceId) {
        this.workspaceId = workspaceId;
    }
    get tenantFilter() {
        return { workspace_id: this.workspaceId };
    }
}
//# sourceMappingURL=tenant-scoped.repository.js.map