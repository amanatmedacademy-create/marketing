import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class TokenCryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): string {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(value: string): string {
    const key = this.getKey();
    const parts = value.split('.');
    if (parts.length !== 3) throw new InternalServerErrorException('Invalid encrypted token format');
    const [ivPart, tagPart, dataPart] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey(): Buffer {
    const encoded = this.config.get<string>('META_TOKEN_ENCRYPTION_KEY');
    if (!encoded) throw new InternalServerErrorException('META_TOKEN_ENCRYPTION_KEY is not configured');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException('META_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    return key;
  }
}
