import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPinned, Search, Send, Tv2, Video } from 'lucide-react';

interface PlannedPlatform {
  id: string;
  title: string;
  mark: string;
  description: string;
  capabilities: string[];
  tone: string;
  priority: 'Критический' | 'Высокий' | 'Средний';
  Icon: typeof Search;
}

const platforms: PlannedPlatform[] = [
  {
    id: 'google',
    title: 'Google Ads',
    mark: 'G',
    description: 'Поиск Google, YouTube, КМС и Performance Max для горячего спроса и ретаргетинга.',
    capabilities: ['Поиск', 'YouTube', 'Performance Max'],
    tone: 'google',
    priority: 'Критический',
    Icon: Search,
  },
  {
    id: 'yandex',
    title: 'Yandex Direct',
    mark: 'Я',
    description: 'Поиск Яндекса, РСЯ, ретаргетинг, кампании, объявления и расходы.',
    capabilities: ['Поиск', 'РСЯ', 'Конверсии'],
    tone: 'yandex',
    priority: 'Высокий',
    Icon: Search,
  },
  {
    id: 'telegram',
    title: 'Telegram Ads',
    mark: 'TG',
    description: 'Официальная реклама Telegram, каналы, объявления, показы и переходы.',
    capabilities: ['Каналы', 'Показы', 'Переходы'],
    tone: 'telegram',
    priority: 'Высокий',
    Icon: Send,
  },
  {
    id: '2gis',
    title: '2GIS Ads',
    mark: '2G',
    description: 'Продвижение карточек компаний, звонки, маршруты, переходы и локальный спрос.',
    capabilities: ['Карточка компании', 'Звонки', 'Маршруты'],
    tone: 'twogis',
    priority: 'Высокий',
    Icon: MapPinned,
  },
  {
    id: 'vk',
    title: 'VK Ads',
    mark: 'VK',
    description: 'Кампании VK, лид-формы, сообщества, клипы и рекламная сеть.',
    capabilities: ['Лид-формы', 'Сообщества', 'Ретаргетинг'],
    tone: 'vk',
    priority: 'Средний',
    Icon: Tv2,
  },
];

export default function AdvertisingCatalogExpansion() {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const locate = () => {
      const sections = Array.from(document.querySelectorAll('.integration-catalog-section'));
      const advertisingSection = sections.find((section) => section.querySelector('h2')?.textContent?.trim() === 'Рекламные кабинеты');
      setTarget(advertisingSection?.querySelector('.integration-catalog-grid') || null);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target || window.location.pathname.replace(/\/+$/, '') !== '/integrations') return null;

  return createPortal(<>
    {platforms.map(({ id, title, mark, description, capabilities, tone, priority, Icon }) => (
      <article className={`integration-catalog-card integration-tone-${tone} integration-state-planned integration-platform-card`} key={id} data-platform={id}>
        <div className="integration-card-top">
          <span className="integration-card-logo"><Icon size={19}/><b>{mark}</b></span>
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
