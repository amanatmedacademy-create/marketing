import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class MetaSignatureService {
  constructor(private readonly config: ConfigService) {}

  verify(rawBody: Buffer | undefined, signature: string | undefined): void {
    const appSecret = this.config.get<string>('META_APP_SECRET');
    if (!appSecret) throw new InternalServerErrorException('META_APP_SECRET is not configured');
    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new ForbiddenException('Missing Meta webhook signature');
    }

    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const received = signature.slice('sha256='.length);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(received, 'hex');

    if (
      expectedBuffer.length !== receivedBuffer.length
      || !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new ForbiddenException('Invalid Meta webhook signature');
    }
  }
}
