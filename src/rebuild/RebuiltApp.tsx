import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AddressBook,
  BarChart3,
  Bell,
  Blocks,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  FolderKanban,
  Headphones,
  Instagram,
  LayoutDashboard,
  LoaderCircle,
  Mail,
  Megaphone,
  MessageCircle,
  Moon,
  Phone,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Users,
  Video,
  WalletCards,
} from 'lucide-react';
import { loadDeals, loadPipelines, type Deal, type Pipeline } from '../services/crm';

const CrmBoard = lazy(() => import('../pages/CrmBoard'));
const ContactsPage = lazy(() => import('../pages/ContactsPage'));

type RouteKey =
  | 'home'
  | 'crm'
  | 'contacts'
  | 'tasks'
  | 'projects'
  | 'team'
  | 'accounting'
  | 'operations'
  | 'integrations'
  | 'preview'
  | 'not-found';

function resolveRoute(pathname: string): RouteKey {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/crm') return 'crm';
  if (pathname === '/contacts') return 'contacts';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/projects') return 'projects';
  if (pathname === '/team') return 'team';
  if (pathname === '/accounting') return 'accounting';
  if (pathname === '/operations') return 'operations';
  if (pathname === '/integrations') return 'integrations';
  if (pathname === '/design-preview') return 'preview';
  return 'not-found';
}

const primaryNavigation = [
  { route: 'home', href: '/', label: 'Дашборд', icon: LayoutDashboard },
  { route: 'crm', href: '/crm', label: 'Сделки', icon: Users },
  { route: 'contacts', href: '/contacts', label: 'Контакты', icon: AddressBook },
  { route: 'tasks', href: '/tasks', label: 'Задачи', icon: CalendarDays },
  { route: 'projects', href: '/projects', label: 'Проекты', icon: FolderKanban },
  { route: 'team', href: '/team', label: 'Команда', icon: Users },
  { route: 'accounting', href: '/accounting', label: 'Бухгалтерия', icon: WalletCards },
] as const;

