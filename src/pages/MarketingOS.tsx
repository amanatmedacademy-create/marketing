import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, Cable, CalendarDays, CheckCircle2, FileText, Goal, Images, LayoutDashboard, Megaphone, MousePointerClick, RefreshCw, Sparkles, Target, UsersRound, Workflow, Zap } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import AdCreativeGallery from '../components/AdCreativeGallery';
import AdsManagerPage from '../components/AdsManagerPage';
import { useAuth } from '../components/AuthGate';
import { operationsApi, type Campaign, type ContentItem, type MarketingTask } from '../services/operations';
import { SafeLeadFormsPage, SafeMediaPlanPage, SafeUtmBuilderPage } from './GrowthToolsSafePages';
import JourneyAutomationPage from './JourneyAutomationPage';
import '../marketing-hub.css';

type MarketingView = 'overview' | 'ads' | 'creatives' | 'content' | 'media-plan' | 'leads' | 'attribution' | 'automation';
type AdsRow = { platform?: string; source?: string; account_id?: string; leads?: number; sales?: number; revenue?: number };
type AdsResponse = { accounts?: Array<{ id: string; name: string; platform?: string }>; rows?: AdsRow[] };
type PlatformKey = 'Meta' | 'TikTok' | 'Google' | 'Yandex';

const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(value || 0);
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value || 0);
const formatDate = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—';
const normalizePlatform = (value?: string | null): PlatformKey | null => {
  const text = String(value || '').toLowerCase();
  if (text.includes('meta') || text.includes('facebook') || text.includes('instagram')) return 'Meta';
  if (text.includes('tiktok')) return 'TikTok';
  if (text.includes('google')) return 'Google';
  if (text.includes('yandex') || text.includes('яндекс')) return 'Yandex';
  return null;
};

const platformDefinitions: Array<{ key: PlatformKey; short: string; title: string; subtitle: string }> = [
  { key: 'Meta', short: 'M', title: 'Meta Ads', subtitle: 'Facebook · Instagram' },
  { key: 'TikTok', short: 'TT', title: 'TikTok Ads', subtitle: 'TikTok for Business' },
  { key: 'Google', short: 'G', title: 'Google Ads', subtitle: 'Search · Display · YouTube' },
  { key: 'Yandex', short: 'Я', title: 'Yandex Direct', subtitle: 'Search · РСЯ' },
];

