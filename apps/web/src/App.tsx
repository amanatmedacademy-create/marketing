import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Cable,
  CalendarDays,
  Cloud,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageCircle,
  Search,
  Settings,
  UsersRound,
  Video,
  WalletCards,
  Workflow,
} from 'lucide-react';

const navigation = [
  { label: 'Дашборд', icon: LayoutDashboard, active: true },
  { label: 'Сделки', icon: Workflow },
  { label: 'Задачи', icon: CalendarDays },
  { label: 'Команда', icon: UsersRound },
  { label: 'Бухгалтерия', icon: WalletCards },
  { label: 'WhatsApp', icon: MessageCircle },
  { label: 'Реклама', icon: Megaphone },
  { label: 'Облако', icon: Cloud },
  { label: 'Видеовстречи', icon: Video },
  { label: 'Интеграции', icon: Cable },
];

type DashboardResponse = {
  metrics: {
    amountInWork: number;
    newDeals: number;
    openTasks: number;
    unansweredConversations: number;
  };
  stages: Array<{ id: string; name: string; position: number }>;
};

const numberFormatter = new Intl.NumberFormat('ru-KZ');
const moneyFormatter = new Intl.NumberFormat('ru-KZ', {
  style: 'currency',
  currency: 'KZT',
  maximumFractionDigits: 0,
});

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/dashboard', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          throw new Error(payload?.error?.message ?? `Ошибка API: ${response.status}`);
        }
        return response.json() as Promise<DashboardResponse>;
      })
      .then(setDashboard)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить данные');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  const metrics = useMemo(() => [
    ['Сумма в работе', moneyFormatter.format(dashboard?.metrics.amountInWork ?? 0)],
    ['Новые сделки', numberFormatter.format(dashboard?.metrics.newDeals ?? 0)],
    ['Открытые задачи', numberFormatter.format(dashboard?.metrics.openTasks ?? 0)],
    ['Неотвеченные беседы', numberFormatter.format(dashboard?.metrics.unansweredConversations ?? 0)],
  ], [dashboard]);

  return (
    <div className="crm-shell">
      <aside className="sidebar">
        <div className="brand">IM</div>
        <nav>
          {navigation.map(({ label, icon: Icon, active }) => (
            <button key={label} className={active ? 'active' : ''} title={label} aria-label={label}>
              <Icon size={20} />
            </button>
          ))}
        </nav>
        <button className="settings-button" title="Настройки" aria-label="Настройки"><Settings size={20} /></button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Меню"><Menu size={20} /></button>
          <label className="search-box">
            <Search size={18} />
            <input placeholder="Поиск или вопрос AI-ассистенту" />
          </label>
          <div className="topbar-actions">
            <span className="clock">Asia/Almaty</span>
            <button aria-label="Уведомления"><Bell size={19} /></button>
            <button className="avatar">AD</button>
          </div>
        </header>

        <section className="subscription-banner">
          <div>
            <strong>IMDS CRM</strong>
            <span>{error ? `Supabase не подключён: ${error}` : 'Cloudflare Worker и Supabase API подключены.'}</span>
          </div>
          <button>{loading ? 'Подключение…' : 'Настроить проект'}</button>
        </section>

        <div className="content">
          <div className="page-heading">
            <div><span>ОБЗОР</span><h1>Дашборд</h1><p>Рабочая область открывается без экрана входа.</p></div>
            <button className="period-button">Сегодня</button>
          </div>

          <div className="metrics-grid">
            {metrics.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{loading ? '—' : value}</strong>
                <small>{error ? 'Нет соединения с базой' : 'Данные Supabase'}</small>
              </article>
            ))}
          </div>

          <div className="dashboard-grid">
            <section className="panel chart-panel">
              <div className="panel-heading"><div><span>АНАЛИТИКА</span><h2>Динамика сделок</h2></div><BarChart3 size={22} /></div>
              <div className="empty-chart"><BarChart3 size={44} /><p>График появится после добавления истории изменений сделок.</p></div>
            </section>
            <section className="panel">
              <div className="panel-heading"><div><span>ВОРОНКА</span><h2>Стадии продаж</h2></div><Workflow size={22} /></div>
              <div className="empty-list">
                {dashboard?.stages.length ? (
                  dashboard.stages.map((stage) => <p key={stage.id}>{stage.position + 1}. {stage.name}</p>)
                ) : (
                  <><p>Воронка ещё не создана.</p><button>Создать первую воронку</button></>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
