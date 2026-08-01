import { useState } from 'react';
import { BarChart3, Bot, BriefcaseBusiness, Facebook, FileText, Globe2, Megaphone, Plus, RefreshCw, Sparkles, Users, Wand2 } from 'lucide-react';

type Network = 'facebook' | 'tiktok' | 'google' | 'yandex' | 'telegram' | 'linkedin';
type Section = 'analytics' | 'campaigns' | 'forms' | 'audiences' | 'creative' | 'rpn' | 'recommendations';

const networks: Array<{ id: Network; label: string }> = [
  { id: 'facebook', label: 'Facebook Ads' },
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

export function AdsWorkspace() {
  const [network, setNetwork] = useState<Network>('facebook');
  const [section, setSection] = useState<Section>('analytics');
  const [audienceModal, setAudienceModal] = useState(false);

  const networkLabel = networks.find((item) => item.id === network)?.label ?? '';
  const connected = network === 'facebook';

  return <div className="ads-workspace">
    <div className="ads-heading"><span><Megaphone size={20} /></span><div><h1>Реклама</h1><p>Аналитика по всем рекламным кабинетам в одном месте</p></div></div>
    <div className="ads-network-tabs">{networks.map((item) => <button key={item.id} className={network === item.id ? 'active' : ''} onClick={() => setNetwork(item.id)}>{item.id === 'facebook' ? <Facebook size={14} /> : item.id === 'google' || item.id === 'yandex' ? <Globe2 size={14} /> : <Megaphone size={14} />}{item.label}</button>)}</div>

    {!connected ? <section className="ads-coming"><span><Wand2 size={24} /></span><h2>{networkLabel}</h2><p>Интеграция в разработке. Мы добавим подключение и аналитику по этому каналу в ближайших обновлениях.</p></section> : <>
      <div className="ads-section-tabs">{sections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}><Icon size={14} />{label}</button>)}</div>
      {section === 'analytics' && <section className="ads-card ads-connect"><h2><Facebook size={18} /> Подключение Facebook Ads</h2><p>Подключение выполняется через Meta Business Manager. После подключения здесь появятся показы, клики, CTR, CPC, CPM, расход и лиды по кампаниям.</p><button>Перейти в Meta Business Manager</button></section>}
      {section === 'campaigns' && <section className="ads-card"><div className="ads-card-toolbar"><select><option>Рекламный кабинет</option></select><button><RefreshCw size={14} /> Обновить</button><button className="primary"><Plus size={14} /> Новая кампания</button></div><div className="ads-empty">Кампании появятся после подключения рекламного кабинета.</div></section>}
      {section === 'forms' && <section className="ads-card"><div className="ads-card-toolbar"><span>Формы Lead Ads: 0</span><button><RefreshCw size={14} /> Синхронизировать</button></div><div className="ads-empty">Форм нет. Нажмите «Синхронизировать».</div></section>}
      {section === 'audiences' && <section className="ads-card"><div className="ads-card-toolbar"><select><option>Рекламный кабинет</option></select><div><button disabled>Импорт из Facebook</button><button className="primary" onClick={() => setAudienceModal(true)}><Plus size={14} /> Custom из CRM</button><button>Lookalike</button></div></div><div className="ads-empty">Аудиторий нет.</div></section>}
      {section === 'creative' && <section className="ads-creative-layout"><form className="ads-generator"><h3><Sparkles size={16} /> AI-генератор креативов</h3><label>Продукт / услуга<input defaultValue="CRM для отдела продаж" /></label><label>Аудитория<input defaultValue="Руководители МСБ, 28–55, KZ" /></label><label>Бриф / оффер<textarea defaultValue="Скидка 20%, бесплатный тест 14 дней…" /></label><div><label>Тон<select><option>Энергичный</option></select></label><label>Язык<select><option>Русский</option></select></label></div><label>Вариантов<input type="number" defaultValue="3" /></label><button><Sparkles size={15} /> Сгенерировать</button></form><section className="ads-card ads-empty">Креативов пока нет — сгенерируйте первую партию.</section></section>}
      {section === 'rpn' && <section><div className="ads-report-controls"><label>С<input type="date" /></label><label>По<input type="date" /></label><button><RefreshCw size={14} /> Обновить</button><button className="primary">Синхронизировать с Facebook</button></div><div className="ads-metrics">{['Расход','Лидов в CRM','Продажи','Выручка','Прибыль (ROMI 0,0%)'].map((label) => <article key={label}><span>{label}</span><strong>0,00</strong></article>)}</div><section className="ads-card"><h3>По кампаниям</h3><div className="ads-table-head"><span>Кампания</span><span>Показы</span><span>Клики</span><span>Расход</span><span>CRM лидов</span><span>Продажи</span><span>ROMI</span></div><div className="ads-empty">Загрузка…</div></section></section>}
      {section === 'recommendations' && <section className="ads-card ads-ai"><h3><Bot size={17} /> AI-рекомендации по рекламе</h3><p>AI проанализирует расход, лиды CRM, продажи и ROMI по кампаниям и даст советы: что масштабировать, что остановить, что оптимизировать.</p><button><Sparkles size={15} /> Получить рекомендации</button></section>}
    </>}

    {audienceModal && <div className="ads-modal-backdrop" onMouseDown={() => setAudienceModal(false)}><form className="ads-modal" onMouseDown={(event) => event.stopPropagation()}><h2>Создать Custom Audience из CRM</h2><label>Название<input autoFocus /></label><label>Описание<input /></label><label>Сегмент (стадия)<select><option>Все лиды</option></select></label><p>Email + телефон хешируются SHA-256 перед отправкой.</p><button type="button" onClick={() => setAudienceModal(false)}>Создать и загрузить</button></form></div>}
  </div>;
}
