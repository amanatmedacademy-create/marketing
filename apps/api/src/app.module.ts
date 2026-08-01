import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { AdsModule } from './modules/ads/ads.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { PipelinesModule } from './modules/pipelines/pipelines.module.js';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    PipelinesModule,
    WhatsAppModule,
    AdsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
