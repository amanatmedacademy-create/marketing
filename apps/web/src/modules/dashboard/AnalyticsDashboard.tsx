import { ArrowUpRight, BarChart3, CircleDollarSign, Clock3, MessageSquareText, Target, Workflow } from 'lucide-react';

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
  const countMax = Math.max(metrics.newDeals, metrics.openTasks, metrics.unansweredConversations, 1);
  const workload = [
    { label: 'Сделки', value: metrics.newDeals },
    { label: 'Задачи', value: metrics.openTasks },
    { label: 'Без ответа', value: metrics.unansweredConversations },
  ];
  const answered = Math.max(metrics.newDeals - metrics.unansweredConversations, 0);
  const responseTotal = answered + metrics.unansweredConversations;
  const responseRate = responseTotal ? Math.round((answered / responseTotal) * 100) : 0;
  const circumference = 2 * Math.PI * 42;
  const dash = circumference * (responseRate / 100);

  return <div className="analytics-dashboard">
    <header className="analytics-hero">
      <div>
        <span className="analytics-eyebrow">Обзор бизнеса</span>
        <h1>Добро пожаловать, {userName}</h1>
        <p>Продажи, задачи, коммуникации и состояние CRM в одном экране.</p>
      </div>
      <div className="analytics-hero-actions">
        <span className={`connection-status ${error ? 'error' : ''}`}>{loading ? 'Подключение…' : error ? 'Ошибка подключения' : 'Данные актуальны'}</span>
        <button onClick={onOpenDeals}>Открыть CRM <ArrowUpRight size={15} /></button>
      </div>
    </header>

    <section className="analytics-kpis">
      <KpiCard icon={CircleDollarSign} label="Сумма в работе" value={loading ? '—' : money.format(metrics.amountInWork)} hint="Активный портфель" tone="violet" />
      <KpiCard icon={Workflow} label="Сделки в работе" value={loading ? '—' : String(metrics.newDeals)} hint="Текущая воронка" tone="blue" onClick={onOpenDeals} />
      <KpiCard icon={Target} label="Открытые задачи" value={loading ? '—' : String(metrics.openTasks)} hint="Требуют выполнения" tone="amber" onClick={onOpenTasks} />
      <KpiCard icon={MessageSquareText} label="Без ответа" value={loading ? '—' : String(metrics.unansweredConversations)} hint="Нужна реакция" tone="rose" onClick={onOpenInbox} />
    </section>

    <section className="analytics-main-grid">
      <article className="analytics-card workload-card">
        <CardHeader title="Операционная нагрузка" subtitle="Сравнение текущих объектов CRM" action="Открыть задачи" onAction={onOpenTasks} />
        <div className="bar-chart" role="img" aria-label="Сделки, задачи и диалоги без ответа">
          <div className="bar-grid"><span /><span /><span /><span /></div>
          <div className="bar-columns">{workload.map(item => <div className="bar-column" key={item.label}>
            <strong>{loading ? '—' : item.value}</strong>
            <div className="bar-track"><i style={{ height: loading ? '12%' : `${Math.max((item.value / countMax) * 100, item.value ? 12 : 3)}%` }} /></div>
            <span>{item.label}</span>
          </div>)}</div>
        </div>
      </article>

      <article className="analytics-card response-card">
        <CardHeader title="Скорость реакции" subtitle="Доля обработанных диалогов" />
        <div className="response-donut">
          <svg viewBox="0 0 110 110" aria-label={`Обработано ${responseRate}%`}>
            <circle cx="55" cy="55" r="42" className="donut-base" />
            <circle cx="55" cy="55" r="42" className="donut-value" strokeDasharray={`${dash} ${circumference - dash}`} />
          </svg>
          <div><strong>{loading ? '—' : `${responseRate}%`}</strong><span>обработано</span></div>
        </div>
        <div className="response-legend"><span><i className="done" />Обработано <b>{answered}</b></span><span><i className="pending" />Без ответа <b>{metrics.unansweredConversations}</b></span></div>
        <button className="analytics-secondary-action" onClick={onOpenInbox}>Перейти в сообщения</button>
      </article>
    </section>

    <section className="analytics-secondary-grid">
      <article className="analytics-card funnel-card">
        <CardHeader title="Воронка продаж" subtitle="Этапы активной CRM-воронки" action="Открыть канбан" onAction={onOpenDeals} />
        {stages.length ? <div className="analytics-funnel">{[...stages].sort((a, b) => a.position - b.position).map((stage, index) => {
          const width = Math.max(100 - index * (58 / Math.max(stages.length - 1, 1)), 42);
          return <div key={stage.id} className="funnel-row">
            <span>{stage.name}</span>
            <div><i style={{ width: `${width}%` }} /></div>
            <b>—</b>
          </div>;
        })}</div> : <DashboardEmpty icon={Workflow} title="Воронка не создана" text="Создайте этапы, чтобы увидеть распределение сделок." />}
        <p className="data-note">Количество по этапам появится после расширения endpoint `/dashboard`.</p>
      </article>

      <article className="analytics-card control-card">
        <CardHeader title="Контроль показателей" subtitle="Что требует внимания сейчас" />
        <div className="control-table">
          <div className="control-head"><span>Показатель</span><span>Значение</span><span>Статус</span></div>
          <ControlRow label="Сделки в работе" value={metrics.newDeals} status={metrics.newDeals ? 'Активно' : 'Нет данных'} tone={metrics.newDeals ? 'good' : 'neutral'} />
          <ControlRow label="Открытые задачи" value={metrics.openTasks} status={metrics.openTasks ? 'Проверить' : 'В норме'} tone={metrics.openTasks ? 'warning' : 'good'} />
          <ControlRow label="Диалоги без ответа" value={metrics.unansweredConversations} status={metrics.unansweredConversations ? 'Требует реакции' : 'В норме'} tone={metrics.unansweredConversations ? 'danger' : 'good'} />
          <ControlRow label="Этапы воронки" value={stages.length} status={stages.length ? 'Настроено' : 'Не настроено'} tone={stages.length ? 'good' : 'neutral'} />
        </div>
      </article>
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

function ControlRow({ label, value, status, tone }: { label: string; value: number; status: string; tone: string }) {
  return <div className="control-row"><strong>{label}</strong><b>{value}</b><span className={tone}>{status}</span></div>;
}

function DashboardEmpty({ icon: Icon, title, text }: { icon: typeof Workflow; title: string; text: string }) {
  return <div className="analytics-empty"><Icon size={24} /><strong>{title}</strong><span>{text}</span></div>;
}
