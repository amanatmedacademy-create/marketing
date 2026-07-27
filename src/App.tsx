import { useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  Cable,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Search,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const money = (value: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'KZT', maximumFractionDigits: 0,
}).format(value);
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : '0%';

const daily = [
  { date: '01.07', leads: 56, previous: 42, spend: 402000, revenue: 2410000 },
  { date: '05.07', leads: 61, previous: 47, spend: 438000, revenue: 2950000 },
  { date: '10.07', leads: 73, previous: 51, spend: 515000, revenue: 3380000 },
  { date: '15.07', leads: 66, previous: 62, spend: 491000, revenue: 3010000 },
  { date: '20.07', leads: 84, previous: 58, spend: 612000, revenue: 4210000 },
  { date: '25.07', leads: 77, previous: 69, spend: 596000, revenue: 3940000 },
  { date: '28.07', leads: 69, previous: 65, spend: 674400, revenue: 3034000 },
];

const sources = [
  { source: 'Meta WhatsApp', platform: 'Meta', leads: 188, target: 113, arrived: 59, sales: 24, revenue: 12115000, spend: 1421000 },
  { source: 'Meta Web', platform: 'Meta', leads: 74, target: 39, arrived: 18, sales: 7, revenue: 3368000, spend: 734000 },
  { source: 'TikTok Web', platform: 'TikTok', leads: 91, target: 42, arrived: 20, sales: 5, revenue: 2265000, spend: 702400 },
  { source: 'Яндекс Поиск', platform: 'Яндекс', leads: 48, target: 31, arrived: 15, sales: 5, revenue: 2435000, spend: 465000 },
  { source: 'Google Search', platform: 'Google', leads: 31, target: 19, arrived: 10, sales: 3, revenue: 1390000, spend: 276000 },
  { source: 'Органика', platform: 'Органика', leads: 54, target: 28, arrived: 11, sales: 3, revenue: 1361000, spend: 130000 },
];

const leads = [
  { id: 'L-1048', name: 'Айжан С.', phone: '+7 701 441 23 90', source: 'Meta WhatsApp', campaign: 'Грыжа — июль', manager: 'Айдана', stage: 'Новый', next: 'Позвонить до 09:30' },
  { id: 'L-1047', name: 'Марат Н.', phone: '+7 707 882 11 52', source: 'TikTok Web', campaign: 'Боль в пояснице', manager: 'Лаура', stage: 'Квалификация', next: 'Уточнить МРТ' },
  { id: 'L-1046', name: 'Жанна А.', phone: '+7 775 212 40 18', source: 'Meta Web', campaign: 'Шея — консультация', manager: 'Ансар', stage: 'Записан', next: 'Подтвердить визит' },
  { id: 'L-1045', name: 'Серик Б.', phone: '+7 747 555 16 03', source: 'Яндекс Поиск', campaign: 'Лечение грыжи', manager: 'Айдана', stage: 'Пришёл', next: 'Получить решение врача' },
  { id: 'L-1044', name: 'Дина К.', phone: '+7 702 118 91 07', source: 'Meta WhatsApp', campaign: 'Грыжа — июль', manager: 'Лаура', stage: 'Продажа', next: 'Контроль доплаты' },
  { id: 'L-1043', name: 'Ерлан М.', phone: '+7 777 330 10 11', source: 'Органика', campaign: 'Сарафанное радио', manager: 'Ансар', stage: 'Отказ', next: 'Повторный контакт 05.08' },
];

const ads = [
  { platform: 'Meta', campaign: 'Грыжа — июль', adset: 'Алматы 35–60', creative: 'Врач объясняет МРТ', status: 'ACTIVE', spend: 612000, impressions: 428000, clicks: 4930, leads: 96, sales: 14, revenue: 6720000 },
  { platform: 'Meta', campaign: 'Шея — консультация', adset: 'Алматы 30–55', creative: 'Боль между лопатками', status: 'ACTIVE', spend: 397000, impressions: 311000, clicks: 3380, leads: 54, sales: 8, revenue: 3840000 },
  { platform: 'TikTok', campaign: 'Боль в пояснице', adset: 'Broad KZ', creative: '3 ошибки при грыже', status: 'ACTIVE', spend: 408400, impressions: 721000, clicks: 8810, leads: 67, sales: 4, revenue: 1920000 },
  { platform: 'Яндекс', campaign: 'Лечение грыжи', adset: 'Поиск Алматы', creative: 'Текстовое объявление 2', status: 'PAUSED', spend: 276000, impressions: 68000, clicks: 1290, leads: 31, sales: 4, revenue: 1920000 },
];

