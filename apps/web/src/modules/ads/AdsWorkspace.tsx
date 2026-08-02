import { useMemo, useState } from 'react';
import { BarChart3, Bot, BriefcaseBusiness, Facebook, FileText, Globe2, Megaphone, Plus, RefreshCw, Sparkles, Users, Wand2 } from 'lucide-react';
import { useDealsQuery, usePipelinesQuery } from '../deals/api/useDeals';

type Network = 'all' | 'facebook' | 'tiktok' | 'google' | 'yandex' | 'telegram' | 'linkedin';
type Section = 'analytics' | 'campaigns' | 'forms' | 'audiences' | 'creative' | 'rpn' | 'recommendations';

type ChannelSummary = {
  id: Network;
  label: string;
  leads: number;
  sales: number;
  revenue: number;
};

const networks: Array<{ id: Network; label: string }> = [
  { id: 'all', label: 'Все каналы' },
  { id: 'facebook', label: 'Meta Ads' },
  { id: 'tiktok', label: 'TikTok Ads' },
  { id: 'google', label: 'Google Ads' },
  { id: 'yandex', label: 'Yandex Ads' },
  { id: 'telegram', label: 'Telegram Ads' },
  { id: 'linkedin', label: 'LinkedIn Ads' },
];

const sections: Array<{ id: Section; label: string; icon: typeof BarChart3 }> = [
  { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { id: 'campaigns', label: 'Кампании', icon: BriefcaseBusiness },
  { id: 'forms', label: 'Lead-формы', icon: FileText },
  { id: 'audiences', label: 'Аудитории', icon: Users },
  { id: 'creative', label: 'AI-креативы', icon: Wand2 },
  { id: 'rpn', label: 'Отчёт РПН', icon: BarChart3 },
  { id: 'recommendations', label: 'AI-рекомендации', icon: Sparkles },
];

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

function detectNetwork(source: string | null | undefined): Network {
  const value = (source ?? '').toLowerCase();
  if (value.includes('meta') || value.includes('facebook') || value.includes('instagram')) return 'facebook';
  if (value.includes('tiktok')) return 'tiktok';
  if (value.includes('google') || value.includes('youtube')) return 'google';
  if (value.includes('yandex')) return 'yandex';
  if (value.includes('telegram')) return 'telegram';
  if (value.includes('linkedin')) return 'linkedin';
  return 'all';
}

export function AdsWorkspace() {
  const [network, setNetwork] = useState<Network>('all');
  const [section, setSection] = useState<Section>('analytics');
  const [audienceModal, setAudienceModal] = useState(false);
  const pipelinesQuery = usePipelinesQuery();
  const pipeline = pipelinesQuery.data?.find(item => item.isDefault) ?? pipelinesQuery.data?.[0];
  const dealsQuery = useDealsQuery(pipeline?.id);
  const deals = dealsQuery.data?.items ?? [];
  const wonStages = new Set((pipeline?.stages ?? []).filter(stage => stage.isWon).map(stage => stage.id));

  const summaries = useMemo<ChannelSummary[]>(() => networks.filter(item => item.id !== 'all').map(item => {
    const channelDeals = deals.filter(deal => detectNetwork(deal.source) === item.id);
    const sales = channelDeals.filter(deal => wonStages.has(deal.stageId));
    return {
      id: item.id,
      label: item.label,
      leads: channelDeals.length,
      sales: sales.length,
      revenue: sales.reduce((sum, deal) => sum + Number(deal.oneTimeAmount ?? 0), 0),
    };
  }), [deals, wonStages]);

  const selected = network === 'all'
    ? {
        id: 'all' as const,
        label: 'Все каналы',
        leads: summaries.reduce((sum, item) => sum + item.leads, 0),
        sales: summaries.reduce((sum, item) => sum + item.sales, 0),
        revenue: summaries.reduce((sum, item) => sum + item.revenue, 0),
      }
    : summaries.find(item => item.id === network) ?? { id: network, label: '', leads: 0, sales: 0, revenue: 0 };
  const conversion = selected.leads ? Math.round((selected.sales / selected.leads) * 100) : 0;
  const maxLeads = Math.max(...summaries.map(item => item.leads), 1);

  return <div className="ads-workspace">
    <div className="ads-heading"><span><Megaphone size={20} /></span><div><h1>Рекламная аналитика</h1><p>Лиды, продажи и выручка по рекламным каналам на основе CRM-атрибуции.</p></div></div>
    <div className="ads-network-tabs">{networks.map((item) => <button key={item.id} className={network === item.id ? 'active' : ''} onClick={() => setNetwork(item.id)}>{item.id === 'facebook' ? <Facebook size={14} /> : item.id === 'google' || item.id === 'yandex' ? <Globe2 size={14} /> : <Megaphone size={14} />}{item.label}</button>)}</div>

    <div className="ads-section-tabs">{sections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}><Icon size={14} />{label}</button>)}</div>

    {section === 'analytics' && <>
      <div className="ads-metrics ads-metrics-live">
        <article><span>Расход</span><strong>—</strong><small>Подключите рекламный API</small></article>
        <article><span>Лиды в CRM</span><strong>{dealsQuery.isLoading ? '—' : selected.leads}</strong><small>{selected.label}</small></article>
        <article><span>Продажи</span><strong>{dealsQuery.isLoading ? '—' : selected.sales}</strong><small>Успешные сделки</small></article>
        <article><span>Выручка</span><strong>{dealsQuery.isLoading ? '—' : money.format(selected.revenue)}</strong><small>По закрытым продажам</small></article>
        <article><span>Конверсия</span><strong>{dealsQuery.isLoading ? '—' : `${conversion}%`}</strong><small>Лид → продажа</small></article>
      </div>

      <div className="ads-analytics-grid">
        <section className="ads-card ads-channel-chart">
          <div className="ads-panel-head"><div><h2>Лиды по каналам</h2><p>Распределение сделок по полю «Источник»</p></div><button><RefreshCw size={14} /> Обновить</button></div>
          {summaries.some(item => item.leads) ? <div className="ads-channel-bars">{summaries.map(item => <button key={item.id} onClick={() => setNetwork(item.id)}>
            <div><strong>{item.label}</strong><span>{item.leads} лидов</span></div>
            <div className="ads-bar-track"><i style={{ width: `${Math.max(item.leads / maxLeads * 100, item.leads ? 6 : 0)}%` }} /></div>
            <b>{item.sales}</b>
          </button>)}</div> : <div className="ads-empty">В CRM пока нет сделок с распознанными рекламными источниками.</div>}
        </section>

        <section className="ads-card ads-attribution-card">
          <div className="ads-panel-head"><div><h2>Атрибуция</h2><p>Качество заполнения источников</p></div></div>
          <div className="ads-attribution-ring" style={{ '--value': `${deals.length ? Math.round((summaries.reduce((sum, item) => sum + item.leads, 0) / deals.length) * 100) : 0}%` } as React.CSSProperties}>
            <div><strong>{deals.length ? Math.round((summaries.reduce((sum, item) => sum + item.leads, 0) / deals.length) * 100) : 0}%</strong><span>распознано</span></div>
          </div>
          <p className="ads-data-note">Нераспознанные источники не включаются в рекламную аналитику.</p>
        </section>
      </div>

      <section className="ads-card ads-channel-table">
        <div className="ads-panel-head"><div><h2>Эффективность каналов</h2><p>CPL и ROMI появятся после подключения расходов рекламных кабинетов.</p></div></div>
        <div className="ads-table-scroll"><table><thead><tr><th>Канал</th><th>Расход</th><th>Лиды</th><th>CPL</th><th>Продажи</th><th>Конверсия</th><th>Выручка</th><th>ROMI</th></tr></thead><tbody>{summaries.map(item => <tr key={item.id}><td><strong>{item.label}</strong></td><td>—</td><td>{item.leads}</td><td>—</td><td>{item.sales}</td><td>{item.leads ? Math.round(item.sales / item.leads * 100) : 0}%</td><td>{money.format(item.revenue)}</td><td>—</td></tr>)}</tbody></table></div>
      </section>
    </>}

    {section === 'campaigns' && <section className="ads-card"><div className="ads-card-toolbar"><select><option>Рекламный кабинет не подключён</option></select><button><RefreshCw size={14} /> Обновить</button><button className="primary"><Plus size={14} /> Новая кампания</button></div><div className="ads-empty">Подключите Meta, TikTok или Google Ads, чтобы управлять кампаниями.</div></section>}
    {section === 'forms' && <section className="ads-card"><div className="ads-card-toolbar"><span>Lead-формы: 0</span><button><RefreshCw size={14} /> Синхронизировать</button></div><div className="ads-empty">Формы появятся после подключения рекламного кабинета.</div></section>}
    {section === 'audiences' && <section className="ads-card"><div className="ads-card-toolbar"><select><option>Рекламный кабинет</option></select><div><button disabled>Импортировать</button><button className="primary" onClick={() => setAudienceModal(true)}><Plus size={14} /> Custom из CRM</button><button>Lookalike</button></div></div><div className="ads-empty">Аудиторий пока нет.</div></section>}
    {section === 'creative' && <section className="ads-creative-layout"><form className="ads-generator"><h3><Sparkles size={16} /> AI-генератор креативов</h3><label>Продукт / услуга<input defaultValue="CRM для отдела продаж" /></label><label>Аудитория<input defaultValue="Руководители МСБ, 28–55, KZ" /></label><label>Бриф / оффер<textarea defaultValue="Скидка 20%, бесплатный тест 14 дней…" /></label><div><label>Тон<select><option>Энергичный</option></select></label><label>Язык<select><option>Русский</option></select></label></div><label>Вариантов<input type="number" defaultValue="3" /></label><button><Sparkles size={15} /> Сгенерировать</button></form><section className="ads-card ads-empty">Креативов пока нет — сгенерируйте первую партию.</section></section>}
    {section === 'rpn' && <section><div className="ads-report-controls"><label>С<input type="date" /></label><label>По<input type="date" /></label><button><RefreshCw size={14} /> Обновить</button><button className="primary">Синхронизировать с Meta</button></div><div className="ads-metrics">{['Расход','Лидов в CRM','Продажи','Выручка','ROMI'].map((label) => <article key={label}><span>{label}</span><strong>{label === 'Лидов в CRM' ? selected.leads : label === 'Продажи' ? selected.sales : label === 'Выручка' ? money.format(selected.revenue) : '—'}</strong></article>)}</div><section className="ads-card"><div className="ads-empty">Для отчёта РПН необходимо подключить рекламный кабинет.</div></section></section>}
    {section === 'recommendations' && <section className="ads-card ads-ai"><h3><Bot size={17} /> AI-рекомендации по рекламе</h3><p>После подключения расходов AI сможет сравнить CPL, продажи и ROMI. Сейчас доступны рекомендации только по CRM-конверсии и качеству атрибуции.</p><button><Sparkles size={15} /> Получить рекомендации</button></section>}

    {audienceModal && <div className="ads-modal-backdrop" onMouseDown={() => setAudienceModal(false)}><form className="ads-modal" onMouseDown={(event) => event.stopPropagation()}><h2>Создать Custom Audience из CRM</h2><label>Название<input autoFocus /></label><label>Описание<input /></label><label>Сегмент<select><option>Все лиды</option></select></label><p>Email и телефон должны хешироваться SHA-256 перед отправкой.</p><button type="button" onClick={() => setAudienceModal(false)}>Создать аудиторию</button></form></div>}
  </div>;
}
