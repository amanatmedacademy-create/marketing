import { IsBoolean, IsHexColor, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePipelineDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreatePipelineStageDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isWon?: boolean;

  @IsOptional()
  @IsBoolean()
  isLost?: boolean;
}
