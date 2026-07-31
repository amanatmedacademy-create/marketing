import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AddressBook, BarChart3, Bell, Blocks, ChevronRight, CircleDollarSign, Cloud, LayoutDashboard, LoaderCircle, Moon, RefreshCw, Settings, Sun, Users } from 'lucide-react';
import { loadDeals, loadPipelines, type Deal, type Pipeline } from '../services/crm';

const CrmBoard = lazy(() => import('../pages/CrmBoard'));
const ContactsPage = lazy(() => import('../pages/ContactsPage'));

type RouteKey = 'home' | 'crm' | 'contacts' | 'operations' | 'integrations' | 'not-found';

function resolveRoute(pathname: string): RouteKey {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/crm') return 'crm';
  if (pathname === '/contacts') return 'contacts';
  if (pathname === '/operations') return 'operations';
  if (pathname === '/integrations') return 'integrations';
  return 'not-found';
}

export default function RebuiltApp() {
  const [dark, setDark] = useState(() => localStorage.getItem('imds_theme') === 'dark');
  const route = useMemo(() => resolveRoute(window.location.pathname), []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('imds_theme', dark ? 'dark' : 'light');
  }, [dark]);

  if (route === 'crm') return <Suspense fallback={<LoadingScreen label="Загрузка CRM" />}><CrmBoard /></Suspense>;
  if (route === 'contacts') return <Suspense fallback={<LoadingScreen label="Загрузка контактов" />}><ContactsPage /></Suspense>;

  return <div className="rebuild-shell">
    <aside className="rebuild-sidebar">
      <a className="rebuild-logo" href="/" aria-label="IMDS Marketing"><span>IM</span></a>
      <nav>
        <a className={route === 'home' ? 'active' : ''} href="/" title="Главная"><LayoutDashboard /></a>
        <a href="/crm" title="Сделки"><Users /></a>
        <a href="/contacts" title="Контакты"><AddressBook /></a>
        <a className={route === 'operations' ? 'active' : ''} href="/operations" title="Управление маркетингом"><BarChart3 /></a>
        <a className={route === 'integrations' ? 'active' : ''} href="/integrations" title="Интеграции"><Blocks /></a>
      </nav>
      <button className="rebuild-side-action" title="Настройки"><Settings /></button>
    </aside>

    <section className="rebuild-main">
      <header className="rebuild-topbar">
        <div className="rebuild-title"><strong>IMDS Marketing</strong><span>Маркетинг, CRM и аналитика</span></div>
        <div className="rebuild-top-actions">
          <button onClick={() => setDark((value) => !value)} aria-label="Переключить тему">{dark ? <Sun /> : <Moon />}</button>
          <button aria-label="Уведомления"><Bell /></button>
          <span className="rebuild-avatar">AM</span>
        </div>
      </header>

      {route === 'home' && <HomePage />}
      {route === 'operations' && <ModulePage icon={<BarChart3 />} title="Управление маркетингом" description="Открывается существующий модуль управления рекламой и аналитикой." />}
      {route === 'integrations' && <ModulePage icon={<Blocks />} title="Интеграции" description="Открывается существующий каталог Meta Ads, WABA, TikTok и других подключений." />}
      {route === 'not-found' && <ModulePage icon={<Cloud />} title="Страница не найдена" description="Маршрут отсутствует." />}
    </section>
  </div>;
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

  const modules = [
    { href: '/crm', icon: <Users />, title: 'Сделки', text: 'Воронки и сделки из Supabase.' },
    { href: '/contacts', icon: <AddressBook />, title: 'Контакты', text: 'Клиенты и лиды текущей компании.' },
    { href: '/operations', icon: <BarChart3 />, title: 'Маркетинг', text: 'Управление рекламой и аналитикой.' },
    { href: '/integrations', icon: <Blocks />, title: 'Интеграции', text: 'Meta, WhatsApp, TikTok, Google и сервисы.' },
  ];

  return <main className="rebuild-content">
    <section className="rebuild-hero">
      <div><span className="rebuild-kicker"><LayoutDashboard /> Рабочий обзор</span><h1>CRM и маркетинг в одном интерфейсе.</h1><p>Показатели ниже рассчитываются из текущих воронок и сделок компании. Демо-данные не используются.</p></div>
      <button className="rebuild-health" onClick={() => void refresh()} disabled={loading}><span>Обновить данные</span><strong>{loading ? 'ЗАГРУЗКА' : 'ОБНОВИТЬ'}</strong><small><RefreshCw /> CRM API</small></button>
    </section>

    {loading && <section className="rebuild-note"><LoaderCircle className="spin" /><div><strong>Загрузка данных</strong><p>Получаем воронки и сделки из CRM API.</p></div></section>}
    {!loading && error && <section className="rebuild-note"><Cloud /><div><strong>Данные недоступны</strong><p>{error}</p></div></section>}

    {!loading && !error && <>
      <section className="rebuild-kpis">
        <article><span><CircleDollarSign /> Сумма в работе</span><strong>{money.format(totalAmount)} ₸</strong><small>{deals.length} сделок</small></article>
        <article><span><Users /> Успешные сделки</span><strong>{wonDeals.length}</strong><small>{money.format(wonAmount)} ₸</small></article>
        <article><span><BarChart3 /> Конверсия</span><strong>{conversion}%</strong><small>Успешные / все сделки</small></article>
        <article><span><CircleDollarSign /> Средний чек</span><strong>{money.format(averageDeal)} ₸</strong><small>По успешным сделкам</small></article>
      </section>

      <section className="rebuild-module-grid">
        {pipelines.length ? pipelines.map((pipeline) => {
          const pipelineDeals = deals.filter((deal) => deal.pipeline_id === pipeline.id);
          const pipelineAmount = pipelineDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
          return <a key={pipeline.id} href="/crm"><span><BarChart3 /></span><div><h2>{pipeline.name}</h2><p>{pipelineDeals.length} сделок · {money.format(pipelineAmount)} ₸ · {pipeline.stages.length} стадий</p></div><ChevronRight /></a>;
        }) : <div className="rebuild-note"><Users /><div><strong>Воронок пока нет</strong><p>Создайте компанию и первую воронку в CRM.</p></div></div>}
      </section>
    </>}

    <section className="rebuild-module-grid">
      {modules.map((module) => <a key={module.href} href={module.href}><span>{module.icon}</span><div><h2>{module.title}</h2><p>{module.text}</p></div><ChevronRight /></a>)}
    </section>
  </main>;
}

function ModulePage({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <main className="rebuild-content"><section className="rebuild-module-page"><span>{icon}</span><h1>{title}</h1><p>{description}</p><div><a href="/">На главную</a><a className="primary" href="/crm">Открыть CRM</a></div></section></main>;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="rebuild-loading"><span className="rebuild-loader" /><p>{label}</p></main>;
}
