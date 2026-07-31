import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ConversationStatus, MessageType } from '@imds/database';

export class CreateWhatsAppChannelDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  configId?: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsUUID()
  dealId?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

export class SendMessageDto {
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mediaUrl?: string;
}
