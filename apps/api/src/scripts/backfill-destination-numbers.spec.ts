import { vi, describe, beforeEach, it, expect } from 'vitest';
import { runDestinationNumberBackfill } from './backfill-destination-numbers.js';

describe('runDestinationNumberBackfill (Idempotent Backfill Logic)', () => {
  let prisma: any;
  let mockDestinationNumbers: any[];
  let mockCampaignDestinations: any[];
  let mockCallAttempts: any[];
  let mockWorkspaceMembers: any[];
  let mockWorkspaceMemberBuyers: any[];
  let mockBuyers: any[];
  let mockCampaignBuyers: any[];

  beforeEach(() => {
    mockDestinationNumbers = [];
    mockCampaignDestinations = [];
    mockBuyers = [
      {
        id: 'buyer-1',
        workspace_id: 'ws-1',
        name: 'Arpit Solar',
        destination_number: '+15551112233',
        timeout: 40,
        max_concurrent_calls: 3,
        status: 'ACTIVE',
      },
      {
        id: 'buyer-2',
        workspace_id: 'ws-1',
        name: 'Ashutosh HVAC',
        destination_number: '+15554445566',
        timeout: 25,
        max_concurrent_calls: 2,
        status: 'ACTIVE',
      },
    ];

    mockCampaignBuyers = [
      {
        id: 'cb-1',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        buyer_id: 'buyer-1',
        priority: 1,
        status: 'ACTIVE',
      },
      {
        id: 'cb-2',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        buyer_id: 'buyer-2',
        priority: 2,
        status: 'ACTIVE',
      },
    ];

    mockCallAttempts = [
      {
        id: 'attempt-1',
        call_id: 'call-1',
        buyer_id: 'buyer-1',
        destination_number: null,
        destination_number_id: null,
        buyer: mockBuyers[0],
      },
      {
        id: 'attempt-2',
        call_id: 'call-2',
        buyer_id: 'buyer-2',
        destination_number: null,
        destination_number_id: null,
        buyer: mockBuyers[1],
      },
    ];

    mockWorkspaceMembers = [
      { id: 'member-1', workspace_id: 'ws-1', buyer_id: null },
      { id: 'member-multi', workspace_id: 'ws-1', buyer_id: null },
    ];

    mockWorkspaceMemberBuyers = [
      { id: 'wmb-1', workspace_member_id: 'member-1', buyer_id: 'buyer-1' },
      // member-multi is linked to both buyer-1 and buyer-2
      { id: 'wmb-2', workspace_member_id: 'member-multi', buyer_id: 'buyer-1' },
      { id: 'wmb-3', workspace_member_id: 'member-multi', buyer_id: 'buyer-2' },
    ];

    prisma = {
      buyer: {
        findMany: vi.fn().mockImplementation(() => Promise.resolve(mockBuyers)),
      },
      campaignBuyer: {
        findMany: vi.fn().mockImplementation(() => Promise.resolve(mockCampaignBuyers)),
      },
      destinationNumber: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const key = where.workspace_id_destination_number;
          return Promise.resolve(
            mockDestinationNumbers.find(
              dn =>
                dn.workspace_id === key.workspace_id &&
                dn.destination_number === key.destination_number,
            ) || null,
          );
        }),
        findFirst: vi.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            mockDestinationNumbers.find(
              dn =>
                dn.workspace_id === where.workspace_id &&
                dn.buyer_id === where.buyer_id,
            ) || null,
          );
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          const record = { id: `dn-${mockDestinationNumbers.length + 1}`, ...data };
          mockDestinationNumbers.push(record);
          return Promise.resolve(record);
        }),
      },
      campaignDestinationNumber: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const key = where.campaign_id_destination_number_id;
          return Promise.resolve(
            mockCampaignDestinations.find(
              cd =>
                cd.campaign_id === key.campaign_id &&
                cd.destination_number_id === key.destination_number_id,
            ) || null,
          );
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          const record = { id: `cdn-${mockCampaignDestinations.length + 1}`, ...data };
          mockCampaignDestinations.push(record);
          return Promise.resolve(record);
        }),
      },
      callAttempt: {
        findMany: vi.fn().mockImplementation(() => {
          return Promise.resolve(mockCallAttempts.filter(a => a.destination_number === null));
        }),
        update: vi.fn().mockImplementation(({ where, data }) => {
          const target = mockCallAttempts.find(a => a.id === where.id);
          if (target) {
            Object.assign(target, data);
          }
          return Promise.resolve(target);
        }),
      },
      workspaceMemberBuyer: {
        findMany: vi.fn().mockImplementation(() => Promise.resolve(mockWorkspaceMemberBuyers)),
      },
      workspaceMember: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockWorkspaceMembers.find(m => m.id === where.id) || null);
        }),
        update: vi.fn().mockImplementation(({ where, data }) => {
          const target = mockWorkspaceMembers.find(m => m.id === where.id);
          if (target) {
            Object.assign(target, data);
          }
          return Promise.resolve(target);
        }),
      },
    };
  });

  it('should backfill existing buyer numbers, timeout, and concurrency into destination_numbers', async () => {
    const summary = await runDestinationNumberBackfill(prisma);

    expect(summary.destinationNumbersCreated).toBe(2);
    expect(mockDestinationNumbers).toHaveLength(2);

    const buyer1Dn = mockDestinationNumbers.find(dn => dn.buyer_id === 'buyer-1');
    expect(buyer1Dn.destination_number).toBe('+15551112233');
    expect(buyer1Dn.timeout).toBe(40);
    expect(buyer1Dn.max_concurrent_calls).toBe(3);
    expect(buyer1Dn.name).toBe('Arpit Solar Primary');
  });

  it('should preserve campaign priorities and weights when migrating campaign assignments', async () => {
    const summary = await runDestinationNumberBackfill(prisma);

    expect(summary.campaignDestinationsCreated).toBe(2);
    expect(mockCampaignDestinations).toHaveLength(2);

    const camp1Assignment = mockCampaignDestinations.find(cd => cd.priority === 1);
    expect(camp1Assignment.priority).toBe(1);
    expect(camp1Assignment.weight).toBe(100);
  });

  it('should accurately snapshot historical dialed numbers on CallAttempt records', async () => {
    const summary = await runDestinationNumberBackfill(prisma);

    expect(summary.callAttemptsSnapshotted).toBe(2);
    expect(mockCallAttempts[0].destination_number).toBe('+15551112233');
    expect(mockCallAttempts[0].destination_number_id).toBeDefined();
    expect(mockCallAttempts[1].destination_number).toBe('+15554445566');
    expect(mockCallAttempts[1].destination_number_id).toBeDefined();
  });

  it('should preserve multi-buyer member mappings without silently discarding or overwriting', async () => {
    const summary = await runDestinationNumberBackfill(prisma);

    // Single-buyer member updated safely
    expect(summary.membersPreserved).toBe(1);
    expect(mockWorkspaceMembers.find(m => m.id === 'member-1').buyer_id).toBe('buyer-1');

    // Multi-buyer member preserved in join table without forcing a lossy single buyer_id
    expect(summary.multiBuyerMembersCount).toBe(1);
    expect(mockWorkspaceMembers.find(m => m.id === 'member-multi').buyer_id).toBeNull();
    // Join table records remain untouched
    expect(mockWorkspaceMemberBuyers).toHaveLength(3);
  });

  it('should be completely idempotent when executed repeatedly', async () => {
    // Run 1st time
    const summary1 = await runDestinationNumberBackfill(prisma);
    expect(summary1.destinationNumbersCreated).toBe(2);
    expect(summary1.campaignDestinationsCreated).toBe(2);

    // Run 2nd time
    const summary2 = await runDestinationNumberBackfill(prisma);
    expect(summary2.destinationNumbersCreated).toBe(0);
    expect(summary2.destinationNumbersSkipped).toBe(2);
    expect(summary2.campaignDestinationsCreated).toBe(0);
    expect(summary2.campaignDestinationsSkipped).toBe(2);
    expect(summary2.callAttemptsSnapshotted).toBe(0); // already snapshotted

    // No duplicate records created in mock storage
    expect(mockDestinationNumbers).toHaveLength(2);
    expect(mockCampaignDestinations).toHaveLength(2);
  });
});
