import { useMemo, useState } from 'react';
import type { Deal } from '../deals/types';

type Period = 7 | 14 | 30;

type Props = {
  deals: Deal[];
  loading: boolean;
};

const money = new Intl.NumberFormat('ru-KZ', {
  style: 'currency',
  currency: 'KZT',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function resolveDealDate(deal: Deal) {
  if (deal.createdAt) {
    const date = new Date(deal.createdAt);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (deal.order > 1_000_000_000_000) {
    const date = new Date(deal.order);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function DealsTrendChart({ deals, loading }: Props) {
  const [period, setPeriod] = useState<Period>(14);
  const points = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: period }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (period - 1 - index));
      return { date, count: 0, amount: 0 };
    });

    for (const deal of deals) {
      const created = resolveDealDate(deal);
      if (!created) continue;
      created.setHours(0, 0, 0, 0);
      const index = Math.round((created.getTime() - days[0].date.getTime()) / 86_400_000);
      if (index < 0 || index >= days.length) continue;
      days[index].count += 1;
      days[index].amount += Number(deal.oneTimeAmount ?? 0);
    }
    return days;
  }, [deals, period]);

  const maxCount = Math.max(...points.map(point => point.count), 1);
  const width = 720;
  const height = 210;
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? width / 2 : (index / (points.length - 1)) * width,
    y: height - (point.count / maxCount) * (height - 24) - 12,
    ...point,
  }));
  const line = coordinates.map(point => `${point.x},${point.y}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const totalCount = points.reduce((sum, point) => sum + point.count, 0);
  const totalAmount = points.reduce((sum, point) => sum + point.amount, 0);
  const hasDates = points.some(point => point.count > 0);

  return <article className="analytics-card trend-card">
    <header className="analytics-card-head trend-head">
      <div><h2>Динамика новых сделок</h2><p>Количество созданных сделок по дням</p></div>
      <div className="trend-periods">{([7, 14, 30] as Period[]).map(value => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value} дней</button>)}</div>
    </header>
    <div className="trend-summary"><span><small>Новых сделок</small><strong>{loading ? '—' : totalCount}</strong></span><span><small>Сумма периода</small><strong>{loading ? '—' : money.format(totalAmount)}</strong></span></div>
    {hasDates ? <div className="trend-chart">
      <div className="trend-grid"><span /><span /><span /><span /></div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Динамика новых сделок">
        <defs><linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        <polygon points={area} fill="url(#trend-area)" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {coordinates.map(point => point.count ? <circle key={point.date.toISOString()} cx={point.x} cy={point.y} r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="3"><title>{point.date.toLocaleDateString('ru-RU')}: {point.count} сделок, {money.format(point.amount)}</title></circle> : null)}
      </svg>
      <div className="trend-labels">{points.filter((_, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2)).map(point => <span key={point.date.toISOString()}>{point.date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</span>)}</div>
    </div> : <div className="trend-empty"><strong>Недостаточно дат для графика</strong><span>Новые сделки будут отображаться автоматически. Старые записи появятся после добавления `createdAt` в API.</span></div>}
  </article>;
}
