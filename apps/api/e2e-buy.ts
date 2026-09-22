import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './src/app.module';
import { PhoneNumbersService } from './src/phone-numbers/phone-numbers.service';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();

  const prisma = app.get(PrismaService);
  const phoneNumbersService = app.get(PhoneNumbersService);

  // 1. Get workspace
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    console.error('No workspace found');
    process.exit(1);
  }
  console.log('Using Workspace:', workspace.id);

  // 2. Search numbers
  const available = await phoneNumbersService.searchAvailableNumbers('US', 1);
  if (!available || available.length === 0) {
    console.error('No available numbers found');
    process.exit(1);
  }
  
  const targetNumber = available[0].phoneNumber;
  console.log('Target Number:', targetNumber);

  // 3. Provision number
  try {
    const result = await phoneNumbersService.provisionNumber(
      workspace.id,
      targetNumber,
      'Test Number E2E'
    );
    console.log('Provision Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Provision Error:', error.message);
  }

  await app.close();
}

bootstrap();
