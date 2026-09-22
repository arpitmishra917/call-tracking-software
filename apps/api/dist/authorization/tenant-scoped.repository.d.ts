export declare class TenantScopedRepository {
    protected readonly workspaceId: string;
    constructor(workspaceId: string);
    protected get tenantFilter(): {
        workspace_id: string;
    };
}
