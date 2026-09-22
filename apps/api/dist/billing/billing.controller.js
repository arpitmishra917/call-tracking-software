var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Body, Req, UseGuards, Headers, } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let BillingController = class BillingController {
    billingService;
    constructor(billingService) {
        this.billingService = billingService;
    }
    getBillingState(req) {
        return this.billingService.getBillingState(req.params.workspaceId);
    }
    createCheckout(req, body) {
        return this.billingService.createCheckoutSession(req.params.workspaceId, body.planId, body.returnUrl);
    }
    createPortal(req, body) {
        return this.billingService.createPortalSession(req.params.workspaceId, body.returnUrl);
    }
    async handleWebhook(req, signature) {
        if (!signature) {
            return { received: false };
        }
        const rawBody = req.rawBody;
        if (!rawBody) {
            return { received: false };
        }
        await this.billingService.handleWebhook(signature, rawBody);
        return { received: true };
    }
};
__decorate([
    Get('workspaces/:workspaceId/billing'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "getBillingState", null);
__decorate([
    Post('workspaces/:workspaceId/billing/checkout'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "createCheckout", null);
__decorate([
    Post('workspaces/:workspaceId/billing/portal'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "createPortal", null);
__decorate([
    Post('webhooks/stripe'),
    __param(0, Req()),
    __param(1, Headers('stripe-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "handleWebhook", null);
BillingController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [BillingService])
], BillingController);
export { BillingController };
//# sourceMappingURL=billing.controller.js.map