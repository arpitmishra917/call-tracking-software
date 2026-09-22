import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service.js';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer pk_')) {
      throw new UnauthorizedException('Valid API key required');
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    // Check if the API key is valid in the database
    const apiKeyRecord = await this.apiKeysService.validateApiKey(token);

    if (!apiKeyRecord) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    // Tenant Isolation Check
    const requestedWorkspaceId =
      request.params.workspaceId ||
      request.query.workspaceId ||
      request.body.workspaceId;
    if (
      requestedWorkspaceId &&
      requestedWorkspaceId !== apiKeyRecord.workspace_id
    ) {
      throw new ForbiddenException(
        'API key does not belong to the requested workspace',
      );
    }

    // Attach API key info to request
    request.apiKey = apiKeyRecord;

    // Provide a mock user to satisfy WorkspaceRolesGuard using the key creator
    request.user = { userId: apiKeyRecord.user_id, role: 'API_KEY' };

    return true;
  }
}