export default function RebuiltApp() {
  const [dark, setDark] = useState(() => localStorage.getItem('imds_theme') === 'dark');
  const [bannerVisible, setBannerVisible] = useState(true);
  const [teamOpen, setTeamOpen] = useState(false);
  const route = useMemo(() => resolveRoute(window.location.pathname), []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('imds_theme', dark ? 'dark' : 'light');
  }, [dark]);

  if (route === 'crm') return <Suspense fallback={<LoadingScreen label="Загрузка CRM" />}><CrmBoard /></Suspense>;
  if (route === 'contacts') return <Suspense fallback={<LoadingScreen label="Загрузка контактов" />}><ContactsPage /></Suspense>;

  return <div className="satu-shell">
    <aside className="satu-sidebar">
      <a className="satu-brand" href="/" aria-label="IMDS CRM"><span />IM</a>
      <nav className="satu-nav-group">
        {primaryNavigation.map(({ route: itemRoute, href, label, icon: Icon }) => (
          <a key={href} className={route === itemRoute ? 'active' : ''} href={href} data-tip={label} aria-label={label}><Icon /></a>
        ))}
      </nav>
      <nav className="satu-nav-group secondary">
        <a href="/integrations" data-tip="WhatsApp"><MessageCircle /></a>
        <a href="/integrations" data-tip="Instagram"><Instagram /></a>
        <a href="/integrations" data-tip="Email"><Mail /></a>
      </nav>
      <nav className="satu-nav-group secondary">
        <a className={route === 'operations' ? 'active' : ''} href="/operations" data-tip="Реклама"><Megaphone /></a>
        <a href="/design-preview" data-tip="Облако"><Cloud /></a>
        <a href="/design-preview" data-tip="Видеовстречи"><Video /></a>
      </nav>
      <a className="satu-settings" href="/integrations" data-tip="Настройки"><Settings /></a>
    </aside>

    <section className="satu-main">
      {bannerVisible && <div className="satu-subscription-banner"><span><strong>Тариф активен.</strong> Проверьте параметры подписки и лимиты интеграций.</span><a href="/integrations">Управление</a><button onClick={() => setBannerVisible(false)} aria-label="Закрыть">×</button></div>}
      <header className="satu-topbar">
        <Clock />
        <label className="satu-search"><Search /><input placeholder="Поиск или вопрос AI-ассистенту" /><span>AI</span></label>
        <div className="satu-top-actions">
          <span className="satu-pill gold"><CircleDollarSign />1 280</span>
          <span className="satu-pill"><Phone />42 мин</span>
          <button onClick={() => setDark((value) => !value)} aria-label="Переключить тему">{dark ? <Sun /> : <Moon />}</button>
          <button onClick={() => setTeamOpen(true)} aria-label="Техподдержка"><Headphones /></button>
          <button aria-label="Уведомления" className="has-badge"><Bell /></button>
          <span className="satu-avatar">AM</span>
        </div>
      </header>

      {route === 'home' && <HomePage />}
      {route === 'tasks' && <ComingSoon icon={<CalendarDays />} title="Задачи и календарь" description="Интерфейс подготовлен. Подключение реального API задач будет выполнено следующим модулем." />}
      {route === 'projects' && <ComingSoon icon={<FolderKanban />} title="Проекты" description="Доски проектов будут подключены к текущей компании без создания отдельного backend." />}
      {route === 'team' && <ComingSoon icon={<Users />} title="Команда" description="Сотрудники, роли и активность будут работать через существующую модель участников компании." />}
      {route === 'accounting' && <ComingSoon icon={<WalletCards />} title="Бухгалтерия" description="Модуль будет добавлен поверх текущей CRM без изменения существующих финансовых данных." />}
      {route === 'operations' && <ModulePage icon={<BarChart3 />} title="Управление маркетингом" description="Существующий модуль рекламы и аналитики сохранён. Меняется только визуальная оболочка." />}
      {route === 'integrations' && <ModulePage icon={<Blocks />} title="Интеграции" description="Meta Ads, WABA, Bitrix24 и остальные текущие подключения остаются действующими." />}
      {route === 'preview' && <DesignPreview />}
      {route === 'not-found' && <ModulePage icon={<Cloud />} title="Страница не найдена" description="Маршрут отсутствует." />}
    </section>

    {teamOpen && <aside className="satu-team-drawer"><header><div><strong>Команда</strong><span>Внутренний чат</span></div><button onClick={() => setTeamOpen(false)}>×</button></header><div className="satu-team-list"><article><span className="online">ГА</span><div><strong>Гульнара</strong><small>Онлайн</small></div></article><article><span>ЕМ</span><div><strong>Ерлан</strong><small>Был недавно</small></div></article></div><div className="satu-team-empty">Realtime-чат будет подключён к текущему API уведомлений.</div></aside>}
  </div>;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Almaty' }).format(now);
  const date = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' }).format(now);
  return <div className="satu-clock"><strong>{time}</strong><span>{date}</span></div>;
}

function HomePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const nextPipelines = await loadPipelines();
      const nextDeals = await Promise.all(nextPipelines.map((pipeline) => loadDeals(pipeline.id)));
      setPipelines(nextPipelines);
      setDeals(nextDeals.flat());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPipelines([]);
      setDeals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const totalAmount = deals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
  const wonDeals = deals.filter((deal) => deal.status === 'won');
  const wonAmount = wonDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
  const conversion = deals.length ? Math.round((wonDeals.length / deals.length) * 100) : 0;
  const averageDeal = wonDeals.length ? wonAmount / wonDeals.length : 0;
  const money = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 });

  return <main className="satu-content">
    <section className="satu-page-head"><div><span>Рабочий обзор</span><h1>Добро пожаловать в IMDS CRM</h1><p>Показатели рассчитываются из текущих воронок и сделок компании.</p></div><button onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} />Обновить</button></section>

    {loading && <section className="satu-note"><LoaderCircle className="spin" /><div><strong>Загрузка данных</strong><p>Получаем воронки и сделки из текущего CRM API.</p></div></section>}
    {!loading && error && <section className="satu-note error"><Cloud /><div><strong>Данные недоступны</strong><p>{error}</p></div></section>}

    {!loading && !error && <>
      <section className="satu-kpis">
        <Kpi label="Сумма в работе" value={`${money.format(totalAmount)} ₸`} meta={`${deals.length} сделок`} />
        <Kpi label="Успешные сделки" value={String(wonDeals.length)} meta={`${money.format(wonAmount)} ₸`} />
        <Kpi label="Конверсия в оплату" value={`${conversion}%`} meta="Успешные / все сделки" />
        <Kpi label="Средний чек" value={`${money.format(averageDeal)} ₸`} meta="По успешным сделкам" />
      </section>

      <section className="satu-section-card"><header><div><span>Воронки продаж</span><strong>Реальные данные CRM</strong></div><a href="/crm">Открыть канбан <ChevronRight /></a></header><div className="satu-funnel-list">{pipelines.length ? pipelines.map((pipeline) => {
        const pipelineDeals = deals.filter((deal) => deal.pipeline_id === pipeline.id);
        const pipelineAmount = pipelineDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
        return <a key={pipeline.id} href="/crm"><span className="satu-stage-dot" /><div><strong>{pipeline.name}</strong><small>{pipelineDeals.length} сделок · {money.format(pipelineAmount)} ₸</small></div><em>{pipeline.stages.length} стадий</em></a>;
      }) : <div className="satu-empty">Воронок пока нет. Создайте первую воронку в CRM.</div>}</div></section>
    </>}

    <section className="satu-modules">
      <ModuleCard href="/crm" icon={<Users />} title="Сделки" text="Воронки и сделки из Supabase." />
      <ModuleCard href="/contacts" icon={<AddressBook />} title="Контакты" text="Клиенты и лиды текущей компании." />
      <ModuleCard href="/operations" icon={<BarChart3 />} title="Маркетинг" text="Управление рекламой и аналитикой." />
      <ModuleCard href="/integrations" icon={<Blocks />} title="Интеграции" text="Meta, WhatsApp, TikTok и сервисы." />
      <ModuleCard href="/design-preview" icon={<LayoutDashboard />} title="Дизайн-прототип" text="Отдельный маршрут для сравнения нового интерфейса." />
    </section>
  </main>;
}

function Kpi({ label, value, meta }: { label: string; value: string; meta: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>;
}

function ModuleCard({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return <a href={href}><span>{icon}</span><div><strong>{title}</strong><small>{text}</small></div><ChevronRight /></a>;
}

function DesignPreview() {
  return <main className="satu-content"><section className="satu-preview"><div><span>Визуальный эталон</span><h1>Satu CRM</h1><p>Отдельный маршрут для сравнения дизайна. Production-данные здесь не изменяются.</p></div><div className="satu-preview-grid"><Kpi label="Сумма в работе" value="4 280 000 ₸" meta="Демонстрационный показатель" /><Kpi label="Сделок" value="9" meta="Демонстрационный показатель" /><Kpi label="Конверсия" value="34%" meta="Демонстрационный показатель" /></div><a href="/">Вернуться к реальному dashboard</a></section></main>;
}

function ComingSoon({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <ModulePage icon={icon} title={title} description={description} badge="Следующий этап" />;
}

function ModulePage({ icon, title, description, badge }: { icon: ReactNode; title: string; description: string; badge?: string }) {
  return <main className="satu-content"><section className="satu-module-page"><span>{icon}</span>{badge && <small>{badge}</small>}<h1>{title}</h1><p>{description}</p><div><a href="/">На главную</a><a className="primary" href="/crm">Открыть CRM</a></div></section></main>;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="rebuild-loading"><span className="rebuild-loader" /><p>{label}</p></main>;
}
