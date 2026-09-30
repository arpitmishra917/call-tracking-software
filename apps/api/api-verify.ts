import { PhoneNumbersService } from './src/phone-numbers/phone-numbers.service.js';
import { TelnyxProvisioningService } from './src/phone-numbers/telnyx-provisioning.service.js';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const prisma = new PrismaClient() as any;
  const telnyx = new TelnyxProvisioningService(new Logger('Telnyx'), prisma, null as any);
  const service = new PhoneNumbersService(prisma, new Logger('PhoneNumbersService'), telnyx);
  
  const numbers = await service.listWorkspaceNumbers('0d63db1a-fc8e-41da-912d-bd24d3edb75e');
  console.log(JSON.stringify(numbers, null, 2));

  await prisma.$disconnect();
}

bootstrap();
