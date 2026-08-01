import { IsOptional, IsString, Matches } from 'class-validator';

export class ConfigureMetaAdsDto {
  @IsString()
  accessToken!: string;

  @IsOptional()
  @IsString()
  businessManagerId?: string;

  @IsOptional()
  @IsString()
  adAccountId?: string;

  @IsOptional()
  @IsString()
  pageId?: string;
}

export class MetaAdsRangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  since!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  until!: string;

  @IsOptional()
  @IsString()
  adAccountId?: string;
}
