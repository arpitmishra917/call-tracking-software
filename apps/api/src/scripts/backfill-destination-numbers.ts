import { PrismaClient } from '@prisma/client';

export interface BackfillSummary {
  destinationNumbersCreated: number;
  destinationNumbersSkipped: number;
  campaignDestinationsCreated: number;
  campaignDestinationsSkipped: number;
  callAttemptsSnapshotted: number;
  callAttemptsSkipped: number;
  membersPreserved: number;
  multiBuyerMembersCount: number;
}

export async function runDestinationNumberBackfill(prisma: PrismaClient): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    destinationNumbersCreated: 0,
    destinationNumbersSkipped: 0,
    campaignDestinationsCreated: 0,
    campaignDestinationsSkipped: 0,
    callAttemptsSnapshotted: 0,
    callAttemptsSkipped: 0,
    membersPreserved: 0,
    multiBuyerMembersCount: 0,
  };

  // 1. Backfill Destination Numbers from Buyers
  const buyers = await prisma.buyer.findMany();
  for (const buyer of buyers) {
    if (!buyer.destination_number) continue;

    const existing = await prisma.destinationNumber.findUnique({
      where: {
        workspace_id_destination_number: {
          workspace_id: buyer.workspace_id,
          destination_number: buyer.destination_number,
        },
      },
    });

    if (!existing) {
      await prisma.destinationNumber.create({
        data: {
          workspace_id: buyer.workspace_id,
          buyer_id: buyer.id,
          destination_number: buyer.destination_number,
          name: `${buyer.name} Primary`,
          timeout: buyer.timeout || 30,
          max_concurrent_calls: buyer.max_concurrent_calls || 1,
          status: buyer.status || 'ACTIVE',
        },
      });
      summary.destinationNumbersCreated++;
    } else {
      summary.destinationNumbersSkipped++;
    }
  }

  // 2. Backfill CampaignDestinationNumbers from CampaignBuyers
  const campaignBuyers = await prisma.campaignBuyer.findMany();
  for (const cb of campaignBuyers) {
    // Find the destination number for this buyer
    const dn = await prisma.destinationNumber.findFirst({
      where: {
        workspace_id: cb.workspace_id,
        buyer_id: cb.buyer_id,
      },
    });

    if (!dn) continue;

    const existingCd = await prisma.campaignDestinationNumber.findUnique({
      where: {
        campaign_id_destination_number_id: {
          campaign_id: cb.campaign_id,
          destination_number_id: dn.id,
        },
      },
    });

    if (!existingCd) {
      await prisma.campaignDestinationNumber.create({
        data: {
          workspace_id: cb.workspace_id,
          campaign_id: cb.campaign_id,
          destination_number_id: dn.id,
          priority: cb.priority,
          weight: 100,
          status: cb.status || 'ACTIVE',
        },
      });
      summary.campaignDestinationsCreated++;
    } else {
      summary.campaignDestinationsSkipped++;
    }
  }

  // 3. Backfill CallAttempt historical destination snapshots
  const callAttempts = await prisma.callAttempt.findMany({
    where: {
      destination_number: null,
    },
    include: {
      buyer: true,
    },
  });

  for (const attempt of callAttempts) {
    if (attempt.buyer && attempt.buyer.destination_number) {
      // Find matching destination number entity if exists
      const dn = await prisma.destinationNumber.findFirst({
        where: {
          workspace_id: attempt.buyer.workspace_id,
          buyer_id: attempt.buyer_id,
          destination_number: attempt.buyer.destination_number,
        },
      });

      await prisma.callAttempt.update({
        where: { id: attempt.id },
        data: {
          destination_number: attempt.buyer.destination_number,
          ...(dn && { destination_number_id: dn.id }),
        },
      });
      summary.callAttemptsSnapshotted++;
    } else {
      summary.callAttemptsSkipped++;
    }
  }

  // 4. Safe member mapping & multi-buyer verification
  const memberBuyerRows = await prisma.workspaceMemberBuyer.findMany();
  const memberMap = new Map<string, string[]>();
  for (const row of memberBuyerRows) {
    const list = memberMap.get(row.workspace_member_id) || [];
    list.push(row.buyer_id);
    memberMap.set(row.workspace_member_id, list);
  }

  for (const [memberId, buyerIds] of memberMap.entries()) {
    if (buyerIds.length > 1) {
      // Multi-buyer member: DO NOT overwrite or collapse! Preserve join table records.
      summary.multiBuyerMembersCount++;
    } else if (buyerIds.length === 1) {
      // Single buyer member: safely ensure workspace_member.buyer_id is set
      const member = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
      });
      if (member && !member.buyer_id) {
        await prisma.workspaceMember.update({
          where: { id: memberId },
          data: { buyer_id: buyerIds[0] },
        });
      }
      summary.membersPreserved++;
    }
  }

  return summary;
}