export default function MarketingOS() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [adsData, setAdsData] = useState<AdsResponse>({ accounts: [], rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canView = (moduleId: string) => user.role === 'administrator' || Boolean(user.permissions?.[moduleId]?.view || user.permissions?.[moduleId]?.manage);
  const canViewAny = (moduleIds: string[]) => moduleIds.some(canView);

  const tabs = useMemo(() => [
    { id: 'overview' as const, label: 'Обзор', icon: LayoutDashboard, modules: ['dashboard'] },
    { id: 'ads' as const, label: 'Реклама', icon: Megaphone, modules: ['advertising'] },
    { id: 'creatives' as const, label: 'Креативы', icon: Images, modules: ['advertising'] },
    { id: 'content' as const, label: 'Контент', icon: FileText, modules: ['dashboard'] },
    { id: 'media-plan' as const, label: 'Медиаплан', icon: Goal, modules: ['dashboard'] },
    { id: 'leads' as const, label: 'Лиды', icon: UsersRound, modules: ['crm.leads'] },
    { id: 'attribution' as const, label: 'UTM и ссылки', icon: MousePointerClick, modules: ['analytics.attribution'] },
    { id: 'automation' as const, label: 'Автоматизация', icon: Zap, modules: ['dashboard'] },
  ], []);
  const visibleTabs = tabs.filter((tab) => canViewAny(tab.modules));
  const requested = searchParams.get('view') as MarketingView | null;
  const fallbackView = visibleTabs[0]?.id || 'overview';
  const view = visibleTabs.some((tab) => tab.id === requested) ? requested as MarketingView : fallbackView;

  const changeView = (next: MarketingView) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('view'); else params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    const errors: string[] = [];
    if (canView('dashboard')) {
      try {
        const [campaignRows, taskRows, contentRows] = await Promise.all([
          operationsApi.campaigns.list(),
          operationsApi.tasks.list(),
          operationsApi.content.list(),
        ]);
        setCampaigns(campaignRows);
        setTasks(taskRows);
        setContent(contentRows);
      } catch (reason) {
        errors.push(reason instanceof Error ? reason.message : 'Не удалось загрузить операционные данные');
      }
    }
    if (canView('advertising')) {
      try {
        const response = await fetch('/api/analytics/ad-manager?days=30');
        const body = await response.text();
        if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
        setAdsData(JSON.parse(body) as AdsResponse);
      } catch (reason) {
        errors.push(reason instanceof Error ? reason.message : 'Не удалось загрузить рекламные данные');
      }
    }
    setError(errors.length ? errors.join(' · ') : null);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const platformStats = useMemo(() => {
    const stats = new Map<PlatformKey, { accounts: Set<string>; leads: number; sales: number; revenue: number }>();
    for (const definition of platformDefinitions) stats.set(definition.key, { accounts: new Set(), leads: 0, sales: 0, revenue: 0 });
    for (const account of adsData.accounts || []) {
      const key = normalizePlatform(account.platform || account.name);
      if (key) stats.get(key)?.accounts.add(account.id);
    }
    for (const row of adsData.rows || []) {
      const key = normalizePlatform(`${row.platform || ''} ${row.source || ''}`);
      if (!key) continue;
      const item = stats.get(key)!;
      if (row.account_id) item.accounts.add(row.account_id);
      item.leads += Number(row.leads || 0);
      item.sales += Number(row.sales || 0);
      item.revenue += Number(row.revenue || 0);
    }
    return stats;
  }, [adsData]);

  const activeCampaigns = campaigns.filter((item) => item.status === 'Активна').length;
  const openTasks = tasks.filter((task) => !task.done).length;
  const readyContent = content.filter((item) => item.status === 'Готово' || item.status === 'Сегодня').length;
  const totalAdLeads = [...platformStats.values()].reduce((sum, item) => sum + item.leads, 0);
  const totalAdSales = [...platformStats.values()].reduce((sum, item) => sum + item.sales, 0);

  return <div className="marketing-hub">
    <header className="marketing-hub-hero">
      <div>
        <span className="marketing-hub-eyebrow"><Sparkles size={15}/> IMDS MARKETING HUB</span>
        <h1>Центр маркетинга</h1>
        <p>Операционная работа с рекламой, креативами, контентом, медиапланом, лидогенерацией, UTM и маркетинговыми автоматизациями.</p>
      </div>
      <button className="button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={16}/>{loading ? 'Обновляем…' : 'Обновить'}</button>
    </header>

    <div className="marketing-hub-tabs" role="tablist" aria-label="Разделы центра маркетинга">
      {visibleTabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} className={view === tab.id ? 'active' : ''} onClick={() => changeView(tab.id)}><Icon size={16}/>{tab.label}</button>; })}
    </div>

    {error && <div className="marketing-hub-error">{error}</div>}

    {view === 'overview' && <Overview loading={loading} campaigns={campaigns} content={content} activeCampaigns={activeCampaigns} openTasks={openTasks} readyContent={readyContent} totalAdLeads={totalAdLeads} totalAdSales={totalAdSales} platformStats={platformStats} canView={canView} changeView={changeView}/>} 
    {view === 'ads' && <section className="marketing-hub-module marketing-hub-module--ads"><ModuleHeading title="Реклама" text="Операционная работа с кабинетами, кампаниями, группами и объявлениями. Креативы вынесены в отдельную верхнюю вкладку."/><MarketingBoundaryLinks canView={canView}/><AdsManagerPage/></section>}
    {view === 'creatives' && <section className="marketing-hub-module"><ModuleHeading title="Креативы" text="Визуальная библиотека реальных рекламных объявлений с нативной валютой кабинета и быстрым preview."/><AdCreativeGallery/></section>}
    {view === 'content' && <ContentWorkspace campaigns={campaigns} content={content} loading={loading} />}
    {view === 'media-plan' && <section className="marketing-hub-module"><ModuleHeading title="Медиаплан" text="Планирование бюджетов, каналов и периодов без выхода из Центра маркетинга."/><SafeMediaPlanPage/></section>}
    {view === 'leads' && <section className="marketing-hub-module"><ModuleHeading title="Лиды и формы" text="Формы захвата и точки входа лидов. Операционная CRM остаётся связанной с этим разделом."/><SafeLeadFormsPage/></section>}
    {view === 'attribution' && <section className="marketing-hub-module"><ModuleHeading title="UTM и ссылки" text="Создание и хранение отслеживаемых рекламных ссылок. Анализ атрибуции находится в модуле Аналитика."/><SafeUtmBuilderPage/></section>}
    {view === 'automation' && <section className="marketing-hub-module"><ModuleHeading title="Автоматизация" text="Маркетинговые сценарии и Journey Automation в том же рабочем контуре."/><JourneyAutomationPage/></section>}
  </div>;
}

