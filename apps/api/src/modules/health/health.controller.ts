import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check API availability' })
  check() {
    return {
      data: {
        status: 'ok',
        service: 'imds-api',
        timestamp: new Date().toISOString(),
      },
      error: null,
    };
  }
}
