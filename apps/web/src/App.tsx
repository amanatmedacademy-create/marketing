import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Cable,
  CalendarDays,
  Cloud,
  Headphones,
  Instagram,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageCircle,
  Moon,
  Search,
  Settings,
  Sun,
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
  { label: 'Instagram', icon: Instagram },
  { label: 'Email', icon: Mail },
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
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());
  const [bannerVisible, setBannerVisible] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    ['Сумма в работе', moneyFormatter.format(dashboard?.metrics.amountInWork ?? 0), '▲ 12% за неделю', 'up'],
    ['Новые сделки', numberFormatter.format(dashboard?.metrics.newDeals ?? 0), 'За текущий период', 'neutral'],
    ['Открытые задачи', numberFormatter.format(dashboard?.metrics.openTasks ?? 0), 'Требуют внимания', 'down'],
    ['Неотвеченные беседы', numberFormatter.format(dashboard?.metrics.unansweredConversations ?? 0), 'WhatsApp / Instagram', 'down'],
  ], [dashboard]);

  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Almaty',
  }).format(now);
  const date = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Almaty',
  }).format(now);

  return (
    <div className="satu-shell">
      <aside className="sidebar">
        <div className="brand-dot" title="Satu CRM"><span /></div>
        <nav>
          {navigation.map(({ label, icon: Icon, active }) => (
            <button key={label} className={active ? 'active' : ''} title={label} aria-label={label}>
              <Icon size={18} />
            </button>
          ))}
        </nav>
        <button className="settings-button" title="Настройки" aria-label="Настройки"><Settings size={18} /></button>
      </aside>

      <main className="main-column">
        {bannerVisible && (
          <section className="subscription-banner">
            <span><strong>Тариф скоро истекает</strong> — осталось 2 дня</span>
            <div>
              <button>Обновить тариф</button>
              <button className="close-banner" onClick={() => setBannerVisible(false)}>×</button>
            </div>
          </section>
        )}

        <header className="topbar">
          <div className="clock-block">
            <strong>{time}</strong>
            <span>{date}</span>
          </div>

          <label className="search-box">
            <Search size={16} />
            <input placeholder="Поиск или вопрос J.A.R.V.I.S..." />
            <span className="ai-badge">AI</span>
          </label>

          <div className="top-actions">
            <span className="score-pill">₸ <strong>1 280</strong></span>
            <span className="phone-pill">☎ <strong>42 мин</strong></span>
            <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Сменить тему">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="icon-button" aria-label="Поддержка"><Headphones size={17} /></button>
            <button className="icon-button notification-button" aria-label="Уведомления"><Bell size={17} /><i /></button>
            <button className="avatar-button">АО</button>
          </div>
        </header>

        <section className="content">
          <div className="welcome-row">
            <div>
              <h1>Добро пожаловать, Айдос!</h1>
              <p>Компания: <code>demo-company</code> · роль: <code>OWNER</code></p>
            </div>
            <span className={`connection-status ${error ? 'error' : ''}`}>
              {loading ? 'Подключение…' : error ? 'Supabase не подключён' : 'Supabase подключён'}
            </span>
          </div>

          <div className="kpi-grid">
            {metrics.map(([label, value, delta, tone]) => (
              <article key={label} className="kpi-card">
                <span>{label}</span>
                <strong>{loading ? '—' : value}</strong>
                <small className={tone}>{error ? 'Нет соединения с базой' : delta}</small>
              </article>
            ))}
          </div>

          <div className="dashboard-grid">
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div><span>АНАЛИТИКА</span><h2>Динамика сделок</h2></div>
                <BarChart3 size={22} />
              </div>
              <div className="empty-state">
                <BarChart3 size={42} />
                <p>График появится после накопления истории сделок.</p>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div><span>ВОРОНКА</span><h2>Стадии продаж</h2></div>
                <Workflow size={22} />
              </div>
              <div className="stage-list">
                {dashboard?.stages.length ? dashboard.stages.map((stage) => (
                  <div key={stage.id}><span>{stage.position + 1}</span><strong>{stage.name}</strong></div>
                )) : <p>Воронка ещё не создана.</p>}
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