const integrations = [
  ['Bitrix24', 'Импорт лидов, стадий и истории', 'Подготовлено'],
  ['Wazzup', 'WhatsApp и единая переписка', 'Ожидает API'],
  ['Binotel', 'Звонки, записи и статусы', 'Ожидает API'],
  ['Sipuni', 'Телефония и webhooks', 'Ожидает API'],
  ['Meta Ads', 'Кампании, расходы и лиды', 'Следующий этап'],
  ['TikTok Ads', 'Кампании и рекламные метрики', 'После Meta'],
  ['n8n', 'Оркестрация webhook-сценариев', 'Подготовлено'],
];

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="heading"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}
function Card({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="metric"><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function Dashboard() {
  const [source, setSource] = useState('Все источники');
  const visible = useMemo(() => source === 'Все источники' ? sources : sources.filter(x => x.source === source), [source]);
  return <div className="stack">
    <div className="page-top"><Heading eyebrow="Marketing analytics" title="Дашборд маркетинга" text="Реклама, лиды, записи, продажи и выручка в одной системе." />
      <select value={source} onChange={e => setSource(e.target.value)}><option>Все источники</option>{sources.map(x => <option key={x.source}>{x.source}</option>)}</select>
    </div>
    <div className="metrics">
      <Card title="Все лиды" value="486" detail="+18,7% к прошлому периоду" />
      <Card title="Целевые лиды" value="272" detail="56,0% от всех лидов" />
      <Card title="Пришли" value="133" detail="48,9% от целевых" />
      <Card title="Продажи" value="47" detail="35,3% от пришедших" />
      <Card title="Выручка" value={money(22934000)} detail="Средний чек 488 000 ₸" />
      <Card title="Расход" value={money(3728400)} detail="ROMI 515%" />
    </div>
    <div className="grid-2">
      <Panel title="Динамика лидов"><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><defs><linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity={.45}/><stop offset="1" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="date" stroke="#64748b"/><YAxis stroke="#64748b"/><Tooltip contentStyle={{background:'#0d1730',border:'1px solid #1e2d4a'}}/><Area dataKey="previous" stroke="#64748b" fill="transparent"/><Area dataKey="leads" stroke="#3b82f6" fill="url(#leadFill)"/></AreaChart></ResponsiveContainer></div></Panel>
      <Panel title="Выручка по дням"><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={daily}><CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="date" stroke="#64748b"/><YAxis stroke="#64748b" tickFormatter={v => `${Math.round(v/1000000)}м`}/><Tooltip formatter={v => money(Number(v))} contentStyle={{background:'#0d1730',border:'1px solid #1e2d4a'}}/><Bar dataKey="revenue" fill="#22c55e" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div></Panel>
    </div>
    <Panel title="Источники и сквозная аналитика"><div className="table-wrap"><table><thead><tr><th>Источник</th><th>Лиды</th><th>Целевые</th><th>Пришли</th><th>Продажи</th><th>Расход</th><th>Выручка</th><th>ROMI</th></tr></thead><tbody>{visible.map(x => <tr key={x.source}><td><b>{x.source}</b><small>{x.platform}</small></td><td>{x.leads}</td><td>{x.target} <small>{percent(x.target,x.leads)}</small></td><td>{x.arrived}</td><td>{x.sales}</td><td>{money(x.spend)}</td><td>{money(x.revenue)}</td><td className="good">{Math.round((x.revenue-x.spend)/x.spend*100)}%</td></tr>)}</tbody></table></div></Panel>
  </div>;
}

function Leads() {
  const stages = ['Новый','Квалификация','Записан','Пришёл','Продажа','Отказ'];
  return <div className="stack"><Heading eyebrow="Sales CRM" title="Лиды" text="Собственная воронка отдела продаж вместо зависимости от Bitrix24." />
    <div className="kanban">{stages.map(stage => <section key={stage}><header><b>{stage}</b><span>{leads.filter(x=>x.stage===stage).length}</span></header>{leads.filter(x=>x.stage===stage).map(lead => <article key={lead.id}><small>{lead.id} · {lead.source}</small><strong>{lead.name}</strong><span>{lead.phone}</span><p>{lead.next}</p><footer>{lead.manager}</footer></article>)}</section>)}</div>
    <Panel title="Все лиды"><div className="table-wrap"><table><thead><tr><th>ID</th><th>Клиент</th><th>Источник</th><th>Кампания</th><th>Менеджер</th><th>Стадия</th><th>Следующее действие</th></tr></thead><tbody>{leads.map(x=><tr key={x.id}><td>{x.id}</td><td><b>{x.name}</b><small>{x.phone}</small></td><td>{x.source}</td><td>{x.campaign}</td><td>{x.manager}</td><td><span className="badge">{x.stage}</span></td><td>{x.next}</td></tr>)}</tbody></table></div></Panel>
  </div>;
}

function Ads() { return <div className="stack"><Heading eyebrow="Paid media" title="Рекламные объявления" text="Расходы рекламных кабинетов объединены с продажами из CRM." />
  <Panel title="Объявления"><div className="table-wrap"><table><thead><tr><th>Платформа</th><th>Кампания / группа</th><th>Креатив</th><th>Статус</th><th>Расход</th><th>Показы</th><th>Клики</th><th>Лиды</th><th>Продажи</th><th>Выручка</th></tr></thead><tbody>{ads.map((x,i)=><tr key={i}><td><b>{x.platform}</b></td><td><b>{x.campaign}</b><small>{x.adset}</small></td><td>{x.creative}</td><td><span className={`badge ${x.status==='ACTIVE'?'badge--green':''}`}>{x.status}</span></td><td>{money(x.spend)}</td><td>{number(x.impressions)}</td><td>{number(x.clicks)}</td><td>{x.leads}</td><td>{x.sales}</td><td>{money(x.revenue)}</td></tr>)}</tbody></table></div></Panel></div>; }

function Conversions() { const funnel=[['Лиды',486],['Целевые',272],['Записаны',191],['Пришли',133],['Продажи',47]]; return <div className="stack"><Heading eyebrow="Funnel" title="Конверсии" text="Диагностика потерь на каждом этапе маркетинга и продаж." /><div className="grid-2"><Panel title="Воронка продаж"><div className="funnel">{funnel.map(([label,value],i)=><div key={String(label)}><span>{label}</span><div><i style={{width:`${Number(value)/486*100}%`}}/></div><b>{value}</b>{i>0&&<small>{percent(Number(value),Number(funnel[i-1][1]))}</small>}</div>)}</div></Panel><Panel title="Конверсия по источникам"><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={sources} layout="vertical"><CartesianGrid stroke="#1e2d4a" horizontal={false}/><XAxis type="number" stroke="#64748b"/><YAxis type="category" dataKey="source" stroke="#64748b" width={110}/><Tooltip contentStyle={{background:'#0d1730',border:'1px solid #1e2d4a'}}/><Bar dataKey="sales" fill="#8b5cf6" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></Panel></div></div>; }

function Creatives() { return <div className="stack"><Heading eyebrow="Creative intelligence" title="Анализ креативов" text="Сравнение креативов не только по CTR, но и по качеству лидов и продажам." /><div className="cards">{ads.map((x,i)=><article className="creative" key={i}><div className="creative__preview"><Sparkles size={28}/></div><small>{x.platform} · Видео</small><h2>{x.creative}</h2><p>{x.campaign}</p><div><span>Расход <b>{money(x.spend)}</b></span><span>Лиды <b>{x.leads}</b></span><span>Продажи <b>{x.sales}</b></span><span>CTR <b>{percent(x.clicks,x.impressions)}</b></span></div></article>)}</div></div>; }

function Integrations() { return <div className="stack"><Heading eyebrow="Data connections" title="Интеграции" text="Центральная точка подключения CRM, коммуникаций и рекламных кабинетов." /><div className="cards">{integrations.map(([name,text,status])=><article className="integration" key={name}><div><Cable size={22}/></div><h2>{name}</h2><p>{text}</p><span className="badge">{status}</span></article>)}</div><Panel title="Архитектурный принцип"><p className="note">IMDS хранит основную бизнес-логику и данные. n8n используется как оркестратор webhook и фоновых сценариев, но не как единственное хранилище. Секретные API-токены должны находиться только на backend или в Edge Functions.</p></Panel></div>; }

const nav = [
  ['/', 'Дашборд', LayoutDashboard], ['/leads','Лиды',UsersRound], ['/ads','Объявления',CircleDollarSign], ['/conversions','Конверсии',BarChart3], ['/creatives','Креативы',Sparkles], ['/integrations','Интеграции',Cable],
] as const;

function Shell() {
  const [open,setOpen]=useState(false);
  return <div className="shell"><aside className={open?'open':''}><div className="brand"><MessageSquareText/><div><b>AMANAT MED</b><span>Marketing</span></div></div><nav>{nav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/' as string} onClick={()=>setOpen(false)}><Icon size={18}/><span>{label}</span></NavLink>)}</nav></aside><main><header className="topbar"><button onClick={()=>setOpen(!open)}><Menu/></button><div className="search"><Search size={17}/><input placeholder="Поиск лидов, кампаний и источников"/></div><div className="top-actions"><button><Bell size={18}/></button><span className="avatar">AM</span></div></header><div className="content"><Routes><Route path="/" element={<Dashboard/>}/><Route path="/leads" element={<Leads/>}/><Route path="/ads" element={<Ads/>}/><Route path="/conversions" element={<Conversions/>}/><Route path="/creatives" element={<Creatives/>}/><Route path="/integrations" element={<Integrations/>}/></Routes></div></main></div>;
}

export default function App(){return <BrowserRouter><Shell/></BrowserRouter>}