function Overview({loading,campaigns,content,activeCampaigns,openTasks,readyContent,totalAdLeads,totalAdSales,platformStats,canView,changeView}:{loading:boolean;campaigns:Campaign[];content:ContentItem[];activeCampaigns:number;openTasks:number;readyContent:number;totalAdLeads:number;totalAdSales:number;platformStats:Map<PlatformKey,{accounts:Set<string>;leads:number;sales:number;revenue:number}>;canView:(id:string)=>boolean;changeView:(view:MarketingView)=>void}) {
  return <div className="marketing-hub-overview">
    <section className="marketing-hub-kpis">
      <article><span>Активные инициативы</span><strong>{activeCampaigns}</strong><small>{campaigns.length} всего в реестре</small></article>
      <article><span>Лиды из рекламы</span><strong>{number(totalAdLeads)}</strong><small>за последние 30 дней</small></article>
      <article><span>Продажи</span><strong>{number(totalAdSales)}</strong><small>связанные с рекламными данными</small></article>
      <article><span>Рабочий поток</span><strong>{openTasks}</strong><small>{readyContent} контент-единиц готовы / сегодня</small></article>
    </section>

    {canView('advertising') && <section className="marketing-hub-section">
      <div className="marketing-hub-section-head"><div><span>РЕКЛАМНЫЕ ДАННЫЕ</span><h2>Платформы в работе</h2><p>Здесь показываем уже полученные рекламные данные. Настройка подключений выполняется в модуле «Интеграции».</p></div><button className="marketing-hub-text-button" type="button" onClick={() => changeView('ads')}>Открыть Ads Workspace <ArrowUpRight size={15}/></button></div>
      <div className="marketing-platform-grid">{platformDefinitions.map((platform) => {
        const stat = platformStats.get(platform.key)!;
        const hasData = stat.accounts.size > 0;
        return <button className="marketing-platform-card" type="button" key={platform.key} onClick={() => changeView('ads')}>
          <div className="marketing-platform-card-top"><span className={`marketing-platform-mark marketing-platform-mark--${platform.key.toLowerCase()}`}>{platform.short}</span><span className={`marketing-platform-state ${hasData ? 'connected' : ''}`}>{hasData ? 'Есть данные' : 'Нет данных'}</span></div>
          <div><h3>{platform.title}</h3><p>{platform.subtitle}</p></div>
          <div className="marketing-platform-metrics"><span><b>{stat.accounts.size}</b> кабинетов</span><span><b>{number(stat.leads)}</b> лидов</span><span><b>{number(stat.sales)}</b> продаж</span></div>
          <footer><span>{hasData && stat.revenue > 0 ? `CRM-выручка ${money(stat.revenue)}` : hasData ? 'Открыть рекламные объекты' : 'Ожидаем данные из интеграции'}</span><ArrowUpRight size={16}/></footer>
        </button>;
      })}</div>
    </section>}

    <section className="marketing-hub-section">
      <div className="marketing-hub-section-head"><div><span>РАБОЧИЕ МОДУЛИ</span><h2>Маркетинг без дублирования платформы</h2><p>В Центре маркетинга остаются только рабочие маркетинговые процессы.</p></div></div>
      <div className="marketing-module-grid">
        {canView('advertising') && <PreviewCard icon={<Images size={20}/>} title="Креативы" text="Реальные изображения и видео рекламных объявлений" onClick={() => changeView('creatives')}/>} 
        {canView('dashboard') && <PreviewCard icon={<FileText size={20}/>} title="Контент" text={`${content.length} материалов · ${readyContent} готовы / сегодня`} onClick={() => changeView('content')}/>} 
        {canView('dashboard') && <PreviewCard icon={<Goal size={20}/>} title="Медиаплан" text="Бюджеты, каналы, периоды и план-факт" onClick={() => changeView('media-plan')}/>} 
        {canView('crm.leads') && <PreviewCard icon={<UsersRound size={20}/>} title="Лиды" text="Формы захвата и точки входа в CRM" onClick={() => changeView('leads')}/>} 
        {canView('analytics.attribution') && <PreviewCard icon={<Target size={20}/>} title="UTM и ссылки" text="Разметка и сохранение рекламных ссылок" onClick={() => changeView('attribution')}/>} 
        {canView('dashboard') && <PreviewCard icon={<Workflow size={20}/>} title="Автоматизация" text="Journey и маркетинговые сценарии" onClick={() => changeView('automation')}/>} 
      </div>
    </section>

    {canView('dashboard') && <section className="marketing-hub-section">
      <div className="marketing-hub-section-head"><div><span>СЕЙЧАС В РАБОТЕ</span><h2>Инициативы</h2></div></div>
      {loading ? <div className="marketing-hub-empty">Загрузка…</div> : campaigns.length === 0 ? <div className="marketing-hub-empty">Маркетинговых инициатив пока нет.</div> : <div className="marketing-initiative-list">{campaigns.slice(0,6).map((item) => <article key={item.id}><div className="marketing-initiative-icon"><Megaphone size={17}/></div><div><strong>{item.name}</strong><span>{item.channel || 'Канал не указан'} · {item.objective || 'Цель не указана'}</span></div><div className="marketing-initiative-meta"><b>{money(Number(item.budget || 0))}</b><small>{formatDate(item.starts_on)} — {formatDate(item.ends_on)}</small></div><span className={`marketing-initiative-status ${item.status === 'Активна' ? 'active' : ''}`}>{item.status}</span></article>)}</div>}
    </section>}
  </div>;
}

