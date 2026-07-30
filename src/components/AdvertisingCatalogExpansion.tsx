import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Priority = 'Критический' | 'Высокий' | 'Средний';
interface CatalogPlatform {
  id: string;
  title: string;
  description: string;
  capabilities: string[];
  tone: string;
  priority: Priority;
  logoUrl: string;
  fallback: string;
  connectMethod: string;
}

const svgLogo = (label: string, background = '#14213d') => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="${background}"/><text x="24" y="30" text-anchor="middle" font-family="Arial" font-size="17" font-weight="800" fill="#fff">${label}</text></svg>`)}`;
const yandexLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#fff"/><path d="M27.6 38V25.2L37 8h-7.3l-5.5 11.1L18.8 8H11l9.5 17.4V38h7.1Z" fill="#f00"/></svg>')}`;

const advertising: CatalogPlatform[] = [
  { id:'google', title:'Google Ads', description:'Поиск Google, YouTube, КМС и Performance Max.', capabilities:['Поиск','YouTube','PMax'], tone:'google', priority:'Критический', logoUrl:'https://cdn.simpleicons.org/googleads/4285F4', fallback:'G', connectMethod:'OAuth 2.0' },
  { id:'yandex', title:'Yandex Direct', description:'Поиск Яндекса, РСЯ, ретаргетинг и расходы.', capabilities:['Поиск','РСЯ','Конверсии'], tone:'yandex', priority:'Высокий', logoUrl:yandexLogo, fallback:'Я', connectMethod:'OAuth 2.0' },
  { id:'telegram', title:'Telegram Ads', description:'Официальная реклама Telegram и статистика.', capabilities:['Каналы','Показы','Переходы'], tone:'telegram', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/telegram/26A5E4', fallback:'TG', connectMethod:'API token / MTProto' },
  { id:'2gis', title:'2GIS Ads', description:'Продвижение карточек компаний и локальный спрос.', capabilities:['Карточка','Звонки','Маршруты'], tone:'twogis', priority:'Высокий', logoUrl:'https://2gis.com/favicon.ico', fallback:'2G', connectMethod:'API / отчёты' },
  { id:'vk', title:'VK Ads', description:'Кампании, лид-формы, сообщества и ретаргетинг.', capabilities:['Лид-формы','Сообщества','Ретаргетинг'], tone:'vk', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/vk/0077FF', fallback:'VK', connectMethod:'OAuth 2.0' },
  { id:'microsoft-ads', title:'Microsoft Advertising', description:'Поиск Bing, Microsoft Audience Network и товарные кампании.', capabilities:['Bing Search','Audience','Shopping'], tone:'microsoft', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/microsoft/5E5E5E', fallback:'MS', connectMethod:'OAuth 2.0' },
  { id:'linkedin-ads', title:'LinkedIn Ads', description:'B2B-реклама, лид-формы, аудитории и продвижение контента.', capabilities:['B2B','Lead Gen','Audiences'], tone:'linkedin', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/linkedin/0A66C2', fallback:'IN', connectMethod:'OAuth 2.0' },
  { id:'snapchat-ads', title:'Snapchat Ads', description:'Вертикальные видео, AR-реклама, аудитории и события конверсий.', capabilities:['Video','AR','Conversions'], tone:'snapchat', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/snapchat/FFFC00', fallback:'SC', connectMethod:'OAuth 2.0' },
  { id:'pinterest-ads', title:'Pinterest Ads', description:'Продвижение пинов, каталоги, shopping и аудитории интересов.', capabilities:['Pins','Catalogs','Shopping'], tone:'pinterest', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/pinterest/E60023', fallback:'P', connectMethod:'OAuth 2.0' },
  { id:'x-ads', title:'X Ads', description:'Продвижение публикаций, видео, приложений и аудитории X.', capabilities:['Posts','Video','Audiences'], tone:'xads', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/x/FFFFFF', fallback:'X', connectMethod:'OAuth 2.0' },
  { id:'apple-search-ads', title:'Apple Search Ads', description:'Реклама приложений в App Store, ключевые слова и атрибуция.', capabilities:['App Store','Keywords','Attribution'], tone:'apple', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/apple/FFFFFF', fallback:'AS', connectMethod:'OAuth 2.0 / JWT' },
  { id:'amazon-ads', title:'Amazon Ads', description:'Sponsored Products, Display, DSP и рекламная аналитика Amazon.', capabilities:['Sponsored','Display','DSP'], tone:'amazon', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/amazon/FF9900', fallback:'AM', connectMethod:'OAuth 2.0' },
  { id:'reddit-ads', title:'Reddit Ads', description:'Реклама в сообществах, интересы, пиксель и конверсии.', capabilities:['Communities','Pixel','Conversions'], tone:'reddit', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/reddit/FF4500', fallback:'R', connectMethod:'OAuth 2.0' },
  { id:'dv360', title:'Display & Video 360', description:'Программатик-реклама, медийные кампании, видео и аудитории.', capabilities:['Programmatic','Display','Video'], tone:'dv360', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/googlemarketingplatform/4285F4', fallback:'DV', connectMethod:'Google OAuth 2.0' },
];

const crm: CatalogPlatform[] = [
  { id:'kommo', title:'amoCRM / Kommo', description:'Сделки, контакты, воронки и коммуникации.', capabilities:['Сделки','Контакты','Воронки'], tone:'kommo', priority:'Критический', logoUrl:'https://www.kommo.com/favicon.ico', fallback:'K', connectMethod:'OAuth 2.0' },
  { id:'1c-crm', title:'1С:CRM', description:'Клиенты, сделки, счета и обмен с 1С.', capabilities:['Клиенты','Счета','1С'], tone:'onec', priority:'Высокий', logoUrl:'https://1c.ru/favicon.ico', fallback:'1C', connectMethod:'OData / HTTP' },
  { id:'retailcrm', title:'RetailCRM', description:'Заказы, клиенты, товары и доставки.', capabilities:['Заказы','Клиенты','Товары'], tone:'retailcrm', priority:'Высокий', logoUrl:'https://www.retailcrm.ru/favicon.ico', fallback:'RC', connectMethod:'API-ключ' },
  { id:'megaplan', title:'Мегаплан', description:'Продажи, задачи, проекты и сотрудники.', capabilities:['Продажи','Задачи','Проекты'], tone:'megaplan', priority:'Средний', logoUrl:'https://megaplan.ru/favicon.ico', fallback:'MP', connectMethod:'API-токен' },
  { id:'planfix', title:'Planfix', description:'Контакты, процессы, задачи и отчёты.', capabilities:['Контакты','Процессы','Отчёты'], tone:'planfix', priority:'Средний', logoUrl:'https://planfix.com/favicon.ico', fallback:'PF', connectMethod:'REST API token' },
  { id:'creatio', title:'Creatio', description:'CRM и BPM для корпоративных процессов.', capabilities:['CRM','BPM','API'], tone:'creatio', priority:'Средний', logoUrl:'https://www.creatio.com/favicon.ico', fallback:'CR', connectMethod:'OAuth 2.0' },
  { id:'elma365', title:'ELMA365', description:'CRM, процессы и корпоративные приложения.', capabilities:['CRM','BPM','Приложения'], tone:'elma', priority:'Средний', logoUrl:'https://elma365.com/favicon.ico', fallback:'E', connectMethod:'Bearer token / OAuth' },
  { id:'hubspot', title:'HubSpot', description:'CRM, маркетинг и сервисные обращения.', capabilities:['CRM','Marketing','Service'], tone:'hubspot', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/hubspot/FF7A59', fallback:'H', connectMethod:'OAuth 2.0' },
  { id:'salesforce', title:'Salesforce', description:'Корпоративные продажи, объекты и аналитика.', capabilities:['Sales Cloud','Objects','Reports'], tone:'salesforce', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/salesforce/00A1E0', fallback:'SF', connectMethod:'OAuth 2.0' },
  { id:'bitrix-onpremise', title:'Bitrix24 On-Premise', description:'Коробочная версия Bitrix24 в локальной инфраструктуре.', capabilities:['REST','CRM','Webhooks'], tone:'bitrix', priority:'Высокий', logoUrl:'https://www.bitrix24.com/favicon.ico', fallback:'24', connectMethod:'REST webhook / OAuth' },
  { id:'zoho-crm', title:'Zoho CRM', description:'Лиды, сделки, контакты, автоматизация продаж и аналитика.', capabilities:['Leads','Deals','Automation'], tone:'zoho', priority:'Высокий', logoUrl:'https://www.zoho.com/favicon.ico', fallback:'Z', connectMethod:'OAuth 2.0' },
  { id:'pipedrive', title:'Pipedrive', description:'Воронки продаж, сделки, активности и прогнозирование.', capabilities:['Pipeline','Deals','Activities'], tone:'pipedrive', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/pipedrive/017737', fallback:'PD', connectMethod:'OAuth 2.0 / API token' },
  { id:'dynamics365', title:'Microsoft Dynamics 365', description:'Корпоративные продажи, маркетинг, сервис и Dataverse.', capabilities:['Sales','Dataverse','Service'], tone:'dynamics', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/dynamics365/0B53CE', fallback:'D365', connectMethod:'Microsoft OAuth 2.0' },
  { id:'odoo-crm', title:'Odoo CRM', description:'CRM, продажи, счета, задачи и связка с ERP-модулями.', capabilities:['CRM','Sales','ERP'], tone:'odoo', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/odoo/714B67', fallback:'O', connectMethod:'API key / XML-RPC' },
  { id:'freshsales', title:'Freshsales', description:'Лиды, сделки, email, телефония и автоматизация продаж.', capabilities:['Leads','Email','Automation'], tone:'freshsales', priority:'Средний', logoUrl:'https://www.freshworks.com/favicon.ico', fallback:'FS', connectMethod:'API key / OAuth 2.0' },
  { id:'monday-crm', title:'monday Sales CRM', description:'Гибкие воронки, контакты, активности и автоматизации.', capabilities:['Boards','Contacts','Automation'], tone:'monday', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/mondaydotcom/FF3D57', fallback:'M', connectMethod:'OAuth 2.0 / API token' },
  { id:'sap-sales-cloud', title:'SAP Sales Cloud', description:'Корпоративные продажи, клиенты, прогнозы и интеграция с SAP.', capabilities:['Enterprise','Forecast','SAP'], tone:'sap', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/sap/0FAAFF', fallback:'SAP', connectMethod:'OAuth 2.0 / OData' },
  { id:'oracle-sales', title:'Oracle Sales', description:'Корпоративные клиенты, возможности, продажи и аналитика.', capabilities:['Accounts','Opportunities','Analytics'], tone:'oracle', priority:'Средний', logoUrl:'https://cdn.simpleicons.org/oracle/F80000', fallback:'OR', connectMethod:'OAuth 2.0 / REST' },
  { id:'sugarcrm', title:'SugarCRM', description:'Продажи, сервис, маркетинг и пользовательские модули.', capabilities:['Sales','Service','Modules'], tone:'sugar', priority:'Средний', logoUrl:'https://www.sugarcrm.com/favicon.ico', fallback:'SU', connectMethod:'OAuth 2.0 / REST' },
  { id:'insightly', title:'Insightly', description:'CRM, проекты, контакты, сделки и workflow-автоматизация.', capabilities:['CRM','Projects','Workflow'], tone:'insightly', priority:'Средний', logoUrl:'https://www.insightly.com/favicon.ico', fallback:'I', connectMethod:'API key / OAuth 2.0' },
];

const communications: CatalogPlatform[] = [
  { id:'whatsapp-cloud', title:'WhatsApp Business Cloud API', description:'Сообщения, шаблоны, медиа и статусы доставки WhatsApp.', capabilities:['Сообщения','Шаблоны','Webhooks'], tone:'whatsapp', priority:'Критический', logoUrl:'https://cdn.simpleicons.org/whatsapp/25D366', fallback:'WA', connectMethod:'Meta OAuth + access token' },
  { id:'telegram-bot', title:'Telegram Bot API', description:'Боты, уведомления, команды и автоматические ответы.', capabilities:['Боты','Сообщения','Webhook'], tone:'telegram', priority:'Критический', logoUrl:'https://cdn.simpleicons.org/telegram/26A5E4', fallback:'TB', connectMethod:'Bot token + webhook' },
  { id:'wazzup', title:'Wazzup', description:'WhatsApp и Telegram для CRM и отделов продаж.', capabilities:['WhatsApp','Telegram','CRM'], tone:'wazzup', priority:'Высокий', logoUrl:'https://wazzup24.com/favicon.ico', fallback:'W', connectMethod:'API key + webhook' },
  { id:'chat2desk', title:'Chat2Desk', description:'Единое окно для WhatsApp, Telegram и операторов.', capabilities:['Омниканал','Операторы','Webhooks'], tone:'chat2desk', priority:'Высокий', logoUrl:'https://chat2desk.com/favicon.ico', fallback:'C2', connectMethod:'API token + webhook' },
  { id:'sendpulse', title:'SendPulse', description:'Чат-боты, WhatsApp, email, SMS и автоматические цепочки.', capabilities:['Чат-боты','Email','SMS'], tone:'sendpulse', priority:'Высокий', logoUrl:'https://sendpulse.com/favicon.ico', fallback:'SP', connectMethod:'OAuth 2.0 / API credentials' },
  { id:'zadarma', title:'Zadarma', description:'Облачная АТС, номера, записи и события.', capabilities:['АТС','Записи','Webhooks'], tone:'zadarma', priority:'Критический', logoUrl:'https://zadarma.com/favicon.ico', fallback:'Z', connectMethod:'API key + secret' },
  { id:'asterisk', title:'Asterisk', description:'Локальная IP-АТС с полным контролем звонков.', capabilities:['AMI','ARI','CDR'], tone:'asterisk', priority:'Критический', logoUrl:'https://cdn.simpleicons.org/asterisk/F68F1E', fallback:'A', connectMethod:'AMI / ARI' },
  { id:'freepbx', title:'FreePBX', description:'Управление Asterisk, SIP и маршрутизация.', capabilities:['Asterisk','SIP','CDR'], tone:'freepbx', priority:'Высокий', logoUrl:'https://www.freepbx.org/favicon.ico', fallback:'FP', connectMethod:'AMI / CDR' },
  { id:'onlinepbx', title:'OnlinePBX', description:'Облачная АТС, звонки, записи и события.', capabilities:['АТС','Записи','Webhooks'], tone:'onlinepbx', priority:'Высокий', logoUrl:'https://onlinepbx.ru/favicon.ico', fallback:'OP', connectMethod:'API token + webhook' },
  { id:'uis', title:'UIS / CoMagic', description:'Телефония, коллтрекинг и аналитика.', capabilities:['Телефония','Коллтрекинг','Аналитика'], tone:'uis', priority:'Высокий', logoUrl:'https://www.uiscom.ru/favicon.ico', fallback:'UIS', connectMethod:'API key + webhook' },
  { id:'novofon', title:'Novofon', description:'Виртуальная АТС, номера и записи.', capabilities:['АТС','Номера','Записи'], tone:'novofon', priority:'Высокий', logoUrl:'https://novofon.com/favicon.ico', fallback:'N', connectMethod:'API key + webhook' },
  { id:'sipuni', title:'Sipuni', description:'Виртуальная АТС, статистика и записи.', capabilities:['АТС','Статистика','Записи'], tone:'sipuni', priority:'Высокий', logoUrl:'https://sipuni.com/favicon.ico', fallback:'S', connectMethod:'API key' },
  { id:'mango', title:'MANGO OFFICE', description:'АТС, контакт-центр и коллтрекинг.', capabilities:['АТС','Контакт-центр','Коллтрекинг'], tone:'mango', priority:'Средний', logoUrl:'https://www.mango-office.ru/favicon.ico', fallback:'MO', connectMethod:'API key + webhook' },
  { id:'binotel', title:'Binotel', description:'Виртуальная АТС и коллтрекинг.', capabilities:['АТС','Записи','Коллтрекинг'], tone:'binotel', priority:'Средний', logoUrl:'https://www.binotel.com/favicon.ico', fallback:'B', connectMethod:'API key + secret' },
  { id:'telphin', title:'Телфин', description:'Виртуальная АТС, номера и записи.', capabilities:['АТС','Номера','Записи'], tone:'telphin', priority:'Средний', logoUrl:'https://www.telphin.ru/favicon.ico', fallback:'T', connectMethod:'OAuth 2.0 / API' },
  { id:'voximplant', title:'Voximplant', description:'Программируемые звонки, SIP и сценарии.', capabilities:['Voice API','SIP','Сценарии'], tone:'voximplant', priority:'Высокий', logoUrl:'https://voximplant.com/favicon.ico', fallback:'V', connectMethod:'Service account + JWT' },
  { id:'infobip', title:'Infobip', description:'Голос, SMS и омниканальные коммуникации.', capabilities:['Voice','SMS','Omnichannel'], tone:'infobip', priority:'Высокий', logoUrl:'https://www.infobip.com/favicon.ico', fallback:'I', connectMethod:'API key' },
  { id:'kazakhtelecom', title:'Казахтелеком SIP', description:'Корпоративные SIP-линии для АТС.', capabilities:['SIP trunk','Входящие','Исходящие'], tone:'kazakhtelecom', priority:'Высокий', logoUrl:'https://telecom.kz/favicon.ico', fallback:'KT', connectMethod:'SIP credentials' },
  { id:'beeline-business', title:'Beeline Business SIP', description:'Корпоративная SIP-телефония.', capabilities:['SIP trunk','Номера','Маршрутизация'], tone:'beeline', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/beeline/FFC800', fallback:'B', connectMethod:'SIP credentials' },
  { id:'kcell-business', title:'Kcell Business SIP', description:'Корпоративная мобильная и SIP-телефония.', capabilities:['SIP','Мобильная связь','Номера'], tone:'kcell', priority:'Средний', logoUrl:'https://www.kcell.kz/favicon.ico', fallback:'K', connectMethod:'SIP / ручная настройка' },
];

const automation: CatalogPlatform[] = [
  { id:'albato', title:'Albato', description:'No-code интеграции и встроенный конструктор автоматизаций.', capabilities:['Embedded','Apps','Webhooks'], tone:'albato', priority:'Высокий', logoUrl:'https://albato.com/favicon.ico', fallback:'A', connectMethod:'OAuth 2.0 / API token' },
  { id:'apix-drive', title:'ApiX-Drive', description:'Связка CRM, рекламы, мессенджеров и таблиц без кода.', capabilities:['No-code','Коннекторы','Сценарии'], tone:'apix', priority:'Высокий', logoUrl:'https://apix-drive.com/favicon.ico', fallback:'AX', connectMethod:'API / готовый коннектор' },
  { id:'make', title:'Make', description:'Визуальные сценарии, webhooks и тысячи готовых приложений.', capabilities:['Сценарии','Webhooks','Apps'], tone:'make', priority:'Высокий', logoUrl:'https://cdn.simpleicons.org/make/6D00CC', fallback:'M', connectMethod:'OAuth 2.0 / API token' },
  { id:'google-sheets', title:'Google Sheets', description:'Чтение, запись и синхронизация таблиц и диапазонов.', capabilities:['Таблицы','Импорт','Экспорт'], tone:'sheets', priority:'Критический', logoUrl:'https://cdn.simpleicons.org/googlesheets/34A853', fallback:'GS', connectMethod:'Google OAuth 2.0' },
  { id:'webhooks', title:'Webhooks', description:'Универсальный приём и отправка событий между системами.', capabilities:['Incoming','Outgoing','JSON'], tone:'webhooks', priority:'Критический', logoUrl:'https://cdn.simpleicons.org/webhook/2088FF', fallback:'WH', connectMethod:'URL + shared secret' },
];

function BrandLogo({ platform }: { platform: CatalogPlatform }) {
  const [failed, setFailed] = useState(false);
  return <span className="integration-card-logo" data-brand-logo="true"><img src={failed ? svgLogo(platform.fallback) : platform.logoUrl} alt={platform.title} onError={() => setFailed(true)} /></span>;
}

function PlatformCard({ platform }: { platform: CatalogPlatform }) {
  return <article className={`integration-catalog-card integration-tone-${platform.tone} integration-state-planned integration-platform-card`} data-platform={platform.id}>
    <div className="integration-card-top"><BrandLogo platform={platform}/><em>Скоро</em></div>
    <div className="integration-platform-heading"><strong>{platform.title}</strong><span>{platform.priority}</span></div>
    <p>{platform.description}</p>
    <div className="integration-card-tags">{platform.capabilities.map((item) => <span key={item}>{item}</span>)}</div>
    <div className="integration-connect-method"><span>Быстрое подключение</span><strong>{platform.connectMethod}</strong></div>
    <button type="button" disabled>Подключение готовится</button>
  </article>;
}

function CatalogSection({ title, description, platforms, sectionId }: { title: string; description: string; platforms: CatalogPlatform[]; sectionId: string }) {
  return <section className="integration-catalog-section" data-catalog-expanded="true" data-catalog-section={sectionId}>
    <div className="connections-section__head"><div><h2>{title}</h2><p>{description}</p></div></div>
    <div className="integration-catalog-grid">{platforms.map((item) => <PlatformCard key={item.id} platform={item}/>)}</div>
  </section>;
}

export default function AdvertisingCatalogExpansion() {
  const [page, setPage] = useState<Element | null>(null);

  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;
    let attempts = 0;
    let timer: number | undefined;
    const locate = () => {
      const target = document.querySelector('.connections-page');
      if (target) setPage(target);
      else if (attempts++ < 40) timer = window.setTimeout(locate, 100);
    };
    locate();
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, []);

  if (!page || window.location.pathname.replace(/\/+$/, '') !== '/integrations') return null;

  return createPortal(<>
    <CatalogSection title="Рекламные кабинеты" description="Расходы, кампании, объявления, лиды и сквозная аналитика" platforms={advertising} sectionId="advertising"/>
    <CatalogSection title="CRM" description="Лиды, контакты, сделки, визиты и оплаты" platforms={crm} sectionId="crm"/>
    <CatalogSection title="Коммуникации и телефония" description="Мессенджеры, облачные и локальные АТС, SIP, записи и коллтрекинг" platforms={communications} sectionId="telephony"/>
    <CatalogSection title="Автоматизация и API" description="No-code платформы, таблицы, webhooks и обмен данными" platforms={automation} sectionId="automation"/>
  </>, page);
}
