import { useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Facebook,
  HardDrive,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Settings2,
  ShieldCheck,
  Video,
  Webhook,
} from 'lucide-react';

type Status = 'available' | 'planned' | 'setup';
type Category = 'all' | 'communications' | 'marketing' | 'productivity' | 'infrastructure';

type Integration = {
  id: string;
  name: string;
  description: string;
  category: Exclude<Category, 'all'>;
  status: Status;
  icon: typeof Facebook;
  capabilities: string[];
};

const categories: Array<{ id: Category; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'communications', label: 'Коммуникации' },
  { id: 'marketing', label: 'Маркетинг' },
  { id: 'productivity', label: 'Работа команды' },
  { id: 'infrastructure', label: 'Инфраструктура' },
];

const integrations: Integration[] = [
  { id: 'meta', name: 'Meta Business', description: 'WhatsApp Business, Instagram Direct и рекламные кабинеты Meta.', category: 'marketing', status: 'setup', icon: Facebook, capabilities: ['OAuth', 'Сообщения', 'Реклама'] },
  { id: 'whatsapp', name: 'WhatsApp Business API', description: 'Диалоги, шаблоны, статусы доставки и привязка к CRM.', category: 'communications', status: 'setup', icon: MessageCircle, capabilities: ['Шаблоны', 'Webhook', 'Inbox'] },
  { id: 'gmail', name: 'Gmail / Workspace', description: 'Общие ящики, письма клиентов и история коммуникаций.', category: 'communications', status: 'available', icon: Mail, capabilities: ['OAuth', 'Почта', 'Контакты'] },
  { id: 'calendar', name: 'Google Calendar', description: 'Встречи, расписание менеджеров и напоминания клиентам.', category: 'productivity', status: 'available', icon: CalendarDays, capabilities: ['События', 'Meet', 'Напоминания'] },
  { id: 'drive', name: 'Google Drive', description: 'Документы, вложения сделок и совместная работа с файлами.', category: 'productivity', status: 'available', icon: HardDrive, capabilities: ['Файлы', 'Папки', 'Доступ'] },
  { id: 'meet', name: 'Google Meet', description: 'Создание видеовстреч из карточки клиента или календаря.', category: 'productivity', status: 'available', icon: Video, capabilities: ['Видеовстречи', 'Calendar'] },
  { id: 'telephony', name: 'Телефония', description: 'Входящие звонки, записи разговоров и пропущенные вызовы.', category: 'communications', status: 'planned', icon: Phone, capabilities: ['Звонки', 'Записи', 'Статусы'] },
  { id: 'tiktok', name: 'TikTok Ads', description: 'Кампании, расходы, лиды и рекламная аналитика.', category: 'marketing', status: 'planned', icon: Activity, capabilities: ['Ads API', 'Лиды', 'Расходы'] },
  { id: 'supabase', name: 'Supabase', description: 'Основная база данных, авторизация и realtime-события.', category: 'infrastructure', status: 'setup', icon: Database, capabilities: ['Database', 'Auth', 'Realtime'] },
  { id: 'r2', name: 'Cloudflare R2', description: 'Объектное хранилище документов, медиа и резервных копий.', category: 'infrastructure', status: 'planned', icon: Cloud, capabilities: ['Storage', 'Backup', 'CDN'] },
  { id: 'webhooks', name: 'Webhooks', description: 'Обмен событиями с внешними сервисами и внутренними модулями.', category: 'infrastructure', status: 'available', icon: Webhook, capabilities: ['Events', 'Retries', 'Logs'] },
];

const statusMeta: Record<Status, { label: string; description: string }> = {
  available: { label: 'Доступно', description: 'Можно подключить' },
  setup: { label: 'Требует настройки', description: 'Нужны ключи или OAuth' },
  planned: { label: 'В разработке', description: 'Подключение появится позже' },
};

export function IntegrationsWorkspace() {
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => integrations.filter(item => {
    const matchesCategory = category === 'all' || item.category === category;
    const search = query.trim().toLowerCase();
    const matchesSearch = !search || `${item.name} ${item.description} ${item.capabilities.join(' ')}`.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  }), [category, query]);

  const available = integrations.filter(item => item.status === 'available').length;
  const setup = integrations.filter(item => item.status === 'setup').length;
  const planned = integrations.filter(item => item.status === 'planned').length;

  return <div className="integrations-workspace">
    <header className="integrations-heading">
      <div className="integrations-heading-icon"><Settings2 size={21} /></div>
      <div><span>Системные настройки</span><h1>Центр интеграций</h1><p>Подключайте внешние сервисы и контролируйте готовность обмена данными.</p></div>
      <button><ShieldCheck size={16} /> Проверить подключения</button>
    </header>

    <section className="integrations-summary">
      <article><span className="summary-icon available"><CheckCircle2 size={17} /></span><div><span>Доступно сейчас</span><strong>{available}</strong><small>Готово к подключению</small></div></article>
      <article><span className="summary-icon setup"><Settings2 size={17} /></span><div><span>Требуют настройки</span><strong>{setup}</strong><small>Нужны ключи доступа</small></div></article>
      <article><span className="summary-icon planned"><Activity size={17} /></span><div><span>В разработке</span><strong>{planned}</strong><small>Запланированные интеграции</small></div></article>
      <article><span className="summary-icon total"><Webhook size={17} /></span><div><span>Всего сервисов</span><strong>{integrations.length}</strong><small>В едином каталоге</small></div></article>
    </section>

    <section className="integrations-toolbar">
      <div className="integration-categories">{categories.map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
      <label><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти интеграцию" /></label>
    </section>

    <section className="integrations-grid">
      {filtered.map(item => {
        const Icon = item.icon;
        const meta = statusMeta[item.status];
        return <article className="integration-card" key={item.id}>
          <header><span className="integration-logo"><Icon size={21} /></span><span className={`integration-status ${item.status}`}>{meta.label}</span></header>
          <div className="integration-copy"><h2>{item.name}</h2><p>{item.description}</p></div>
          <div className="integration-capabilities">{item.capabilities.map(capability => <span key={capability}>{capability}</span>)}</div>
          <footer><small>{meta.description}</small><button disabled={item.status === 'planned'}>{item.status === 'planned' ? 'Скоро' : item.status === 'setup' ? 'Настроить' : 'Подключить'}<ChevronRight size={15} /></button></footer>
        </article>;
      })}
    </section>

    {!filtered.length && <div className="integrations-empty"><Search size={24} /><strong>Ничего не найдено</strong><span>Измените запрос или выберите другую категорию.</span></div>}
  </div>;
}
