export class TenantScopedRepository {
  constructor(protected readonly workspaceId: string) {}

  protected get tenantFilter() {
    return { workspace_id: this.workspaceId };
  }
}
