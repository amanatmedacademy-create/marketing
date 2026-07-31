import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BarChart3, Bell, Blocks, ChevronRight, CircleDollarSign, Cloud, Database, LayoutDashboard, Megaphone, MessageCircle, Moon, Settings, ShieldCheck, Sun, Users } from 'lucide-react';

const CrmBoard = lazy(() => import('../pages/CrmBoard'));

type RouteKey = 'home' | 'crm' | 'operations' | 'integrations' | 'not-found';

function resolveRoute(pathname: string): RouteKey {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/crm') return 'crm';
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

  if (route === 'crm') {
    return <Suspense fallback={<LoadingScreen label="Загрузка CRM" />}><CrmBoard /></Suspense>;
  }

  return <div className="rebuild-shell">
    <aside className="rebuild-sidebar">
      <a className="rebuild-logo" href="/" aria-label="IMDS Marketing"><span>IM</span></a>
      <nav>
        <a className={route === 'home' ? 'active' : ''} href="/" title="Главная"><LayoutDashboard /></a>
        <a className={route === 'crm' ? 'active' : ''} href="/crm" title="CRM"><Users /></a>
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
      {route === 'operations' && <ModulePage icon={<BarChart3 />} title="Управление маркетингом" description="Модуль сохранён в backup и будет подключён к новому shell после отдельной проверки сборки." />}
      {route === 'integrations' && <ModulePage icon={<Blocks />} title="Интеграции" description="Meta Ads, WhatsApp, TikTok, Google и другие интеграции сохранены. Подключение выполняется поэтапно без риска для главной страницы." />}
      {route === 'not-found' && <ModulePage icon={<Cloud />} title="Страница не найдена" description="Маршрут отсутствует в новой стабильной точке входа." />}
    </section>
  </div>;
}

function HomePage() {
  const modules = [
    { href: '/crm', icon: <Users />, title: 'CRM', text: 'Воронки, контакты и сделки из Supabase.' },
    { href: '/operations', icon: <BarChart3 />, title: 'Маркетинг', text: 'Управление рекламой и аналитикой.' },
    { href: '/integrations', icon: <Blocks />, title: 'Интеграции', text: 'Meta, WhatsApp, TikTok, Google и сервисы.' },
  ];

  return <main className="rebuild-content">
    <section className="rebuild-hero">
      <div><span className="rebuild-kicker"><ShieldCheck /> Новый стабильный frontend</span><h1>Система пересобрана без старой точки отказа.</h1><p>Backend, Cloudflare Worker, Supabase и интеграционные модули сохранены из backup. Новый интерфейс загружается независимо и показывает ошибку вместо чёрного экрана.</p></div>
      <div className="rebuild-health"><span>Frontend</span><strong>ONLINE</strong><small>Safe entry + Error Boundary</small></div>
    </section>

    <section className="rebuild-kpis">
      <article><span><CircleDollarSign /> CRM API</span><strong>Подключён</strong><small>Worker + Supabase</small></article>
      <article><span><Database /> База данных</span><strong>Сохранена</strong><small>CRM-таблицы и RLS</small></article>
      <article><span><Cloud /> Cloudflare</span><strong>Готов</strong><small>Worker не изменён</small></article>
      <article><span><MessageCircle /> Каналы</span><strong>Сохранены</strong><small>Поэтапное подключение</small></article>
    </section>

    <section className="rebuild-module-grid">
      {modules.map((module) => <a key={module.href} href={module.href}><span>{module.icon}</span><div><h2>{module.title}</h2><p>{module.text}</p></div><ChevronRight /></a>)}
    </section>

    <section className="rebuild-note"><Megaphone /><div><strong>Режим безопасной пересборки</strong><p>Старые frontend-компоненты остаются в репозитории, но больше не загружаются автоматически. Это исключает каскадные runtime-ошибки на главной странице.</p></div></section>
  </main>;
}

function ModulePage({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <main className="rebuild-content"><section className="rebuild-module-page"><span>{icon}</span><h1>{title}</h1><p>{description}</p><div><a href="/">На главную</a><a className="primary" href="/crm">Открыть CRM</a></div></section></main>;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="rebuild-loading"><span className="rebuild-loader" /><p>{label}</p></main>;
}
