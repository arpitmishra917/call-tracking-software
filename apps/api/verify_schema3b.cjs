const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Phase 3B Schema Verification ---');
  
  // 1. Verify WorkspaceBalance reserved_micro default
  const wsId = 'ws-schema-test-1';
  const callId = 'call-schema-test-1';
  
  try {
    // Cleanup if exists
    await prisma.workspace.deleteMany({ where: { id: wsId }});
    
    // Create workspace
    const ws = await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'Schema Test WS',
        slug: 'schema-test-ws'
      }
    });
    
    // Create balance
    const balance = await prisma.workspaceBalance.create({
      data: {
        workspace_id: wsId,
        balance_micro: 5000000n,
        // Omit reserved_micro to test default
      }
    });
    
    if (balance.reserved_micro === 0n) {
      console.log('✅ WorkspaceBalance.reserved_micro defaults to 0n properly.');
    } else {
      console.log('❌ reserved_micro default failed:', balance.reserved_micro);
    }
    
    // 2. CallReservation references Call
    const call = await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        from_number: '+1234',
        to_number: '+5678',
        direction: 'INBOUND',
        status: 'INITIATED',
        provider: 'telnyx'
      }
    });
    
    const res1 = await prisma.callReservation.create({
      data: {
        call_id: call.id,
        workspace_id: wsId,
        original_reserved_micro: 10000n,
        total_reserved_micro: 10000n
      }
    });
    
    if (res1.status === 'ACTIVE') {
      console.log('✅ CallReservation defaults to ACTIVE properly.');
    }
    
    // 3. call_id uniqueness
    try {
      await prisma.callReservation.create({
        data: {
          call_id: call.id,
          workspace_id: wsId,
          original_reserved_micro: 20000n,
          total_reserved_micro: 20000n
        }
      });
      console.log('❌ call_id uniqueness constraint FAILED (allowed duplicate)!');
    } catch (err) {
      if (err.code === 'P2002') {
        console.log('✅ CallReservation.call_id uniqueness constraint enforces strictly.');
      } else {
        console.log('❌ Unexpected error on duplicate insert:', err);
      }
    }
    
    // Cleanup
    await prisma.workspace.delete({ where: { id: wsId }});
    console.log('✅ Cascade deletion cleared schema test data safely.');
    
  } catch (err) {
    console.error('Test script crashed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
