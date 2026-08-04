import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard, TenantDbService, TenantGuard } from './security';

@Global()
@Module({
  providers: [TenantDbService, JwtAuthGuard, TenantGuard],
  exports: [TenantDbService, JwtAuthGuard, TenantGuard],
})
export class SecurityModule {}
