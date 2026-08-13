export type CreativeHealth = 'growing' | 'stable' | 'fatiguing' | 'insufficient';
export type CreativeConfidence = 'high' | 'medium' | 'low';
export type TrendState = 'up' | 'down' | 'flat' | 'new' | 'none';

export type CreativeRowLike = {
  key: string;
  account_id: string;
  platform: string;
  currency?: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  sales: number;
  revenue: number;
  ctr: number;
  cost_per_result: number;
  frequency?: number;
};

export type TrendMetric = {
  current: number;
  previous: number;
  deltaPct: number | null;
  state: TrendState;
};

export type CreativeTrend = {
  ctr: TrendMetric;
  cpl: TrendMetric;
  leads: TrendMetric;
  sales: TrendMetric;
  spend: TrendMetric;
  impressions: TrendMetric;
  frequency: TrendMetric;
};

export const CREATIVE_INTELLIGENCE_THRESHOLDS = {
  confidence: {
    medium: { impressions: 1000, clicks: 30, leads: 4, sales: 2 },
    high: { impressions: 5000, clicks: 120, leads: 12, sales: 4 },
  },
  health: {
    meaningfulChangePct: 10,
    cplChangePct: 8,
    stableBandPct: 10,
  },
} as const;

const finite = (value: number) => Number.isFinite(value) ? Number(value) : 0;
const clamp01 = (value: number) => Math.max(0, Math.min(1, finite(value)));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const median = (values: number[]) => {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function calculateCreativeConfidence(row: CreativeRowLike): CreativeConfidence {
  const { medium, high } = CREATIVE_INTELLIGENCE_THRESHOLDS.confidence;
  if (
    row.impressions >= high.impressions ||
    row.clicks >= high.clicks ||
    row.leads >= high.leads ||
    row.sales >= high.sales
  ) return 'high';
  if (
    row.impressions >= medium.impressions ||
    row.clicks >= medium.clicks ||
    row.leads >= medium.leads ||
    row.sales >= medium.sales
  ) return 'medium';
  return 'low';
}

function deltaMetric(currentValue: number, previousValue: number): TrendMetric {
  const current = finite(currentValue);
  const previous = finite(previousValue);
  if (previous === 0) {
    if (current === 0) return { current, previous, deltaPct: 0, state: 'flat' };
    return { current, previous, deltaPct: null, state: 'new' };
  }
  const deltaPct = ((current - previous) / Math.abs(previous)) * 100;
  const state: TrendState = Math.abs(deltaPct) < 0.01 ? 'flat' : deltaPct > 0 ? 'up' : 'down';
  return { current, previous, deltaPct, state };
}

const emptyMetrics = (): CreativeRowLike => ({
  key: '', account_id: '', platform: '', currency: null,
  impressions: 0, clicks: 0, spend: 0, leads: 0, sales: 0, revenue: 0,
  ctr: 0, cost_per_result: 0, frequency: 0,
});

export function calculateCreativeTrend(current?: CreativeRowLike, previous?: CreativeRowLike): CreativeTrend {
  const now = current || emptyMetrics();
  const before = previous || emptyMetrics();
  return {
    ctr: deltaMetric(now.ctr, before.ctr),
    cpl: deltaMetric(now.cost_per_result, before.cost_per_result),
    leads: deltaMetric(now.leads, before.leads),
    sales: deltaMetric(now.sales, before.sales),
    spend: deltaMetric(now.spend, before.spend),
    impressions: deltaMetric(now.impressions, before.impressions),
    frequency: deltaMetric(now.frequency || 0, before.frequency || 0),
  };
}

function normalized(value: number, maximum: number) {
  if (maximum <= 0) return 0;
  return clamp01(value / maximum);
}

function volumeScore(row: CreativeRowLike, peers: CreativeRowLike[]) {
  const maxImpressions = Math.max(1, ...peers.map((item) => Math.max(0, item.impressions)));
  return clamp01(Math.log10(Math.max(10, row.impressions)) / Math.log10(Math.max(10, maxImpressions)));
}

function accountCplScore(row: CreativeRowLike, peers: CreativeRowLike[]) {
  if (row.cost_per_result <= 0 || row.leads <= 0) return 0;
  const group = peers.filter((item) =>
    item.account_id === row.account_id &&
    item.platform === row.platform &&
    String(item.currency || '') === String(row.currency || '') &&
    item.cost_per_result > 0 && item.leads > 0,
  );
  const benchmark = median(group.map((item) => item.cost_per_result));
  if (benchmark <= 0) return 0;
  return clamp01((benchmark / row.cost_per_result) / 1.5);
}

export function calculateCreativeScore(row: CreativeRowLike, peers: CreativeRowLike[]): number {
  const pool = peers.length ? peers : [row];
  const maxSales = Math.max(1, ...pool.map((item) => Math.max(0, item.sales)));
  const maxLeads = Math.max(1, ...pool.map((item) => Math.max(0, item.leads)));
  const maxCtr = Math.max(0.01, ...pool.map((item) => Math.max(0, Math.min(20, item.ctr))));
  const raw =
    normalized(row.sales, maxSales) * 0.32 +
    normalized(row.leads, maxLeads) * 0.28 +
    normalized(Math.min(20, row.ctr), maxCtr) * 0.18 +
    volumeScore(row, pool) * 0.17 +
    accountCplScore(row, pool) * 0.05;
  const confidence = calculateCreativeConfidence(row);
  const multiplier = confidence === 'high' ? 1 : confidence === 'medium' ? 0.78 : 0.35;
  return Math.round(raw * multiplier * 10000) / 100;
}

export function rankCreatives<T extends CreativeRowLike>(rows: T[]): T[] {
  const scored = rows.map((row) => ({ row, score: calculateCreativeScore(row, rows), confidence: calculateCreativeConfidence(row) }));
  const reliable = scored.filter((item) => item.confidence !== 'low').sort((a, b) => b.score - a.score || b.row.sales - a.row.sales || b.row.leads - a.row.leads || b.row.impressions - a.row.impressions);
  const low = scored.filter((item) => item.confidence === 'low').sort((a, b) => b.score - a.score || b.row.impressions - a.row.impressions);
  return [...reliable, ...low].map((item) => item.row);
}

export function calculateCreativeHealth(current: CreativeRowLike | undefined, trend: CreativeTrend): CreativeHealth {
  if (!current || calculateCreativeConfidence(current) === 'low') return 'insufficient';
  const comparable = [trend.ctr, trend.cpl, trend.leads, trend.sales].filter((metric) => metric.deltaPct !== null).length;
  if (comparable < 2) return 'insufficient';

  const { meaningfulChangePct, cplChangePct, stableBandPct } = CREATIVE_INTELLIGENCE_THRESHOLDS.health;
  const ctrUp = (trend.ctr.deltaPct || 0) >= meaningfulChangePct;
  const cplDown = trend.cpl.previous > 0 && (trend.cpl.deltaPct || 0) <= -cplChangePct;
  const demandUp = (trend.leads.deltaPct || 0) >= meaningfulChangePct || (trend.sales.deltaPct || 0) >= meaningfulChangePct || trend.leads.state === 'new' || trend.sales.state === 'new';
  if ([ctrUp, cplDown, demandUp].filter(Boolean).length >= 2) return 'growing';

  const ctrDown = (trend.ctr.deltaPct || 0) <= -meaningfulChangePct;
  const cplUp = trend.cpl.previous > 0 && (trend.cpl.deltaPct || 0) >= cplChangePct;
  const deliveryContinues = current.impressions >= CREATIVE_INTELLIGENCE_THRESHOLDS.confidence.medium.impressions || current.spend > 0;
  const frequencyUp = trend.frequency.previous > 0 && (trend.frequency.deltaPct || 0) >= meaningfulChangePct;
  if (deliveryContinues && ctrDown && cplUp && (frequencyUp || trend.impressions.current > 0 || trend.spend.current > 0)) return 'fatiguing';

  const keyDeltas = [trend.ctr.deltaPct, trend.cpl.deltaPct, trend.leads.deltaPct, trend.sales.deltaPct].filter((value): value is number => value !== null);
  if (keyDeltas.length && keyDeltas.every((value) => Math.abs(value) <= stableBandPct)) return 'stable';
  return 'stable';
}

export function buildCreativeExplanation(row: CreativeRowLike, peers: CreativeRowLike[], rank: number): string {
  const confidence = calculateCreativeConfidence(row);
  if (confidence === 'low') return 'Данных недостаточно для высокой уверенности; позиция предварительная и не вытесняет креативы с достаточным sample.';

  const clauses: string[] = [];
  const maxSales = Math.max(0, ...peers.map((item) => item.sales));
  const maxLeads = Math.max(0, ...peers.map((item) => item.leads));
  if (row.sales > 0 && row.sales === maxSales) clauses.push(rank === 1 ? 'Лучший по продажам' : 'Один из лидеров по продажам');
  else if (row.leads > 0 && row.leads === maxLeads) clauses.push('Лучший по объёму лидов');
  else if (row.leads > 0) clauses.push(`${Math.round(row.leads)} лидов за период`);

  const cplGroup = peers.filter((item) => item.account_id === row.account_id && item.platform === row.platform && String(item.currency || '') === String(row.currency || '') && item.cost_per_result > 0 && item.leads > 0);
  const cplMedian = median(cplGroup.map((item) => item.cost_per_result));
  if (cplMedian > 0 && row.cost_per_result > 0 && row.cost_per_result < cplMedian) {
    const better = ((cplMedian - row.cost_per_result) / cplMedian) * 100;
    if (better >= 5) clauses.push(`CPL ниже медианы кабинета на ${Math.round(better)}%`);
  }

  const platformPeers = peers.filter((item) => item.platform === row.platform && item.impressions > 0);
  const ctrAverage = average(platformPeers.map((item) => item.ctr).filter((value) => value > 0));
  if (ctrAverage > 0 && row.ctr > ctrAverage) {
    const better = ((row.ctr - ctrAverage) / ctrAverage) * 100;
    if (better >= 5) clauses.push(`CTR выше среднего по платформе на ${Math.round(better)}%`);
  }

  if (!clauses.length) clauses.push('Сбалансированный результат по продажам, лидам, CTR и объёму показов');
  return `${clauses.slice(0, 3).join(' + ')}.`;
}
