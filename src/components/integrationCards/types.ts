export type CardIntegrationProvider =
  | 'meta'
  | 'instagram'
  | 'telegram'
  | 'tiktok'
  | 'bitrix'
  | 'n8n'
  | 'waba'
  | 'wazzup'
  | 'binotel'
  | 'sipuni';

export type CardConnectionStatus =
  | 'connected'
  | 'syncing'
  | 'error'
  | 'disconnected'
  | 'not_connected';

export interface CardIntegrationStat {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}

export interface CardIntegrationField {
  label: string;
  value: string;
}

export interface CardIntegrationSummary {
  id: CardIntegrationProvider;
  name: string;
  description: string;
  status: CardConnectionStatus;
  lastSyncedAt: string | null;
  stats: CardIntegrationStat[];
  fields: CardIntegrationField[];
  errorMessage?: string;
}
