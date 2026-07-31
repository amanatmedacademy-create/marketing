import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { PipelinesController } from './pipelines.controller.js';
import { PipelinesService } from './pipelines.service.js';

@Module({
  controllers: [PipelinesController],
  providers: [PipelinesService, RolesGuard],
})
export class PipelinesModule {}
