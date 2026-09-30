import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { PhoneNumbersService } from './src/phone-numbers/phone-numbers.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(PhoneNumbersService);

  const dryRun = !process.argv.includes('--execute');
  console.log(`Starting Phone Number Type Backfill (Dry Run: ${dryRun})...`);

  const results = await service.backfillNumberTypes(dryRun);
  
  console.log(`Backfill Complete:`, results);
  if (dryRun) {
    console.log('Run with --execute to apply changes.');
  }

  await app.close();
}

bootstrap();