function MarketingBoundaryLinks({canView}:{canView:(id:string)=>boolean}) {
  const links = [
    { to:'/integrations', title:'Подключения', text:'Meta, TikTok, Google, GA4 и синхронизация', icon:<Cable size={18}/>, show:canView('integrations') },
    { to:'/analytics', title:'Анализ рекламы', text:'ROAS, ROMI, CPL, CAC и дерево рекламных объектов', icon:<BarChart3 size={18}/>, show:canView('analytics.reports') },
    { to:'/growth', title:'Events / CAPI', text:'Conversion events, destinations и доставка событий', icon:<Activity size={18}/>, show:canView('analytics.reports') },
  ].filter((item) => item.show);
  if (!links.length) return null;
  return <div className="marketing-boundary-links">{links.map((item)=><Link key={item.to} to={item.to}><span>{item.icon}</span><div><strong>{item.title}</strong><small>{item.text}</small></div><ArrowUpRight size={15}/></Link>)}</div>;
}

function ContentWorkspace({campaigns,content,loading}:{campaigns:Campaign[];content:ContentItem[];loading:boolean}) {
  return <section className="marketing-hub-module">
    <ModuleHeading title="Контент" text="Производство, готовность и публикация контента — отдельно от рекламного Ads Workspace."/>
    <div className="marketing-content-summary"><article><CalendarDays size={19}/><div><span>Материалов</span><strong>{content.length}</strong></div></article><article><CheckCircle2 size={19}/><div><span>Готово / сегодня</span><strong>{content.filter((item) => item.status === 'Готово' || item.status === 'Сегодня').length}</strong></div></article><article><Activity size={19}/><div><span>Инициатив</span><strong>{campaigns.length}</strong></div></article></div>
    {loading ? <div className="marketing-hub-empty">Загрузка…</div> : content.length === 0 ? <div className="marketing-hub-empty">Контент-план пока пуст.</div> : <div className="marketing-content-board">{content.map((item) => <article key={item.id}><time>{formatDate(item.publish_on)}</time><div><strong>{item.title}</strong><span>{item.platform || 'Площадка не указана'} · {item.owner || 'Не назначен'}</span><small>{item.production_stage || 'Этап не указан'}</small></div><b className={item.status === 'Готово' ? 'ready' : item.status === 'Сегодня' ? 'today' : ''}>{item.status}</b></article>)}</div>}
  </section>;
}

function ModuleHeading({title,text}:{title:string;text:string}) { return <div className="marketing-hub-module-heading"><div><span>MARKETING HUB</span><h2>{title}</h2><p>{text}</p></div></div>; }
function PreviewCard({icon,title,text,onClick}:{icon:React.ReactNode;title:string;text:string;onClick:()=>void}) { return <button className="marketing-module-card" type="button" onClick={onClick}><span>{icon}</span><div><strong>{title}</strong><p>{text}</p></div><ArrowUpRight size={16}/></button>; }
