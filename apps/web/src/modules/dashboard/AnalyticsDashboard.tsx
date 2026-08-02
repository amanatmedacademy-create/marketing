import { useMemo } from 'react';
import { ArrowUpRight, BarChart3, CircleDollarSign, Clock3, MessageSquareText, Target, Workflow } from 'lucide-react';
import { useDealsQuery, usePipelinesQuery } from '../deals/api/useDeals';
import type { Deal } from '../deals/types';
import { DealsTrendChart } from './DealsTrendChart';

type DashboardMetrics = {
  amountInWork: number;
  newDeals: number;
  openTasks: number;
  unansweredConversations: number;
};

type Stage = { id: string; name: string; position: number };

type Props = {
  userName: string;
  metrics: DashboardMetrics;
  stages: Stage[];
  loading: boolean;
  error: string;
  onOpenDeals: () => void;
  onOpenTasks: () => void;
  onOpenInbox: () => void;
  onOpenAds: () => void;
};

const money = new Intl.NumberFormat('ru-KZ', {
  style: 'currency',
  currency: 'KZT',
  maximumFractionDigits: 0,
});

export function AnalyticsDashboard({
  userName,
  metrics,
  stages,
  loading,
  error,
  onOpenDeals,
  onOpenTasks,
  onOpenInbox,
  onOpenAds,
}: Props) {
  const pipelinesQuery = usePipelinesQuery();
  const pipeline = pipelinesQuery.data?.find(item => item.isDefault) ?? pipelinesQuery.data?.[0];
  const dealsQuery = useDealsQuery(pipeline?.id);
  const deals = dealsQuery.data?.items ?? [];
  const analyticsLoading = loading || pipelinesQuery.isLoading || dealsQuery.isLoading;

  const stageRows = useMemo(() => (pipeline?.stages ?? []).map(stage => {
    const stageDeals = deals.filter(deal => deal.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      count: stageDeals.length,
      amount: stageDeals.reduce((sum, deal) => sum + Number(deal.oneTimeAmount ?? 0), 0),
    };
  }), [deals, pipeline]);

  const sourceRows = useMemo(() => {
    const grouped = new Map<string, { count: number; amount: number }>();
    for (const deal of deals) {
      const source = deal.source?.trim() || 'Без источника';
      const current = grouped.get(source) ?? { count: 0, amount: 0 };
      grouped.set(source, {
        count: current.count + 1,
        amount: current.amount + Number(deal.oneTimeAmount ?? 0),
      });
    }
    return [...grouped.entries()]
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [deals]);

  const totalAmount = deals.reduce((sum, deal) => sum + Number(deal.oneTimeAmount ?? 0), 0);
  const averageDeal = deals.length ? totalAmount / deals.length : 0;
  const wonStageIds = new Set((pipeline?.stages ?? []).filter(stage => stage.isWon).map(stage => stage.id));
  const wonDeals = deals.filter(deal => wonStageIds.has(deal.stageId));
  const conversion = deals.length ? Math.round((wonDeals.length / deals.length) * 100) : 0;
  const countMax = Math.max(...stageRows.map(item => item.count), 1);
  const sourceMax = Math.max(...sourceRows.map(item => item.count), 1);
  const displayedStages = stageRows.length ? stageRows : stages.map(stage => ({ id: stage.id, name: stage.name, color: '#4f6ef7', count: 0, amount: 0 }));

  return <div className="analytics-dashboard">
    <header className="analytics-hero">
      <div>
        <span className="analytics-eyebrow">Обзор бизнеса</span>
        <h1>Добро пожаловать, {userName}</h1>
        <p>Продажи, источники, воронка и состояние CRM в одном экране.</p>
      </div>
      <div className="analytics-hero-actions">
        <span className={`connection-status ${error ? 'error' : ''}`}>{analyticsLoading ? 'Подключение…' : error ? 'Ошибка подключения' : 'Данные актуальны'}</span>
        <button onClick={onOpenDeals}>Открыть CRM <ArrowUpRight size={15} /></button>
      </div>
    </header>

    <section className="analytics-kpis">
      <KpiCard icon={CircleDollarSign} label="Сумма в работе" value={analyticsLoading ? '—' : money.format(metrics.amountInWork)} hint="Активный портфель" tone="violet" />
      <KpiCard icon={Workflow} label="Всего сделок" value={analyticsLoading ? '—' : String(deals.length)} hint="В выбранной воронке" tone="blue" onClick={onOpenDeals} />
      <KpiCard icon={Target} label="Средний чек" value={analyticsLoading ? '—' : money.format(averageDeal)} hint="По всем сделкам" tone="amber" />
      <KpiCard icon={MessageSquareText} label="Конверсия" value={analyticsLoading ? '—' : `${conversion}%`} hint={`${wonDeals.length} успешных сделок`} tone="rose" onClick={onOpenDeals} />
    </section>

    <DealsTrendChart deals={deals} loading={analyticsLoading} />

    <section className="analytics-main-grid">
      <article className="analytics-card workload-card">
        <CardHeader title="Сделки по этапам" subtitle="Распределение активной воронки" action="Открыть канбан" onAction={onOpenDeals} />
        {displayedStages.length ? <div className="bar-chart" role="img" aria-label="Количество сделок по этапам">
          <div className="bar-grid"><span /><span /><span /><span /></div>
          <div className="bar-columns">{displayedStages.map(item => <div className="bar-column" key={item.id}>
            <strong>{analyticsLoading ? '—' : item.count}</strong>
            <div className="bar-track"><i style={{ height: analyticsLoading ? '12%' : `${Math.max((item.count / countMax) * 100, item.count ? 12 : 3)}%`, background: item.color }} /></div>
            <span title={item.name}>{item.name}</span>
          </div>)}</div>
        </div> : <DashboardEmpty icon={Workflow} title="Нет этапов" text="Создайте CRM-воронку для отображения диаграммы." />}
      </article>

      <article className="analytics-card response-card">
        <CardHeader title="Конверсия в продажу" subtitle="Доля успешных сделок" />
        <Donut value={conversion} />
        <div className="response-legend"><span><i className="done" />Успешные <b>{wonDeals.length}</b></span><span><i className="pending" />Все сделки <b>{deals.length}</b></span></div>
        <button className="analytics-secondary-action" onClick={onOpenDeals}>Посмотреть сделки</button>
      </article>
    </section>

    <section className="analytics-secondary-grid">
      <article className="analytics-card funnel-card">
        <CardHeader title="Воронка продаж" subtitle="Количество и сумма по каждому этапу" action="Открыть канбан" onAction={onOpenDeals} />
        {displayedStages.length ? <div className="analytics-funnel">{displayedStages.map((stage, index) => {
          const width = Math.max(100 - index * (58 / Math.max(displayedStages.length - 1, 1)), 42);
          return <div key={stage.id} className="funnel-row">
            <span>{stage.name}</span>
            <div><i style={{ width: `${width}%`, background: stage.color }} /></div>
            <b>{stage.count}</b>
            <small>{money.format(stage.amount)}</small>
          </div>;
        })}</div> : <DashboardEmpty icon={Workflow} title="Воронка не создана" text="Создайте этапы, чтобы увидеть распределение сделок." />}
      </article>

      <article className="analytics-card sources-card">
        <CardHeader title="Источники лидов" subtitle="Топ каналов по количеству сделок" action="Реклама" onAction={onOpenAds} />
        {sourceRows.length ? <div className="source-list">{sourceRows.map(source => <div className="source-row" key={source.name}>
          <div><strong>{source.name}</strong><span>{money.format(source.amount)}</span></div>
          <div className="source-progress"><i style={{ width: `${Math.max((source.count / sourceMax) * 100, 6)}%` }} /></div>
          <b>{source.count}</b>
        </div>)}</div> : <DashboardEmpty icon={BarChart3} title="Источники не заполнены" text="Укажите источник в карточках сделок." />}
      </article>
    </section>

    <section className="analytics-card deals-table-card">
      <CardHeader title="Последние сделки" subtitle="Оперативная таблица активной воронки" action="Все сделки" onAction={onOpenDeals} />
      {deals.length ? <div className="analytics-table-wrap"><table className="analytics-table">
        <thead><tr><th>Сделка</th><th>Источник</th><th>Этап</th><th>Сумма</th><th>Контакт</th></tr></thead>
        <tbody>{deals.slice(0, 8).map(deal => <DealRow key={deal.id} deal={deal} stageName={pipeline?.stages.find(stage => stage.id === deal.stageId)?.name ?? 'Неизвестно'} />)}</tbody>
      </table></div> : <DashboardEmpty icon={Workflow} title="Сделок пока нет" text="Добавьте первую сделку в CRM-воронку." />}
    </section>

    <section className="analytics-quick-actions">
      <button onClick={onOpenDeals}><Workflow size={18} /><span><strong>CRM и сделки</strong><small>Канбан и карточки лидов</small></span><ArrowUpRight size={16} /></button>
      <button onClick={onOpenInbox}><MessageSquareText size={18} /><span><strong>Коммуникации</strong><small>WhatsApp, Instagram и Email</small></span><ArrowUpRight size={16} /></button>
      <button onClick={onOpenAds}><BarChart3 size={18} /><span><strong>Реклама</strong><small>Кампании, CPL и ROMI</small></span><ArrowUpRight size={16} /></button>
      <button onClick={onOpenTasks}><Clock3 size={18} /><span><strong>Задачи</strong><small>Сроки и приоритеты команды</small></span><ArrowUpRight size={16} /></button>
    </section>
  </div>;
}

function KpiCard({ icon: Icon, label, value, hint, tone, onClick }: { icon: typeof Workflow; label: string; value: string; hint: string; tone: string; onClick?: () => void }) {
  const content = <><span className={`analytics-kpi-icon ${tone}`}><Icon size={18} /></span><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>{onClick && <ArrowUpRight className="analytics-kpi-arrow" size={16} />}</>;
  return onClick ? <button className="analytics-kpi" onClick={onClick}>{content}</button> : <article className="analytics-kpi">{content}</article>;
}

function CardHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <header className="analytics-card-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button onClick={onAction}>{action}<ArrowUpRight size={14} /></button>}</header>;
}

function Donut({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 42;
  const dash = circumference * (value / 100);
  return <div className="response-donut"><svg viewBox="0 0 110 110" aria-label={`Конверсия ${value}%`}><circle cx="55" cy="55" r="42" className="donut-base" /><circle cx="55" cy="55" r="42" className="donut-value" strokeDasharray={`${dash} ${circumference - dash}`} /></svg><div><strong>{value}%</strong><span>конверсия</span></div></div>;
}

function DealRow({ deal, stageName }: { deal: Deal; stageName: string }) {
  const contact = deal.contact?.phone || deal.contact?.email || 'Не указан';
  return <tr><td><strong>{deal.title}</strong></td><td><span className="table-source">{deal.source || 'Без источника'}</span></td><td>{stageName}</td><td className="table-money">{money.format(Number(deal.oneTimeAmount ?? 0))}</td><td>{contact}</td></tr>;
}

function DashboardEmpty({ icon: Icon, title, text }: { icon: typeof Workflow; title: string; text: string }) {
  return <div className="analytics-empty"><Icon size={24} /><strong>{title}</strong><span>{text}</span></div>;
}
