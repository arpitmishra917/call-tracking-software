var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, UnauthorizedException, ForbiddenException, } from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
let ApiKeyAuthGuard = class ApiKeyAuthGuard {
    apiKeysService;
    constructor(apiKeysService) {
        this.apiKeysService = apiKeysService;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer pk_')) {
            throw new UnauthorizedException('Valid API key required');
        }
        const token = authHeader.substring(7);
        const apiKeyRecord = await this.apiKeysService.validateApiKey(token);
        if (!apiKeyRecord) {
            throw new UnauthorizedException('Invalid or revoked API key');
        }
        const requestedWorkspaceId = request.params.workspaceId ||
            request.query.workspaceId ||
            request.body.workspaceId;
        if (requestedWorkspaceId &&
            requestedWorkspaceId !== apiKeyRecord.workspace_id) {
            throw new ForbiddenException('API key does not belong to the requested workspace');
        }
        request.apiKey = apiKeyRecord;
        request.user = { userId: apiKeyRecord.user_id, role: 'API_KEY' };
        return true;
    }
};
ApiKeyAuthGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ApiKeysService])
], ApiKeyAuthGuard);
export { ApiKeyAuthGuard };
//# sourceMappingURL=api-key.guard.js.map