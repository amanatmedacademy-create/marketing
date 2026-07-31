import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType } from '@imds/database';

type SendPayload = {
  phoneNumberId: string;
  accessToken: string;
  recipient: string;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
};

type MetaSendResponse = {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

@Injectable()
export class MetaGraphService {
  constructor(private readonly config: ConfigService) {}

  async sendMessage(payload: SendPayload) {
    const version = this.config.get<string>('META_GRAPH_API_VERSION', 'v23.0');
    const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(payload.phoneNumberId)}/messages`;
    const body = this.buildMessageBody(payload);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${payload.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => ({})) as MetaSendResponse;
    if (!response.ok || data.error) {
      throw new BadGatewayException({
        message: data.error?.message ?? `Meta Graph API returned ${response.status}`,
        provider: 'META_WHATSAPP',
        code: data.error?.code,
        subcode: data.error?.error_subcode,
      });
    }

    const externalMessageId = data.messages?.[0]?.id;
    if (!externalMessageId) {
      throw new BadGatewayException('Meta Graph API did not return a message id');
    }

    return { externalMessageId, raw: data };
  }

  private buildMessageBody(payload: SendPayload) {
    const common = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.recipient,
    };

    if (payload.type === MessageType.TEXT) {
      return { ...common, type: 'text', text: { preview_url: true, body: payload.text } };
    }

    const mediaType = this.mapMediaType(payload.type);
    if (mediaType && payload.mediaUrl) {
      return {
        ...common,
        type: mediaType,
        [mediaType]: {
          link: payload.mediaUrl,
          ...(payload.text ? { caption: payload.text } : {}),
        },
      };
    }

    throw new BadGatewayException(`Unsupported WhatsApp message type: ${payload.type}`);
  }

  private mapMediaType(type: MessageType): 'image' | 'video' | 'audio' | 'document' | null {
    if (type === MessageType.IMAGE) return 'image';
    if (type === MessageType.VIDEO) return 'video';
    if (type === MessageType.AUDIO) return 'audio';
    if (type === MessageType.DOCUMENT) return 'document';
    return null;
  }
}
