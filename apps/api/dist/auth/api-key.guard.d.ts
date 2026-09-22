import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
export declare class ApiKeyAuthGuard implements CanActivate {
    private apiKeysService;
    constructor(apiKeysService: ApiKeysService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
