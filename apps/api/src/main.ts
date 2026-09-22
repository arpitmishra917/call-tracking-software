import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // 1. Secure HTTP Headers
  app.use(helmet());

  // 2. CORS configuration (restrict allowed origins appropriately, avoiding '*' if credentials are true)
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001', // Example limit
    credentials: true,
  });

  // 3. API Rate Limiting
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
