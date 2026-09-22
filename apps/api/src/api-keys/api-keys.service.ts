import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  async createApiKey(workspaceId: string, userId: string, name: string) {
    const rawSecret = crypto.randomBytes(32).toString('hex'); // 64 chars
    const keyPrefix = rawSecret.substring(0, 8);
    const hashedSecret = crypto
      .createHash('sha256')
      .update(rawSecret)
      .digest('hex');

    const apiKey = await this.prisma.apiKey.create({
      data: {
        workspace_id: workspaceId,
        user_id: userId,
        name,
        key_prefix: keyPrefix,
        hashed_secret: hashedSecret,
      },
    });

    return {
      ...apiKey,
      rawSecret: `pk_${rawSecret}`, // Only returned once!
    };
  }

  async listApiKeys(workspaceId: string) {
    return this.prisma.apiKey.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        workspace_id: true,
        name: true,
        key_prefix: true,
        last_used_at: true,
        revoked_at: true,
        created_at: true,
      },
    });
  }

  async revokeApiKey(workspaceId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, workspace_id: workspaceId },
    });

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    return this.prisma.apiKey.update({
      where: { id },
      data: { revoked_at: new Date() },
    });
  }

  async validateApiKey(token: string) {
    if (!token.startsWith('pk_')) {
      return null;
    }

    // Remove exactly the pk_ prefix to get the rawSecret that was hashed
    const rawSecret = token.substring(3);

    const keyPrefix = rawSecret.substring(0, 8);
    const hashedSecret = crypto
      .createHash('sha256')
      .update(rawSecret)
      .digest('hex');

    const key = await this.prisma.apiKey.findFirst({
      where: {
        key_prefix: keyPrefix,
        hashed_secret: hashedSecret,
        revoked_at: null,
      },
    });

    if (key) {
      // Update last_used_at asynchronously (fire and forget to save latency)
      this.prisma.apiKey
        .update({
          where: { id: key.id },
          data: { last_used_at: new Date() },
        })
        .catch(() => {
          // Silently catch to prevent unhandled rejections and noisy error logs in production
        });
    }

    return key;
  }
}
