import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  Filter,
  MessageSquareText,
  Target,
  Workflow,
} from 'lucide-react';
import { useDealsQuery, usePipelinesQuery } from '../deals/api/useDeals';
import type { Deal } from '../deals/types';
import { DealsTrendChart } from './DealsTrendChart';
import './analytics-v36.css';

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

const normalize = (value?: string | null) => value?.trim() || 'Без источника';

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
  const allDeals = dealsQuery.data?.items ?? [];
  const analyticsLoading = loading || pipelinesQuery.isLoading || dealsQuery.isLoading;

  const availableSources = useMemo(
    () => [...new Set(allDeals.map(deal => normalize(deal.source)))].sort(),
    [allDeals],
  );
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [dataFlowOpen, setDataFlowOpen] = useState(false);
  const [activeFlowStep, setActiveFlowStep] = useState<number | null>(null);

  const deals = useMemo(() => {
    if (!selectedSources.length) return allDeals;
    return allDeals.filter(deal => selectedSources.includes(normalize(deal.source)));
  }, [allDeals, selectedSources]);

  const stageRows = useMemo(() => (pipeline?.stages ?? []).map(stage => {
    const stageDeals = deals.filter(deal => deal.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      count: stageDeals.length,
      amount: stageDeals.reduce((sum, deal) => sum + Number(deal.oneTimeAmount ?? 0), 0),
      isWon: stage.isWon,
      isLost: stage.isLost,
    };
  }), [deals, pipeline]);

  const sourceRows = useMemo(() => {
    const grouped = new Map<string, { count: number; amount: number; won: number }>();
    const wonIds = new Set((pipeline?.stages ?? []).filter(stage => stage.isWon).map(stage => stage.id));
    for (const deal of deals) {
      const source = normalize(deal.source);
      const current = grouped.get(source) ?? { count: 0, amount: 0, won: 0 };
      grouped.set(source, {
        count: current.count + 1,
        amount: current.amount + Number(deal.oneTimeAmount ?? 0),
        won: current.won + (wonIds.has(deal.stageId) ? 1 : 0),
      });
    }
    return [...grouped.entries()]
      .map(([name, values]) => ({ name, ...values, conversion: values.count ? Math.round(values.won / values.count * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [deals, pipeline]);

  const totalAmount = deals.reduce((sum, deal) => sum + Number(deal.oneTimeAmount ?? 0), 0);
  const averageDeal = deals.length ? totalAmount / deals.length : 0;
  const wonStageIds = new Set((pipeline?.stages ?? []).filter(stage => stage.isWon).map(stage => stage.id));
  const lostStageIds = new Set((pipeline?.stages ?? []).filter(stage => stage.isLost).map(stage => stage.id));
  const wonDeals = deals.filter(deal => wonStageIds.has(deal.stageId));
  const lostDeals = deals.filter(deal => lostStageIds.has(deal.stageId));
  const qualifiedDeals = deals.filter(deal => !lostStageIds.has(deal.stageId));
  const conversion = deals.length ? Math.round((wonDeals.length / deals.length) * 100) : 0;
  const unattributed = deals.filter(deal => normalize(deal.source) === 'Без источника').length;
  const unattributedRate = deals.length ? Math.round(unattributed / deals.length * 100) : 0;
  const sourceMax = Math.max(...sourceRows.map(item => item.count), 1);
  const displayedStages = stageRows.length
    ? stageRows
    : stages.map(stage => ({ id: stage.id, name: stage.name, color: '#4f6ef7', count: 0, amount: 0, isWon: false, isLost: false }));

  const toggleSource = (source: string) => {
    setSelectedSources(current => current.includes(source)
      ? current.filter(item => item !== source)
      : [...current, source]);
  };

  return <div className="analytics-dashboard analytics-v36">
    <header className="analytics-hero">
      <div>
        <span className="analytics-eyebrow">Сквозная аналитика</span>
        <h1>Реклама → лид → продажа → выручка</h1>
        <p>{userName}, здесь отображается полный путь сделки и качество атрибуции.</p>
      </div>
      <div className="analytics-hero-actions">
        <span className={`connection-status ${error ? 'error' : ''}`}>{analyticsLoading ? 'Подключение…' : error ? 'Ошибка подключения' : 'CRM подключена'}</span>
        <button onClick={onOpenAds}>Рекламные кабинеты <ArrowUpRight size={15} /></button>
      </div>
    </header>

    <section className="analytics-filterbar">
      <button className={compareEnabled ? 'active' : ''} onClick={() => setCompareEnabled(value => !value)}>
        <BarChart3 size={14} /> Сравнить с прошлым периодом
      </button>
      <details className="analytics-filter-menu">
        <summary><Filter size={14} /> Источники {selectedSources.length ? `(${selectedSources.length})` : ''}</summary>
        <div>{availableSources.length ? availableSources.map(source => <label key={source}>
          <input type="checkbox" checked={selectedSources.includes(source)} onChange={() => toggleSource(source)} />
          <span>{source}</span>
        </label>) : <small>Источники ещё не заполнены</small>}</div>
      </details>
      {selectedSources.length > 0 && <button onClick={() => setSelectedSources([])}>Сбросить фильтр</button>}
      <span className="analytics-filter-result">Показано сделок: <b>{deals.length}</b></span>
    </section>

    <section className="analytics-kpis analytics-kpis-v36">
      <KpiCard icon={Workflow} label="CRM-лиды" value={analyticsLoading ? '—' : String(deals.length)} hint={`${qualifiedDeals.length} целевых`} tone="blue" onClick={onOpenDeals} />
      <KpiCard icon={Target} label="Продажи" value={analyticsLoading ? '—' : String(wonDeals.length)} hint={`${conversion}% от всех лидов`} tone="violet" onClick={onOpenDeals} />
      <KpiCard icon={CircleDollarSign} label="Выручка" value={analyticsLoading ? '—' : money.format(totalAmount)} hint={`Средний чек ${money.format(averageDeal)}`} tone="amber" />
      <KpiCard icon={MessageSquareText} label="Неатрибутированные" value={analyticsLoading ? '—' : `${unattributedRate}%`} hint={unattributedRate > 5 ? 'Превышен порог 5%' : 'Норма — менее 5%'} tone={unattributedRate > 5 ? 'rose' : 'blue'} />
    </section>

    <section className="analytics-main-grid analytics-main-grid-v36">
      <article className="analytics-card funnel-card">
        <CardHeader title="Сквозная воронка" subtitle="Лиды → целевые → продажи → выручка" action="Открыть CRM" onAction={onOpenDeals} />
        <div className="end-to-end-funnel">
          <FunnelStep label="CRM-лиды" value={deals.length} base={deals.length} />
          <FunnelStep label="Целевые" value={qualifiedDeals.length} base={deals.length} />
          <FunnelStep label="Продажи" value={wonDeals.length} base={deals.length} />
          <FunnelStep label="Отказы" value={lostDeals.length} base={deals.length} danger />
          <FunnelStep label="Выручка" value={money.format(totalAmount)} base={1} moneyStep />
        </div>
      </article>

      <article className="analytics-card sources-card">
        <CardHeader title="Источники и конверсия" subtitle="Лиды, продажи и выручка по каналам" action="Реклама" onAction={onOpenAds} />
        {sourceRows.length ? <div className="source-list">{sourceRows.slice(0, 8).map(source => <div className="source-row source-row-v36" key={source.name}>
          <div><strong>{source.name}</strong><span>{money.format(source.amount)} · {source.conversion}% WON</span></div>
          <div className="source-progress"><i style={{ width: `${Math.max((source.count / sourceMax) * 100, 6)}%` }} /></div>
          <b>{source.count}</b>
        </div>)}</div> : <DashboardEmpty icon={BarChart3} title="Источники не заполнены" text="Укажите источник в карточках сделок." />}
      </article>
    </section>

    <DealsTrendChart deals={deals} loading={analyticsLoading} />

    <section className="analytics-card platform-funnel-card">
      <CardHeader title="Воронка по этапам CRM" subtitle="Количество и сумма по каждому этапу" action="Открыть канбан" onAction={onOpenDeals} />
      {displayedStages.length ? <div className="analytics-funnel">{displayedStages.map((stage, index) => {
        const width = Math.max(100 - index * (58 / Math.max(displayedStages.length - 1, 1)), 42);
        return <div key={stage.id} className="funnel-row">
          <span>{stage.name}</span>
          <div><i style={{ width: `${width}%`, background: stage.color }} /></div>
          <b>{stage.count}</b>
          <small>{money.format(stage.amount)}</small>
        </div>;
      })}</div> : <DashboardEmpty icon={Workflow} title="Воронка не создана" text="Создайте этапы, чтобы увидеть распределение сделок." />}
    </section>

    <section className="analytics-card data-flow-card">
      <button className="data-flow-toggle" onClick={() => setDataFlowOpen(value => !value)}>
        <span><b>Схема движения данных (Data Flow)</b><small>Сквозная аналитика · Feedback Loop → Conversions API</small></span>
        {dataFlowOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {dataFlowOpen && <div className="data-flow-body">
        <div className="data-flow-steps">{FLOW_STEPS.map(step => <button key={step.num} className={activeFlowStep === step.num ? 'active' : ''} onClick={() => setActiveFlowStep(activeFlowStep === step.num ? null : step.num)}>
          <span>{step.icon}</span><b>{step.title}</b>
        </button>)}</div>
        {activeFlowStep && <div className="data-flow-detail">
          <b>{FLOW_STEPS[activeFlowStep - 1].title}</b>
          <p>{FLOW_STEPS[activeFlowStep - 1].description}</p>
          <div>{FLOW_STEPS[activeFlowStep - 1].tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        </div>}
      </div>}
    </section>

    <section className="analytics-card deals-table-card">
      <CardHeader title="Последние сделки" subtitle="Контроль атрибуции и статуса" action="Все сделки" onAction={onOpenDeals} />
      {deals.length ? <div className="analytics-table-wrap"><table className="analytics-table">
        <thead><tr><th>Сделка</th><th>Источник</th><th>Этап</th><th>Сумма</th><th>Контакт</th></tr></thead>
        <tbody>{deals.slice(0, 10).map(deal => <DealRow key={deal.id} deal={deal} stageName={pipeline?.stages.find(stage => stage.id === deal.stageId)?.name ?? 'Неизвестно'} />)}</tbody>
      </table></div> : <DashboardEmpty icon={Workflow} title="Сделок пока нет" text="Добавьте первую сделку в CRM-воронку." />}
    </section>

    <section className="analytics-quick-actions">
      <button onClick={onOpenDeals}><Workflow size={18} /><span><strong>CRM и сделки</strong><small>Канбан и карточки лидов</small></span><ArrowUpRight size={16} /></button>
      <button onClick={onOpenInbox}><MessageSquareText size={18} /><span><strong>Коммуникации</strong><small>WhatsApp, Instagram и Email</small></span><ArrowUpRight size={16} /></button>
      <button onClick={onOpenAds}><BarChart3 size={18} /><span><strong>Реклама</strong><small>Расходы, CPL, CAC и ROAS</small></span><ArrowUpRight size={16} /></button>
      <button onClick={onOpenTasks}><Clock3 size={18} /><span><strong>Задачи</strong><small>Сроки и приоритеты команды</small></span><ArrowUpRight size={16} /></button>
    </section>
  </div>;
}

const FLOW_STEPS = [
  { num: 1, icon: '📣', title: 'Рекламные кабинеты', description: 'Meta, Google и TikTok передают расходы, кампании, объявления, click ID и UTM.', tags: ['spend', 'campaign_id', 'ad_id', 'fbclid / gclid / ttclid'] },
  { num: 2, icon: '🔗', title: 'Трекинг источника', description: 'Система связывает переход с внутренним идентификатором клиента и сохраняет первичный и последний источник.', tags: ['internal_client_id', 'UTM', 'first touch', 'last non-direct'] },
  { num: 3, icon: '💬', title: 'Лид и коммуникация', description: 'Обращение создаёт контакт, лид и диалог. Источник остаётся прикреплён к сделке.', tags: ['contact_id', 'lead_id', 'conversation_id'] },
  { num: 4, icon: '✅', title: 'Продажа в CRM', description: 'При переходе сделки в успешный этап фиксируются статус WON, сумма и выручка.', tags: ['deal.stage = WON', 'revenue KZT', 'CRM event'] },
  { num: 5, icon: '🔒', title: 'Валидация данных', description: 'Перед передачей конверсии выполняются проверка идентификаторов, хеширование PII и дедупликация.', tags: ['SHA-256 phone/email', 'event_id', 'anti-duplicate'] },
  { num: 6, icon: '📤', title: 'Conversions API', description: 'Подтверждённая продажа возвращается в рекламные системы для обучения алгоритмов на реальной выручке.', tags: ['Meta CAPI', 'Google Ads API', 'TikTok Events API'] },
];

function FunnelStep({ label, value, base, danger, moneyStep }: { label: string; value: string | number; base: number; danger?: boolean; moneyStep?: boolean }) {
  const numeric = typeof value === 'number' ? value : 1;
  const percent = moneyStep ? 100 : base ? Math.round(numeric / base * 100) : 0;
  return <div className={`end-to-end-step ${danger ? 'danger' : ''}`}>
    <div><span>{label}</span><b>{value}</b></div>
    <i><em style={{ width: `${Math.max(percent, numeric ? 6 : 0)}%` }} /></i>
    {!moneyStep && <small>{percent}% от лидов</small>}
  </div>;
}

function KpiCard({ icon: Icon, label, value, hint, tone, onClick }: { icon: typeof Workflow; label: string; value: string; hint: string; tone: string; onClick?: () => void }) {
  const content = <><span className={`analytics-kpi-icon ${tone}`}><Icon size={18} /></span><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>{onClick && <ArrowUpRight className="analytics-kpi-arrow" size={16} />}</>;
  return onClick ? <button className="analytics-kpi" onClick={onClick}>{content}</button> : <article className="analytics-kpi">{content}</article>;
}

function CardHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <header className="analytics-card-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button onClick={onAction}>{action}<ArrowUpRight size={14} /></button>}</header>;
}

function DealRow({ deal, stageName }: { deal: Deal; stageName: string }) {
  const contact = deal.contact?.phone || deal.contact?.email || 'Не указан';
  return <tr><td><strong>{deal.title}</strong></td><td><span className="table-source">{deal.source || 'Без источника'}</span></td><td>{stageName}</td><td className="table-money">{money.format(Number(deal.oneTimeAmount ?? 0))}</td><td>{contact}</td></tr>;
}

function DashboardEmpty({ icon: Icon, title, text }: { icon: typeof Workflow; title: string; text: string }) {
  return <div className="analytics-empty"><Icon size={24} /><strong>{title}</strong><span>{text}</span></div>;
}
