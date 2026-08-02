import type { Deal, PipelineStage } from '../deals/types';

export type AdvertisingNetwork =
  | 'meta'
  | 'tiktok'
  | 'google'
  | 'yandex'
  | 'telegram'
  | 'linkedin'
  | 'organic'
  | 'direct'
  | 'unknown';

export type FunnelStageSets = {
  won: Set<string>;
  lost: Set<string>;
  qualified: Set<string>;
  appointments: Set<string>;
  visits: Set<string>;
};

const aliases: Array<{ network: AdvertisingNetwork; pattern: RegExp }> = [
  { network: 'meta', pattern: /meta|facebook|instagram|fbads|igads/i },
  { network: 'tiktok', pattern: /tiktok|tik tok/i },
  { network: 'google', pattern: /google|youtube|gads|adwords/i },
  { network: 'yandex', pattern: /yandex|яндекс/i },
  { network: 'telegram', pattern: /telegram|телеграм/i },
  { network: 'linkedin', pattern: /linkedin/i },
  { network: 'organic', pattern: /organic|органик|seo|реферал|recommend|сарафан/i },
  { network: 'direct', pattern: /direct|прямой|без рекламы/i },
];

export function normalizeSource(source: string | null | undefined) {
  return source?.trim() || 'Без источника';
}

export function detectAdvertisingNetwork(source: string | null | undefined): AdvertisingNetwork {
  const value = normalizeSource(source);
  if (value === 'Без источника') return 'unknown';
  return aliases.find(item => item.pattern.test(value))?.network ?? 'unknown';
}

export function isAttributedDeal(deal: Pick<Deal, 'source'>) {
  return detectAdvertisingNetwork(deal.source) !== 'unknown';
}

export function buildFunnelStageSets(stages: PipelineStage[]): FunnelStageSets {
  const won = new Set(stages.filter(stage => stage.isWon).map(stage => stage.id));
  const lost = new Set(stages.filter(stage => stage.isLost).map(stage => stage.id));
  const appointments = new Set(stages.filter(stage => /консультац|запис|назнач|appointment/i.test(stage.name)).map(stage => stage.id));
  const visits = new Set(stages.filter(stage => /пришел|пришёл|визит|посет|visit/i.test(stage.name)).map(stage => stage.id));
  const qualified = new Set(stages.filter(stage => !stage.isLost && !/нов|new/i.test(stage.name)).map(stage => stage.id));
  return { won, lost, qualified, appointments, visits };
}

export function sumWonRevenue(deals: Deal[], wonStageIds: Set<string>) {
  return deals.reduce((sum, deal) => wonStageIds.has(deal.stageId) ? sum + Number(deal.oneTimeAmount ?? 0) : sum, 0);
}

export function percent(part: number, total: number) {
  return total > 0 ? Math.round(part / total * 100) : 0;
}
