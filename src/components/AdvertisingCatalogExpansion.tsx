import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface CatalogPlatform {
  id: string;
  title: string;
  description: string;
  capabilities: string[];
  tone: string;
  priority: 'Критический' | 'Высокий' | 'Средний';
  logoUrl: string;
  fallback: string;
  connectMethod: string;
}

const svgLogo = (label: string, background: string, foreground = '#ffffff') => `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="${label}">
  <rect width="48" height="48" rx="12" fill="${background}"/>
  <text x="24" y="30" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="800" fill="${foreground}">${label}</text>
</svg>`)} `;

const yandexLogo = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Yandex">
  <rect width="48" height="48" rx="12" fill="#ffffff"/>
  <path d="M27.6 38V25.2L37 8h-7.3l-5.5 11.1L18.8 8H11l9.5 17.4V38h7.1Z" fill="#FF0000"/>
</svg>`)} `;

const brandLogos: Record<string, { url: string; alt: string; method?: string }> = {
  'Meta Ads': { url: 'https://cdn.simpleicons.org/meta/0866FF', alt: 'Meta' },
  'TikTok Ads': { url: 'https://cdn.simpleicons.org/tiktok/FFFFFF', alt: 'TikTok' },
  'Bitrix24': { url: 'https://www.bitrix24.com/favicon.ico', alt: 'Bitrix24', method: 'Входящий webhook / OAuth' },
  'n8n': { url: 'https://cdn.simpleicons.org/n8n/EA4B71', alt: 'n8n' },
};

const advertisingPlatforms: CatalogPlatform[] = [
  { id: 'google', title: 'Google Ads', description: 'Поиск Google, YouTube, КМС и Performance Max для горячего спроса и ретаргетинга.', capabilities: ['Поиск', 'YouTube', 'Performance Max'], tone: 'google', priority: 'Критический', logoUrl: 'https://cdn.simpleicons.org/googleads/4285F4', fallback: 'G', connectMethod: 'OAuth 2.0' },
  { id: 'yandex', title: 'Yandex Direct', description: 'Поиск Яндекса, РСЯ, ретаргетинг, кампании, объявления и расходы.', capabilities: ['Поиск', 'РСЯ', 'Конверсии'], tone: 'yandex', priority: 'Высокий', logoUrl: yandexLogo.trim(), fallback: 'Я', connectMethod: 'OAuth 2.0' },
  { id: 'telegram', title: 'Telegram Ads', description: 'Официальная реклама Telegram, каналы, объявления, показы и переходы.', capabilities: ['Каналы', 'Показы', 'Переходы'], tone: 'telegram', priority: 'Высокий', logoUrl: 'https://cdn.simpleicons.org/telegram/26A5E4', fallback: 'TG', connectMethod: 'API token / MTProto' },
  { id: '2gis', title: '2GIS Ads', description: 'Продвижение карточек компаний, звонки, маршруты, переходы и локальный спрос.', capabilities: ['Карточка компании', 'Звонки', 'Маршруты'], tone: 'twogis', priority: 'Высокий', logoUrl: 'https://2gis.com/favicon.ico', fallback: '2G', connectMethod: 'API / выгрузка отчётов' },
  { id: 'vk', title: 'VK Ads', description: 'Кампании VK, лид-формы, сообщества, клипы и рекламная сеть.', capabilities: ['Лид-формы', 'Сообщества', 'Ретаргетинг'], tone: 'vk', priority: 'Средний', logoUrl: 'https://cdn.simpleicons.org/vk/0077FF', fallback: 'VK', connectMethod: 'OAuth 2.0' },
];

const crmPlatforms: CatalogPlatform[] = [
  { id: 'kommo', title: 'amoCRM / Kommo', description: 'Сделки, контакты, воронки, задачи и история коммуникаций.', capabilities: ['Сделки', 'Контакты', 'Воронки'], tone: 'kommo', priority: 'Критический', logoUrl: 'https://www.kommo.com/favicon.ico', fallback: 'K', connectMethod: 'OAuth 2.0' },
  { id: '1c-crm', title: '1С:CRM', description: 'Клиенты, сделки, счета, товары и обмен с конфигурациями 1С.', capabilities: ['Клиенты', 'Счета', 'Обмен 1С'], tone: 'onec', priority: 'Высокий', logoUrl: 'https://1c.ru/favicon.ico', fallback: '1C', connectMethod: 'OData / HTTP-сервис' },
  { id: 'retailcrm', title: 'RetailCRM', description: 'Заказы, клиенты, товары, доставки и коммуникации e-commerce.', capabilities: ['Заказы', 'Клиенты', 'Товары'], tone: 'retailcrm', priority: 'Высокий', logoUrl: 'https://www.retailcrm.ru/favicon.ico', fallback: 'RC', connectMethod: 'API-ключ' },
  { id: 'megaplan', title: 'Мегаплан', description: 'Продажи, клиенты, задачи, проекты и контроль сотрудников.', capabilities: ['Продажи', 'Задачи', 'Проекты'], tone: 'megaplan', priority: 'Средний', logoUrl: 'https://megaplan.ru/favicon.ico', fallback: 'MP', connectMethod: 'API-токен' },
  { id: 'planfix', title: 'Planfix', description: 'Контакты, задачи, проекты, процессы и пользовательские справочники.', capabilities: ['Контакты', 'Процессы', 'Отчёты'], tone: 'planfix', priority: 'Средний', logoUrl: 'https://planfix.com/favicon.ico', fallback: 'PF', connectMethod: 'REST API token' },
  { id: 'creatio', title: 'Creatio', description: 'CRM и BPM для сложных корпоративных процессов и продаж.', capabilities: ['CRM', 'BPM', 'Корпоративный API'], tone: 'creatio', priority: 'Средний', logoUrl: 'https://www.creatio.com/favicon.ico', fallback: 'CR', connectMethod: 'OAuth 2.0' },
  { id: 'elma365', title: 'ELMA365', description: 'CRM, бизнес-процессы, приложения и корпоративные справочники.', capabilities: ['CRM', 'BPM', 'Приложения'], tone: 'elma', priority: 'Средний', logoUrl: 'https://elma365.com/favicon.ico', fallback: 'E', connectMethod: 'Bearer token / OAuth' },
  { id: 'hubspot', title: 'HubSpot', description: 'Контакты, сделки, компании, маркетинг и сервисные обращения.', capabilities: ['CRM', 'Marketing', 'Service'], tone: 'hubspot', priority: 'Средний', logoUrl: 'https://cdn.simpleicons.org/hubspot/FF7A59', fallback: 'H', connectMethod: 'OAuth 2.0' },
  { id: 'salesforce', title: 'Salesforce', description: 'Корпоративные продажи, клиенты, объекты и аналитика.', capabilities: ['Sales Cloud', 'Objects', 'Reports'], tone: 'salesforce', priority: 'Средний', logoUrl: 'https://cdn.simpleicons.org/salesforce/00A1E0', fallback: 'SF', connectMethod: 'OAuth 2.0' },
  { id: 'bitrix-onpremise', title: 'Bitrix24 On-Premise', description: 'Коробочная версия Bitrix24 в локальной инфраструктуре компании.', capabilities: ['Локальный REST', 'CRM', 'Webhooks'], tone: 'bitrix', priority: 'Высокий', logoUrl: 'https://www.bitrix24.com/favicon.ico', fallback: '24', connectMethod: 'REST webhook / OAuth' },
];

const telephonyPlatforms: CatalogPlatform[] = [
  { id: 'zadarma', title: 'Zadarma', description: 'Облачная АТС, номера, звонки, записи, события и статистика.', capabilities: ['Виртуальная АТС', 'Записи', 'Webhooks'], tone: 'zadarma', priority: 'Критический', logoUrl: 'https://zadarma.com/favicon.ico', fallback: 'Z', connectMethod: 'API key + secret' },
  { id: 'asterisk', title: 'Asterisk', description: 'Локальная IP-АТС с полным контролем звонков, событий и записей.', capabilities: ['AMI', 'ARI', 'CDR'], tone: 'asterisk', priority: 'Критический', logoUrl: 'https://cdn.simpleicons.org/asterisk/F68F1E', fallback: 'A', connectMethod: 'AMI / ARI' },
  { id: 'freepbx', title: 'FreePBX', description: 'Управление Asterisk, SIP-транки, маршрутизация и записи звонков.', capabilities: ['Asterisk', 'SIP', 'CDR'], tone: 'freepbx', priority: 'Высокий', logoUrl: 'https://www.freepbx.org/favicon.ico', fallback: 'FP', connectMethod: 'AMI / CDR' },
  { id: 'onlinepbx', title: 'OnlinePBX', description: 'Облачная АТС, звонки, записи и события для CRM.', capabilities: ['АТС', 'Записи', 'Webhooks'], tone: 'onlinepbx', priority: 'Высокий', logoUrl: 'https://onlinepbx.ru/favicon.ico', fallback: 'OP', connectMethod: 'API token + webhook' },
  { id: 'uis', title: 'UIS / CoMagic', description: 'Телефония, коллтрекинг, обращения и сквозная аналитика.', capabilities: ['Телефония', 'Коллтрекинг', 'Аналитика'], tone: 'uis', priority: 'Высокий', logoUrl: 'https://www.uiscom.ru/favicon.ico', fallback: 'UIS', connectMethod: 'API key + webhook' },
  { id: 'novofon', title: 'Novofon', description: 'Виртуальная АТС, номера, записи и интеграции с CRM.', capabilities: ['АТС', 'Номера', 'Записи'], tone: 'novofon', priority: 'Высокий', logoUrl: 'https://novofon.com/favicon.ico', fallback: 'N', connectMethod: 'API key + webhook' },
  { id: 'sipuni', title: 'Sipuni', description: 'Виртуальная АТС, статистика, записи и события звонков.', capabilities: ['АТС', 'Статистика', 'Записи'], tone: 'sipuni', priority: 'Высокий', logoUrl: 'https://sipuni.com/favicon.ico', fallback: 'S', connectMethod: 'API key' },
  { id: 'mango', title: 'MANGO OFFICE', description: 'Виртуальная АТС, контакт-центр, записи и коллтрекинг.', capabilities: ['АТС', 'Контакт-центр', 'Коллтрекинг'], tone: 'mango', priority: 'Средний', logoUrl: 'https://www.mango-office.ru/favicon.ico', fallback: 'MO', connectMethod: 'API key + webhook' },
  { id: 'binotel', title: 'Binotel', description: 'Виртуальная АТС, звонки, записи и коллтрекинг.', capabilities: ['АТС', 'Записи', 'Коллтрекинг'], tone: 'binotel', priority: 'Средний', logoUrl: 'https://www.binotel.com/favicon.ico', fallback: 'B', connectMethod: 'API key + secret' },
  { id: 'telphin', title: 'Телфин', description: 'Виртуальная АТС, номера, звонки и записи разговоров.', capabilities: ['АТС', 'Номера', 'Записи'], tone: 'telphin', priority: 'Средний', logoUrl: 'https://www.telphin.ru/favicon.ico', fallback: 'T', connectMethod: 'OAuth 2.0 / API' },
  { id: 'voximplant', title: 'Voximplant', description: 'Программируемые звонки, контакт-центр, SIP и сценарии.', capabilities: ['Voice API', 'SIP', 'Сценарии'], tone: 'voximplant', priority: 'Высокий', logoUrl: 'https://voximplant.com/favicon.ico', fallback: 'V', connectMethod: 'Service account + JWT' },
  { id: 'infobip', title: 'Infobip', description: 'Омниканальные коммуникации, голос, SMS и мессенджеры.', capabilities: ['Voice', 'SMS', 'Omnichannel'], tone: 'infobip', priority: 'Высокий', logoUrl: 'https://www.infobip.com/favicon.ico', fallback: 'I', connectMethod: 'API key' },
  { id: 'kazakhtelecom', title: 'Казахтелеком SIP', description: 'Корпоративные SIP-линии и подключение локальной или облачной АТС.', capabilities: ['SIP trunk', 'Входящие', 'Исходящие'], tone: 'kazakhtelecom', priority: 'Высокий', logoUrl: 'https://telecom.kz/favicon.ico', fallback: 'KT', connectMethod: 'SIP credentials' },
  { id: 'beeline-business', title: 'Beeline Business SIP', description: 'Корпоративная телефония и SIP-подключение для бизнеса.', capabilities: ['SIP trunk', 'Номера', 'Маршрутизация'], tone: 'beeline', priority: 'Высокий', logoUrl: 'https://cdn.simpleicons.org/beeline/FFC800', fallback: 'B', connectMethod: 'SIP credentials' },
  { id: 'kcell-business', title: 'Kcell Business SIP', description: 'Корпоративная мобильная и SIP-телефония для компаний.', capabilities: ['SIP', 'Мобильная связь', 'Номера'], tone: 'kcell', priority: 'Средний', logoUrl: 'https://www.kcell.kz/favicon.ico', fallback: 'K', connectMethod: 'SIP / ручная настройка' },
];

function addMethodPill(card: HTMLElement, method: string) {
  if (card.querySelector('.integration-connect-method')) return;
  const button = card.querySelector(':scope > button');
  if (!button) return;
  const pill = document.createElement('div');
  pill.className = 'integration-connect-method';
  pill.innerHTML = `<span>Быстрое подключение</span><strong>${method}</strong>`;
  card.insertBefore(pill, button);
}

function applyExistingBrandLogos() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.integration-catalog-card'));
  for (const card of cards) {
    const title = card.querySelector(':scope > strong')?.textContent?.trim();
    if (!title || !brandLogos[title]) continue;
    const brand = brandLogos[title];
    const logo = card.querySelector<HTMLElement>('.integration-card-logo');
    if (logo && logo.dataset.brandLogo !== 'true') {
      logo.textContent = '';
      const image = document.createElement('img');
      image.src = brand.url;
      image.alt = brand.alt;
      image.loading = 'eager';
      image.decoding = 'async';
      logo.appendChild(image);
      logo.dataset.brandLogo = 'true';
    }
    if (brand.method) addMethodPill(card, brand.method);
  }
}

function ensureTelephonySection(page: Element, automationSection?: Element) {
  let section = page.querySelector<HTMLElement>('[data-catalog-section="telephony"]');
  if (section) return section.querySelector('.integration-catalog-grid');
  section = document.createElement('section');
  section.className = 'integration-catalog-section';
  section.dataset.catalogSection = 'telephony';
  section.innerHTML = '<div class="connections-section__head"><div><h2>Телефония</h2><p>Облачные и локальные АТС, SIP, звонки, записи и коллтрекинг</p></div></div><div class="integration-catalog-grid"></div>';
  if (automationSection) page.insertBefore(section, automationSection);
  else page.appendChild(section);
  return section.querySelector('.integration-catalog-grid');
}

function BrandLogo({ src, title, fallback }: { src: string; title: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="integration-card-logo" data-brand-logo="true">
    {failed ? <img src={svgLogo(fallback, '#14213d').trim()} alt={title}/> : <img src={src} alt={title} loading="eager" decoding="async" onError={() => setFailed(true)}/>} 
  </span>;
}

function PlatformCard({ platform }: { platform: CatalogPlatform }) {
  return <article className={`integration-catalog-card integration-tone-${platform.tone} integration-state-planned integration-platform-card`} data-platform={platform.id}>
    <div className="integration-card-top"><BrandLogo src={platform.logoUrl} title={platform.title} fallback={platform.fallback}/><em>Скоро</em></div>
    <div className="integration-platform-heading"><strong>{platform.title}</strong><span>{platform.priority}</span></div>
    <p>{platform.description}</p>
    <div className="integration-card-tags">{platform.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
    <div className="integration-connect-method"><span>Быстрое подключение</span><strong>{platform.connectMethod}</strong></div>
    <button type="button" disabled title="Серверная интеграция будет добавлена следующим этапом">Подключение готовится</button>
  </article>;
}

export default function AdvertisingCatalogExpansion() {
  const [advertisingTarget, setAdvertisingTarget] = useState<Element | null>(null);
  const [crmTarget, setCrmTarget] = useState<Element | null>(null);
  const [telephonyTarget, setTelephonyTarget] = useState<Element | null>(null);

  useEffect(() => {
    const locate = () => {
      if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;
      const page = document.querySelector('.connections-page');
      if (!page) return;
      const sections = Array.from(page.querySelectorAll('.integration-catalog-section'));
      const byTitle = (title: string) => sections.find((section) => section.querySelector('h2')?.textContent?.trim() === title);
      const advertising = byTitle('Рекламные кабинеты')?.querySelector('.integration-catalog-grid') || null;
      const crm = byTitle('CRM')?.querySelector('.integration-catalog-grid') || null;
      const telephony = ensureTelephonySection(page, byTitle('Автоматизация и API')) || null;
      setAdvertisingTarget((previous) => previous === advertising ? previous : advertising);
      setCrmTarget((previous) => previous === crm ? previous : crm);
      setTelephonyTarget((previous) => previous === telephony ? previous : telephony);
      applyExistingBrandLogos();
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return null;

  return <>
    {advertisingTarget && createPortal(advertisingPlatforms.map((platform) => <PlatformCard platform={platform} key={platform.id}/>), advertisingTarget)}
    {crmTarget && createPortal(crmPlatforms.map((platform) => <PlatformCard platform={platform} key={platform.id}/>), crmTarget)}
    {telephonyTarget && createPortal(telephonyPlatforms.map((platform) => <PlatformCard platform={platform} key={platform.id}/>), telephonyTarget)}
  </>;
}
