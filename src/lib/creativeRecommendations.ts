import {
  CREATIVE_INTELLIGENCE_THRESHOLDS,
  calculateCreativeConfidence,
  type CreativeConfidence,
  type CreativeHealth,
  type CreativeRowLike,
  type CreativeTrend,
  type TrendMetric,
} from './creativeIntelligence';

export type CreativeRecommendationAction = 'scale' | 'keep' | 'watch' | 'refresh' | 'stop';
export type CreativeRecommendation = { action: CreativeRecommendationAction; priority: number; confidence: CreativeConfidence; reason: string; signals: string[] };

const signed = (metric: TrendMetric) => {
  if (metric.state === 'new') return 'новые данные';
  if (metric.deltaPct === null) return 'нет сравнения';
  const value = Math.round(metric.deltaPct);
  return `${value > 0 ? '+' : ''}${value}%`;
};

function signals(current: CreativeRowLike, trend: CreativeTrend) {
  const out: string[] = [];
  const meaningful = CREATIVE_INTELLIGENCE_THRESHOLDS.health.meaningfulChangePct;
  if (Math.abs(trend.ctr.deltaPct || 0) >= meaningful) out.push(`CTR ${signed(trend.ctr)}`);
  if (trend.cpl.previous > 0 && Math.abs(trend.cpl.deltaPct || 0) >= CREATIVE_INTELLIGENCE_THRESHOLDS.health.cplChangePct) out.push(`CPL ${signed(trend.cpl)}`);
  if (trend.leads.state === 'new' || Math.abs(trend.leads.deltaPct || 0) >= meaningful) out.push(`лиды ${signed(trend.leads)}`);
  if (trend.sales.state === 'new' || Math.abs(trend.sales.deltaPct || 0) >= meaningful) out.push(`продажи ${signed(trend.sales)}`);
  if (trend.frequency.previous > 0 && Math.abs(trend.frequency.deltaPct || 0) >= meaningful) out.push(`frequency ${signed(trend.frequency)}`);
  else if ((current.frequency || 0) >= 3.5) out.push(`frequency ${(current.frequency || 0).toFixed(1)}`);
  return out.slice(0, 4);
}

export function calculateCreativeRecommendation(current: CreativeRowLike | undefined, trend: CreativeTrend, health: CreativeHealth, active = true): CreativeRecommendation {
  if (!current) return { action: 'watch', priority: 10, confidence: 'low', reason: 'Нет данных за последние 7 дней.', signals: [] };
  const confidence = calculateCreativeConfidence(current);
  const evidence = signals(current, trend);
  if (!active) return { action: 'watch', priority: 15, confidence, reason: 'Объявление не ACTIVE; рекомендация только для анализа.', signals: evidence };
  if (confidence === 'low' || health === 'insufficient') return { action: 'watch', priority: 20, confidence, reason: 'Недостаточно данных для уверенного действия.', signals: evidence };
  if (health === 'growing') {
    if (confidence === 'high' && (current.sales > 0 || current.leads >= 4)) return { action: 'scale', priority: 80, confidence, reason: evidence.length ? `Положительная динамика: ${evidence.join(' · ')}.` : 'Положительная динамика при достаточном объёме данных.', signals: evidence };
    return { action: 'keep', priority: 55, confidence, reason: 'Динамика положительная, но для масштабирования нужна более высокая уверенность.', signals: evidence };
  }
  if (health === 'fatiguing') {
    const ctrSevere = trend.ctr.deltaPct !== null && trend.ctr.deltaPct <= -25;
    const cplSevere = trend.cpl.previous > 0 && trend.cpl.deltaPct !== null && trend.cpl.deltaPct >= 25;
    const demandDown = (trend.leads.previous > 0 && (trend.leads.deltaPct || 0) <= -20) || (trend.sales.previous > 0 && (trend.sales.deltaPct || 0) <= -20);
    const frequencyPressure = (current.frequency || 0) >= 3.5 || (trend.frequency.deltaPct || 0) >= 10;
    if (confidence === 'high' && ctrSevere && cplSevere && demandDown && current.spend > 0) return { action: 'stop', priority: 100, confidence, reason: `Сильное ухудшение на достаточном sample${evidence.length ? `: ${evidence.join(' · ')}` : ''}. Перед остановкой проверьте бизнес-контекст.`, signals: evidence };
    return { action: 'refresh', priority: frequencyPressure ? 90 : 75, confidence, reason: `${frequencyPressure ? 'Есть признаки выгорания и давления частоты.' : 'Есть признаки выгорания.'}${evidence.length ? ` ${evidence.join(' · ')}.` : ''}`, signals: evidence };
  }
  return { action: 'keep', priority: 40, confidence, reason: evidence.length ? `Метрики в рабочем диапазоне: ${evidence.join(' · ')}.` : 'Метрики стабильны; резких изменений не обнаружено.', signals: evidence };
}

export const recommendationLabel: Record<CreativeRecommendationAction, string> = {
  scale: 'МАСШТАБИРОВАТЬ', keep: 'ОСТАВИТЬ', watch: 'НАБЛЮДАТЬ', refresh: 'ОБНОВИТЬ КРЕАТИВ', stop: 'ОСТАНОВИТЬ',
};
