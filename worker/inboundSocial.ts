import type { Env } from './integrations';

type Row = Record<string, unknown>;

type InboundMessage = {
  channel: 'WHATSAPP' | 'INSTAGRAM';
  leadExternalId: string;
  externalContactId: string;
  externalAccountId: string;
  externalMessageId: string;
  displayName?: string;
  username?: string;
  phone?: string;
  body: string;
  sentAt: string;
  metadata: Row;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {