import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard, TenantDbService, TenantGuard } from './common/security';
import { AgencyEntity, ClientEntity, DataSourceEntity, IntegrationEntity, UserEntity } from './database/entities';
import { MetricsModule } from './metrics/metrics.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        ssl: config.get<string>('DATABASE_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
        entities: [AgencyEntity, UserEntity, ClientEntity, IntegrationEntity, DataSourceEntity],
        synchronize: false,
        logging: config.get<string>('NODE_ENV') !== 'production',
        extra: { max: 20, application_name: 'imds-marketing-api' },
      }),
    }),
    PlatformModule,
    MetricsModule,
  ],
  providers: [
    TenantDbService,
    JwtAuthGuard,
    TenantGuard,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
  ],
  exports: [TenantDbService],
})
export class AppModule {}
