import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PlannedPlatform {
  id: string;
  title: string;
  description: string;
  capabilities: string[];
  tone: string;
  priority: 'Критический' | 'Высокий' | 'Средний';
  logoUrl: string;
}

const brandLogos: Record<string, { url: string; alt: string }> = {
  'Meta Ads': { url: 'https://cdn.simpleicons.org/meta/0866FF', alt: 'Meta' },
  'TikTok Ads': { url: 'https://cdn.simpleicons.org/tiktok/FFFFFF', alt: 'TikTok' },
  'Bitrix24': { url: 'https://www.bitrix24.com/favicon.ico', alt: 'Bitrix24' },
  'n8n': { url: 'https://cdn.simpleicons.org/n8n/EA4B71', alt: 'n8n' },
};

const platforms: PlannedPlatform[] = [
  {
    id: 'google',
    title: 'Google Ads',
    description: 'Поиск Google, YouTube, КМС и Performance Max для горячего спроса и ретаргетинга.',
    capabilities: ['Поиск', 'YouTube', 'Performance Max'],
    tone: 'google',
    priority: 'Критический',
    logoUrl: 'https://cdn.simpleicons.org/googleads/4285F4',
  },
  {
    id: 'yandex',
    title: 'Yandex Direct',
    description: 'Поиск Яндекса, РСЯ, ретаргетинг, кампании, объявления и расходы.',
    capabilities: ['Поиск', 'РСЯ', 'Конверсии'],
    tone: 'yandex',
    priority: 'Высокий',
    logoUrl: 'https://yastatic.net/s3/home-static/_/i/favicon-32x32.png',
  },
  {
    id: 'telegram',
    title: 'Telegram Ads',
    description: 'Официальная реклама Telegram, каналы, объявления, показы и переходы.',
    capabilities: ['Каналы', 'Показы', 'Переходы'],
    tone: 'telegram',
    priority: 'Высокий',
    logoUrl: 'https://cdn.simpleicons.org/telegram/26A5E4',
  },
  {
    id: '2gis',
    title: '2GIS Ads',
    description: 'Продвижение карточек компаний, звонки, маршруты, переходы и локальный спрос.',
    capabilities: ['Карточка компании', 'Звонки', 'Маршруты'],
    tone: 'twogis',
    priority: 'Высокий',
    logoUrl: 'https://2gis.com/favicon.ico',
  },
  {
    id: 'vk',
    title: 'VK Ads',
    description: 'Кампании VK, лид-формы, сообщества, клипы и рекламная сеть.',
    capabilities: ['Лид-формы', 'Сообщества', 'Ретаргетинг'],
    tone: 'vk',
    priority: 'Средний',
    logoUrl: 'https://cdn.simpleicons.org/vk/0077FF',
  },
];

function applyExistingBrandLogos() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.integration-catalog-card'));
  for (const card of cards) {
    const title = card.querySelector(':scope > strong')?.textContent?.trim();
    if (!title || !brandLogos[title]) continue;
    const logo = card.querySelector<HTMLElement>('.integration-card-logo');
    if (!logo || logo.dataset.brandLogo === 'true') continue;
    const brand = brandLogos[title];
    logo.textContent = '';
    const image = document.createElement('img');
    image.src = brand.url;
    image.alt = brand.alt;
    image.loading = 'eager';
    image.decoding = 'async';
    logo.appendChild(image);
    logo.dataset.brandLogo = 'true';
  }
}

export default function AdvertisingCatalogExpansion() {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const locate = () => {
      const sections = Array.from(document.querySelectorAll('.integration-catalog-section'));
      const advertisingSection = sections.find((section) => section.querySelector('h2')?.textContent?.trim() === 'Рекламные кабинеты');
      setTarget(advertisingSection?.querySelector('.integration-catalog-grid') || null);
      applyExistingBrandLogos();
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target || window.location.pathname.replace(/\/+$/, '') !== '/integrations') return null;

  return createPortal(<>
    {platforms.map(({ id, title, description, capabilities, tone, priority, logoUrl }) => (
      <article className={`integration-catalog-card integration-tone-${tone} integration-state-planned integration-platform-card`} key={id} data-platform={id}>
        <div className="integration-card-top">
          <span className="integration-card-logo" data-brand-logo="true"><img src={logoUrl} alt={title} loading="eager" decoding="async"/></span>
          <em>Скоро</em>
        </div>
        <div className="integration-platform-heading">
          <strong>{title}</strong>
          <span>{priority}</span>
        </div>
        <p>{description}</p>
        <div className="integration-card-tags">{capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
        <button type="button" disabled title="Серверная интеграция будет добавлена следующим этапом">Подключение готовится</button>
      </article>
    ))}
  </>, target);
}
