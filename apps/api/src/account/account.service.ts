import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccount(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    
    // We only store the display name in the profile
    return {
      fullName: profile?.display_name || '',
    };
  }

  async updateProfile(userId: string, fullName: string) {
    if (!fullName || fullName.trim().length === 0) {
      throw new BadRequestException('Full name is required');
    }

    const trimmedName = fullName.trim();
    if (trimmedName.length > 100) {
      throw new BadRequestException('Full name is too long');
    }

    const profile = await this.prisma.profile.upsert({
      where: { id: userId },
      update: { display_name: trimmedName },
      create: { id: userId, display_name: trimmedName },
    });

    return { fullName: profile.display_name };
  }
}
