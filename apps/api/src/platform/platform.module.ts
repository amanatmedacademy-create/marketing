import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { EntityManager } from 'typeorm';
import { CurrentAgency, TenantDbService } from '../common/security';
import { ClientEntity, DataSourceEntity, IntegrationEntity } from '../database/entities';

class CreateClientDto {
  @IsString() @Length(2, 200) company!: string;
  @IsOptional() @IsUrl() url?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() language?: string;
}

class CreateDataSourceDto {
  @IsString() clientId!: string;
  @IsString() integrationSlug!: string;
  @IsString() @Length(1, 200) label!: string;
  @IsOptional() @IsString() externalIdentifier?: string;
}

@Injectable()
class PlatformService {
  constructor(private readonly tenantDb: TenantDbService) {}

  listClients(agencyId: string): Promise<ClientEntity[]> {
    return this.tenantDb.run(agencyId, manager => manager.find(ClientEntity, { order: { createdAt: 'DESC' } }));
  }

  createClient(agencyId: string, dto: CreateClientDto): Promise<ClientEntity> {
    return this.tenantDb.run(agencyId, async manager => {
      const client = manager.create(ClientEntity, {
        agencyId,
        company: dto.company.trim(),
        url: dto.url ?? null,
        timezone: dto.timezone ?? 'Asia/Almaty',
        country: dto.country ?? 'KZ',
        language: dto.language ?? 'ru',
      });
      return manager.save(client);
    });
  }

  listDataSources(agencyId: string): Promise<DataSourceEntity[]> {
    return this.tenantDb.run(agencyId, manager => manager.find(DataSourceEntity, { order: { createdAt: 'DESC' } }));
  }

  createDataSource(agencyId: string, dto: CreateDataSourceDto): Promise<DataSourceEntity> {
    return this.tenantDb.run(agencyId, async (manager: EntityManager) => {
      const integration = await manager.findOneByOrFail(IntegrationEntity, { slug: dto.integrationSlug });
      const source = manager.create(DataSourceEntity, {
        agencyId,
        clientId: dto.clientId,
        integrationId: integration.id,
        label: dto.label.trim(),
        externalIdentifier: dto.externalIdentifier ?? null,
        status: 'connected',
      });
      return manager.save(source);
    });
  }
}

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('v1')
class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Get('clients') listClients(@CurrentAgency() agencyId: string) {
    return this.service.listClients(agencyId);
  }

  @Post('clients') createClient(@CurrentAgency() agencyId: string, @Body() dto: CreateClientDto) {
    return this.service.createClient(agencyId, dto);
  }

  @Get('data-sources') listDataSources(@CurrentAgency() agencyId: string) {
    return this.service.listDataSources(agencyId);
  }

  @Post('data-sources') createDataSource(@CurrentAgency() agencyId: string, @Body() dto: CreateDataSourceDto) {
    return this.service.createDataSource(agencyId, dto);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
