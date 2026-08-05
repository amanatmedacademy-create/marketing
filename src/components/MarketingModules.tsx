import { Cable, CheckCircle2, MessageCircle, Phone, Tags, Workflow } from 'lucide-react';

function ModuleHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="heading"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}

const communicationProviders = [
  ['Wazzup', 'WhatsApp, Instagram и другие мессенджеры', MessageCircle, 'Каналы и переписка'],
  ['Binotel', 'Входящие и исходящие звонки, записи разговоров', Phone, 'Телефония'],
  ['Sipuni', 'Виртуальная АТС, статусы звонков и аналитика', Phone, 'Телефония'],
] as const;

export function CommunicationsPage() {
  return <div className="stack">
    <ModuleHeading eyebrow="Omnichannel" title="Коммуникации" text="Все сообщения и звонки привязываются к карточке лида и истории работы отдела продаж." />
    <div className="module-card-grid">{communicationProviders.map(([name, text, Icon, type]) => <article className="module-card" key={name}><div className="module-card__icon"><Icon size={22}/></div><small>{type}</small><h2>{name}</h2><p>{text}</p><button type="button" onClick={() => { window.location.href = '/integrations'; }}>Подключить в интеграциях</button></article>)}</div>
    <section className="panel"><h2>Логика работы</h2><div className="module-checklist"><span><CheckCircle2 size={17}/>Первое сообщение создаёт или находит лида</span><span><CheckCircle2 size={17}/>Звонок и запись разговора сохраняются в карточке</span><span><CheckCircle2 size={17}/>Канал определяет источник и ответственного</span><span><CheckCircle2 size={17}/>История не теряется при смене менеджера</span></div></section>
  </div>;
}

export function AttributionPage() {
  const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'Рекламный кабинет', 'Кампания', 'Группа объявлений', 'Объявление', 'Креатив', 'Первое сообщение', 'Дата первого контакта'];
  return <div className="stack">
    <ModuleHeading eyebrow="First-touch attribution" title="UTM и атрибуция" text="Автоматическое заполнение источника из первого сообщения без последующей перезаписи первичной атрибуции." />
    <section className="panel"><h2>Поля первого касания</h2><div className="attribution-fields">{fields.map((field) => <span key={field}><Tags size={15}/>{field}</span>)}</div></section>
    <section className="panel"><h2>Правило обработки</h2><div className="attribution-flow"><article><b>1</b><strong>Получить первое обращение</strong><p>WhatsApp, звонок, Lead Ads, форма сайта или импорт CRM.</p></article><article><b>2</b><strong>Извлечь метки</strong><p>Из payload, ссылки, текста сообщения или данных рекламной платформы.</p></article><article><b>3</b><strong>Сохранить First Touch</strong><p>Первичные значения блокируются от случайной перезаписи.</p></article><article><b>4</b><strong>Обновлять Last Touch отдельно</strong><p>Повторные касания хранятся в истории, а не заменяют источник.</p></article></div></section>
  </div>;
}

export function MarketingArchitecturePage() {
  const modules = [
    ['Копия Bitrix24: Лиды', 'Карточки, поля, задачи, история и фильтры'],
    ['Wazzup + Binotel + Sipuni', 'Омниканальные сообщения и телефония'],
    ['Meta SDK / n8n → TikTok', 'Рекламные кабинеты и статистика'],
    ['Наша воронка продаж', 'Рабочие стадии отдела продаж'],
    ['Автозаполнение UTM', 'First Touch из первого сообщения'],
    ['Dashboard Marketing', 'Сквозная аналитика, ROMI и конверсии'],
  ];
  return <div className="stack"><ModuleHeading eyebrow="System architecture" title="Архитектура маркетинга" text="Контрольная карта модулей, на которой строится весь проект."/><div className="architecture-map">{modules.map(([title,text],index)=><article key={title}><div><Workflow size={20}/></div><span>1.{index + 1}</span><h2>{title}</h2><p>{text}</p></article>)}</div><section className="panel"><h2>Интеграционный контур</h2><p className="note"><Cable size={16}/> Bitrix24, Wazzup, Binotel, Sipuni, Meta, TikTok и n8n должны передавать данные в единую модель лида, воронки и маркетинговой аналитики.</p></section></div>;
}
