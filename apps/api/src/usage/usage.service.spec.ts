import { Test, TestingModule } from '@nestjs/testing';
import { UsageService } from './usage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageType } from '@prisma/client';

describe('UsageService', () => {
  let service: UsageService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageService,
        {
          provide: PrismaService,
          useValue: {
            usageRecord: {
              upsert: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<UsageService>(UsageService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should record usage and return it', async () => {
    const mockRecord = {
      id: 'usage-123',
      workspace_id: 'ws-123',
      type: UsageType.CALL_MINUTE,
      quantity: 5,
      source_id: 'call-123',
      idempotency_key: 'test_key',
    };

    (prisma.usageRecord.upsert as any).mockResolvedValue(mockRecord);

    const result = await service.recordUsage(
      'ws-123',
      UsageType.CALL_MINUTE,
      5,
      'call-123',
      'test_key',
    );
    expect(result).toEqual(mockRecord);
    expect(prisma.usageRecord.upsert).toHaveBeenCalledWith({
      where: { idempotency_key: 'test_key' },
      update: {},
      create: {
        workspace_id: 'ws-123',
        type: UsageType.CALL_MINUTE,
        quantity: 5,
        source_id: 'call-123',
        idempotency_key: 'test_key',
      },
    });
  });
});
