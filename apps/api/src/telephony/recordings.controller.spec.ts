import { Test, TestingModule } from '@nestjs/testing';
import { RecordingsController } from './recordings.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TELEPHONY_PROVIDER } from './call-controller.js';
import { FakeTelephonyProvider } from './fake.provider.js';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';

describe('RecordingsController', () => {
  let controller: RecordingsController;
  let prisma: PrismaService;
  let provider: FakeTelephonyProvider;

  beforeEach(async () => {
    provider = new FakeTelephonyProvider();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            recording: {
              findUnique: vi.fn(),
            },
          },
        },
        {
          provide: TELEPHONY_PROVIDER,
          useValue: provider,
        },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .compile();

    controller = module.get<RecordingsController>(RecordingsController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should return download url for authorized workspace recording', async () => {
    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
      id: 'rec-1',
      workspace_id: 'ws-1',
      call_id: 'call-1',
      provider_id: 'prov-rec-1',
      recording_url: null,
      status: 'COMPLETED',
    } as any);

    const result = await controller.getRecordingUrl('ws-1', 'rec-1');
    expect(result).toEqual({
      url: 'https://fake.recording.url/prov-rec-1.mp3',
    });
    expect(prisma.recording.findUnique).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
    });
  });

  it('should throw NotFoundException if recording does not belong to workspace', async () => {
    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
      id: 'rec-1',
      workspace_id: 'ws-different',
      call_id: 'call-1',
      provider_id: 'prov-rec-1',
      recording_url: null,
      status: 'COMPLETED',
    } as any);

    await expect(controller.getRecordingUrl('ws-1', 'rec-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException if recording does not exist', async () => {
    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue(null);

    await expect(
      controller.getRecordingUrl('ws-1', 'rec-not-found'),
    ).rejects.toThrow(NotFoundException);
  });
});
