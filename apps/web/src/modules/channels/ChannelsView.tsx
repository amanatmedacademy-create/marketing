import {
  Cable,
  CheckCircle2,
  Cloud,
  Instagram,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Settings,
  Video,
} from 'lucide-react';
import { OmnichannelInbox, type InboxChannel } from '../inbox/OmnichannelInbox';

export type ChannelView =
  | 'whatsapp'
  | 'instagram'
  | 'email'
  | 'ads'
  | 'cloud'
  | 'meetings'
  | 'integrations';

type ChannelDefinition = {
  title: string;
  description: string;
  icon: typeof MessageCircle;
  metrics: Array<[string, string]>;
  connections: Array<{ name: string; detail: string; connected: boolean }>;
};

const inboxViews = new Set<ChannelView>(['whatsapp', 'instagram', 'email']);

const definitions: Record<ChannelView, ChannelDefinition> = {
  whatsapp: {
    title: 'WhatsApp',
    description: 'Диалоги, шаблоны сообщений, распределение операторов и привязка переписки к сделкам.',
    icon: MessageCircle,
    metrics: [['Открытые диалоги', '24'], ['Без ответа', '7'], ['Среднее время ответа', '3 мин'], ['Новые лиды', '18']],
    connections: [
      { name: 'Meta WhatsApp Business API', detail: 'Основной официальный канал', connected: false },
      { name: 'Телефонная линия клиники', detail: '+7 700 000 00 00', connected: false },
    ],
  },
  instagram: {
    title: 'Instagram',
    description: 'Direct, комментарии, лиды из рекламы и автоматическое создание контактов в CRM.',
    icon: Instagram,
    metrics: [['Новые сообщения', '16'], ['Комментарии', '9'], ['Лиды', '12'], ['Конверсия', '21%']],
    connections: [{ name: 'Instagram Business', detail: 'Подключение через Meta OAuth', connected: false }],
  },
  email: {
    title: 'Email',
    description: 'Общий почтовый ящик, цепочки писем, шаблоны и история коммуникаций клиента.',
    icon: Mail,
    metrics: [['Новые письма', '11'], ['Ожидают ответа', '4'], ['Отправлено сегодня', '29'], ['Открываемость', '62%']],
    connections: [
      { name: 'Gmail / Google Workspace', detail: 'OAuth-подключение почтового ящика', connected: false },
      { name: 'SMTP / IMAP', detail: 'Подключение корпоративной почты', connected: false },
    ],
  },
  ads: {
    title: 'Реклама',
    description: 'Кабинеты Meta, TikTok и Google Ads: расходы, лиды, CPL, продажи и окупаемость.',
    icon: Megaphone,
    metrics: [['Расход сегодня', '₸ 68 400'], ['Лиды', '37'], ['CPL', '₸ 1 849'], ['Продажи', '6']],
    connections: [
      { name: 'Meta Ads', detail: 'Facebook и Instagram Ads', connected: false },
      { name: 'TikTok Ads', detail: 'Рекламные кабинеты TikTok', connected: false },
      { name: 'Google Ads', detail: 'Поиск, КМС и YouTube', connected: false },
    ],
  },
  cloud: {
    title: 'Облако',
    description: 'Файлы пациентов, документы, вложения сделок, медиаматериалы и резервные копии.',
    icon: Cloud,
    metrics: [['Использовано', '0 ГБ'], ['Файлы', '0'], ['Документы', '0'], ['Последний backup', '—']],
    connections: [
      { name: 'Cloudflare R2', detail: 'Основное объектное хранилище', connected: false },
      { name: 'Google Drive', detail: 'Импорт и совместный доступ', connected: false },
    ],
  },
  meetings: {
    title: 'Видеовстречи',
    description: 'Онлайн-консультации, ссылки на встречи, напоминания и запись результата в карточку клиента.',
    icon: Video,
    metrics: [['Сегодня', '3'], ['На неделе', '11'], ['Завершено', '0'], ['Средняя длительность', '—']],
    connections: [
      { name: 'Google Meet', detail: 'Создание встреч через календарь', connected: false },
      { name: 'Jitsi', detail: 'Встроенные видеоконсультации', connected: false },
    ],
  },
  integrations: {
    title: 'Интеграции',
    description: 'Единый центр подключения внешних систем и контроля состояния синхронизации.',
    icon: Cable,
    metrics: [['Доступно', '12'], ['Подключено', '0'], ['Требуют внимания', '0'], ['События сегодня', '0']],
    connections: [
      { name: 'Meta', detail: 'WhatsApp, Instagram и Ads', connected: false },
      { name: 'Google Workspace', detail: 'Gmail, Drive, Calendar и Meet', connected: false },
      { name: 'TikTok Ads', detail: 'Кампании, расходы и лиды', connected: false },
      { name: 'Телефония', detail: 'Звонки, записи и пропущенные', connected: false },
    ],
  },
};

export const channelNavigation = [
  { id: 'whatsapp' as ChannelView, label: 'WhatsApp', icon: MessageCircle },
  { id: 'instagram' as ChannelView, label: 'Instagram', icon: Instagram },
  { id: 'email' as ChannelView, label: 'Email', icon: Mail },
  { id: 'ads' as ChannelView, label: 'Реклама', icon: Megaphone },
  { id: 'cloud' as ChannelView, label: 'Облако', icon: Cloud },
  { id: 'meetings' as ChannelView, label: 'Видеовстречи', icon: Video },
  { id: 'integrations' as ChannelView, label: 'Интеграции', icon: Cable },
];

export function ChannelsView({ view }: { view: ChannelView }) {
  if (inboxViews.has(view)) {
    return <OmnichannelInbox initialChannel={view as InboxChannel} />;
  }

  const definition = definitions[view];
  const Icon = definition.icon;

  return (
    <div className="view-page channel-page">
      <div className="channel-heading">
        <div className="channel-title-icon"><Icon size={20} /></div>
        <div>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
        <button className="channel-primary-button"><Plus size={15} /> Подключить</button>
      </div>

      <div className="kpi-grid channel-kpis">
        {definition.metrics.map(([label, value]) => (
          <article className="kpi-card" key={label}><span>{label}</span><strong>{value}</strong></article>
        ))}
      </div>

      <section className="channel-panel">
        <div className="channel-panel-head">
          <div><h2>Подключения</h2><p>Управление каналами и параметрами синхронизации.</p></div>
          <button className="channel-secondary-button"><RefreshCw size={14} /> Проверить</button>
        </div>
        <div className="connection-list">
          {definition.connections.map((connection) => (
            <article className="connection-row" key={connection.name}>
              <div className={`connection-logo ${connection.connected ? 'connected' : ''}`}>
                {connection.connected ? <CheckCircle2 size={18} /> : view === 'whatsapp' ? <Phone size={18} /> : <Icon size={18} />}
              </div>
              <div className="connection-copy"><strong>{connection.name}</strong><span>{connection.detail}</span></div>
              <span className={`connection-chip ${connection.connected ? 'connected' : ''}`}>
                {connection.connected ? 'Подключено' : 'Не подключено'}
              </span>
              <button className="connection-action">{connection.connected ? <Settings size={15} /> : 'Подключить'}</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
