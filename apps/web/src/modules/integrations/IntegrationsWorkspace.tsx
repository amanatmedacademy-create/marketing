import { useEffect, useMemo, useState } from 'react';
import {
  Activity, CalendarDays, CheckCircle2, ChevronRight, Cloud, Database, Facebook, HardDrive, LoaderCircle,
  Mail, MessageCircle, Phone, RefreshCw, Search, Settings2, ShieldCheck, Video, Webhook, X, AlertCircle,
} from 'lucide-react';
import { useActionFeedback } from '../system/ActionFeedback';

type Status = 'available' | 'planned' | 'setup';
type RuntimeStatus = 'not_configured' | 'configured' | 'checking' | 'healthy' | 'error';
type Category = 'all' | 'communications' | 'marketing' | 'productivity' | 'infrastructure';
type Field = { key: string; label: string; placeholder: string; secret?: boolean; required?: boolean };
type Integration = {
  id: string; name: string; description: string; category: Exclude<Category, 'all'>; status: Status;
  icon: typeof Facebook; capabilities: string[]; fields?: Field[]; auth?: 'oauth' | 'credentials' | 'system';
};

type SavedConfig = Record<string, { configuredAt: string; values: Record<string, string> }>;

const STORAGE_KEY = 'imds.integration-config-v1';
const categories: Array<{ id: Category; label: string }> = [
  { id: 'all', label: 'Все' }, { id: 'communications', label: 'Коммуникации' }, { id: 'marketing', label: 'Маркетинг' },
  { id: 'productivity', label: 'Работа команды' }, { id: 'infrastructure', label: 'Инфраструктура' },
];

const integrations: Integration[] = [
  { id: 'meta', name: 'Meta Business', description: 'WhatsApp Business, Instagram Direct и рекламные кабинеты Meta.', category: 'marketing', status: 'setup', icon: Facebook, capabilities: ['OAuth', 'Сообщения', 'Реклама'], auth: 'oauth', fields: [
    { key: 'appId', label: 'META_APP_ID', placeholder: 'ID приложения Meta', required: true },
    { key: 'configId', label: 'META_WABA_CONFIG_ID', placeholder: 'Configuration ID', required: true },
    { key: 'businessId', label: 'META_BUSINESS_ID', placeholder: 'Business Manager ID' },
  ] },
  { id: 'whatsapp', name: 'WhatsApp Business API', description: 'Диалоги, шаблоны, статусы доставки и привязка к CRM.', category: 'communications', status: 'setup', icon: MessageCircle, capabilities: ['Шаблоны', 'Webhook', 'Inbox'], auth: 'credentials', fields: [
    { key: 'phoneNumberId', label: 'META_PHONE_NUMBER_ID', placeholder: 'Phone Number ID', required: true },
    { key: 'wabaId', label: 'META_WABA_ID', placeholder: 'WhatsApp Business Account ID', required: true },
    { key: 'verifyToken', label: 'META_WEBHOOK_VERIFY_TOKEN', placeholder: 'Webhook verify token', secret: true, required: true },
  ] },
  { id: 'gmail', name: 'Gmail / Workspace', description: 'Общие ящики, письма клиентов и история коммуникаций.', category: 'communications', status: 'available', icon: Mail, capabilities: ['OAuth', 'Почта', 'Контакты'], auth: 'oauth' },
  { id: 'calendar', name: 'Google Calendar', description: 'Встречи, расписание менеджеров и напоминания клиентам.', category: 'productivity', status: 'available', icon: CalendarDays, capabilities: ['События', 'Meet', 'Напоминания'], auth: 'oauth' },
  { id: 'drive', name: 'Google Drive', description: 'Документы, вложения сделок и совместная работа с файлами.', category: 'productivity', status: 'available', icon: HardDrive, capabilities: ['Файлы', 'Папки', 'Доступ'], auth: 'oauth' },
  { id: 'meet', name: 'Google Meet', description: 'Создание видеовстреч из карточки клиента или календаря.', category: 'productivity', status: 'available', icon: Video, capabilities: ['Видеовстречи', 'Calendar'], auth: 'oauth' },
  { id: 'telephony', name: 'Телефония', description: 'Входящие звонки, записи разговоров и пропущенные вызовы.', category: 'communications', status: 'planned', icon: Phone, capabilities: ['Звонки', 'Записи', 'Статусы'] },
  { id: 'tiktok', name: 'TikTok Ads', description: 'Кампании, расходы, лиды и рекламная аналитика.', category: 'marketing', status: 'planned', icon: Activity, capabilities: ['Ads API', 'Лиды', 'Расходы'] },
  { id: 'supabase', name: 'Supabase', description: 'Основная база данных, авторизация и realtime-события.', category: 'infrastructure', status: 'setup', icon: Database, capabilities: ['Database', 'Auth', 'Realtime'], auth: 'system' },
  { id: 'r2', name: 'Cloudflare R2', description: 'Объектное хранилище документов, медиа и резервных копий.', category: 'infrastructure', status: 'planned', icon: Cloud, capabilities: ['Storage', 'Backup', 'CDN'] },
  { id: 'webhooks', name: 'Webhooks', description: 'Обмен событиями с внешними сервисами и внутренними модулями.', category: 'infrastructure', status: 'available', icon: Webhook, capabilities: ['Events', 'Retries', 'Logs'], auth: 'credentials', fields: [
    { key: 'endpoint', label: 'Endpoint URL', placeholder: 'https://example.com/webhook', required: true },
    { key: 'secret', label: 'Signing secret', placeholder: 'Секрет подписи', secret: true, required: true },
  ] },
];

function readConfig(): SavedConfig {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedConfig; } catch { return {}; }
}

export function IntegrationsWorkspace() {
  const feedback = useActionFeedback();
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Integration | null>(null);
  const [savedConfig, setSavedConfig] = useState<SavedConfig>(() => readConfig());
  const [runtime, setRuntime] = useState<Record<string, RuntimeStatus>>({});
  const [checkingAll, setCheckingAll] = useState(false);

  const filtered = useMemo(() => integrations.filter(item => {
    const matchesCategory = category === 'all' || item.category === category;
    const search = query.trim().toLowerCase();
    return matchesCategory && (!search || `${item.name} ${item.description} ${item.capabilities.join(' ')}`.toLowerCase().includes(search));
  }), [category, query]);

  const getRuntimeStatus = (item: Integration): RuntimeStatus => runtime[item.id] ?? (savedConfig[item.id] ? 'configured' : 'not_configured');
  const configuredCount = integrations.filter(item => getRuntimeStatus(item) === 'configured' || getRuntimeStatus(item) === 'healthy').length;

  async function checkIntegration(item: Integration) {
    setRuntime(current => ({ ...current, [item.id]: 'checking' }));
    try {
      if (item.id === 'supabase') {
        const response = await fetch('/health', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Health-check вернул ${response.status}`);
        const payload = await response.json() as { status?: string };
        if (payload.status !== 'ok') throw new Error('Backend вернул некорректный статус.');
      } else if (!savedConfig[item.id] && item.auth !== 'oauth') {
        throw new Error('Сначала заполните обязательные параметры.');
      } else if (item.auth === 'oauth') {
        throw new Error('OAuth-сессия ещё не подтверждена провайдером.');
      }
      setRuntime(current => ({ ...current, [item.id]: 'healthy' }));
      feedback.success(`${item.name}: соединение доступно`, 'Проверка завершена успешно.');
    } catch (error) {
      setRuntime(current => ({ ...current, [item.id]: 'error' }));
      feedback.error(`${item.name}: проверка не пройдена`, error instanceof Error ? error.message : 'Неизвестная ошибка.');
    }
  }

  async function checkAll() {
    setCheckingAll(true);
    for (const item of integrations.filter(entry => entry.status !== 'planned')) await checkIntegration(item);
    setCheckingAll(false);
  }

  function saveIntegration(item: Integration, values: Record<string, string>) {
    const safeValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, item.fields?.find(field => field.key === key)?.secret ? 'configured' : value.trim()]));
    const next = { ...savedConfig, [item.id]: { configuredAt: new Date().toISOString(), values: safeValues } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedConfig(next);
    setRuntime(current => ({ ...current, [item.id]: 'configured' }));
    setSelected(null);
    feedback.success(`${item.name} настроен`, item.auth === 'oauth' ? 'Теперь завершите OAuth-авторизацию.' : 'Параметры сохранены. Запустите проверку соединения.');
  }

  async function disconnect(item: Integration) {
    const accepted = await feedback.confirm({ title: `Отключить ${item.name}?`, message: 'Локальная конфигурация будет удалена. Данные в CRM сохранятся.', confirmLabel: 'Отключить', destructive: true });
    if (!accepted) return;
    const next = { ...savedConfig }; delete next[item.id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedConfig(next);
    setRuntime(current => ({ ...current, [item.id]: 'not_configured' }));
    feedback.info(`${item.name} отключён`, 'Сохранённая конфигурация удалена.');
  }

  return <div className="integrations-workspace">
    <header className="integrations-heading">
      <div className="integrations-heading-icon"><Settings2 size={21} /></div>
      <div><span>Системные настройки</span><h1>Центр интеграций</h1><p>Подключайте внешние сервисы и контролируйте готовность обмена данными.</p></div>
      <button disabled={checkingAll} onClick={() => void checkAll()}>{checkingAll ? <LoaderCircle size={16} className="auth-spinner" /> : <ShieldCheck size={16} />} {checkingAll ? 'Проверка…' : 'Проверить подключения'}</button>
    </header>

    <section className="integrations-summary">
      <article><span className="summary-icon available"><CheckCircle2 size={17} /></span><div><span>Настроено</span><strong>{configuredCount}</strong><small>Имеют параметры</small></div></article>
      <article><span className="summary-icon setup"><Settings2 size={17} /></span><div><span>Не настроено</span><strong>{integrations.filter(item => item.status !== 'planned' && !savedConfig[item.id] && item.id !== 'supabase').length}</strong><small>Нужны OAuth или ключи</small></div></article>
      <article><span className="summary-icon planned"><Activity size={17} /></span><div><span>В разработке</span><strong>{integrations.filter(item => item.status === 'planned').length}</strong><small>Запланированные интеграции</small></div></article>
      <article><span className="summary-icon total"><Webhook size={17} /></span><div><span>Всего сервисов</span><strong>{integrations.length}</strong><small>В едином каталоге</small></div></article>
    </section>

    <section className="integrations-toolbar">
      <div className="integration-categories">{categories.map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
      <label><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти интеграцию" /></label>
    </section>

    <section className="integrations-grid">{filtered.map(item => {
      const Icon = item.icon;
      const state = getRuntimeStatus(item);
      const stateLabel = item.status === 'planned' ? 'В разработке' : state === 'healthy' ? 'Проверено' : state === 'configured' ? 'Настроено' : state === 'checking' ? 'Проверка' : state === 'error' ? 'Ошибка' : 'Не настроено';
      return <article className="integration-card" key={item.id}>
        <header><span className="integration-logo"><Icon size={21} /></span><span className={`integration-status ${item.status} runtime-${state}`}>{stateLabel}</span></header>
        <div className="integration-copy"><h2>{item.name}</h2><p>{item.description}</p></div>
        <div className="integration-capabilities">{item.capabilities.map(capability => <span key={capability}>{capability}</span>)}</div>
        <footer><small>{state === 'error' ? 'Требуется повторная настройка' : item.status === 'planned' ? 'Подключение появится позже' : item.auth === 'oauth' ? 'Авторизация через провайдера' : 'Ключи и параметры подключения'}</small>
          <div className="integration-card-actions">
            {(state === 'configured' || state === 'healthy' || state === 'error') && <button className="integration-check" onClick={() => void checkIntegration(item)}><RefreshCw size={14} /></button>}
            <button disabled={item.status === 'planned' || state === 'checking'} onClick={() => setSelected(item)}>{item.status === 'planned' ? 'Скоро' : savedConfig[item.id] ? 'Настроить' : 'Подключить'}<ChevronRight size={15} /></button>
          </div>
        </footer>
      </article>;
    })}</section>

    {!filtered.length && <div className="integrations-empty"><Search size={24} /><strong>Ничего не найдено</strong><span>Измените запрос или выберите другую категорию.</span></div>}
    {selected && <IntegrationSetupModal item={selected} existing={savedConfig[selected.id]?.values ?? {}} onClose={() => setSelected(null)} onSave={values => saveIntegration(selected, values)} onDisconnect={savedConfig[selected.id] ? () => void disconnect(selected) : undefined} />}
  </div>;
}

function IntegrationSetupModal({ item, existing, onClose, onSave, onDisconnect }: { item: Integration; existing: Record<string, string>; onClose: () => void; onSave: (values: Record<string, string>) => void; onDisconnect?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((item.fields ?? []).map(field => [field.key, field.secret ? '' : existing[field.key] ?? ''])));
  const requiredMissing = (item.fields ?? []).some(field => field.required && !values[field.key]?.trim());

  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);

  return <div className="integration-modal-backdrop" onMouseDown={onClose}>
    <section className="integration-modal" onMouseDown={event => event.stopPropagation()}>
      <header><div><h2>{item.name}</h2><p>{item.auth === 'oauth' ? 'Подготовьте параметры, затем завершите OAuth-авторизацию у провайдера.' : 'Заполните параметры подключения. Секреты не сохраняются в открытом виде.'}</p></div><button onClick={onClose}><X size={18} /></button></header>
      {item.auth === 'system' ? <div className="integration-system-info"><CheckCircle2 size={20} /><div><strong>Системная интеграция</strong><span>Supabase настраивается через переменные окружения Worker. Используйте кнопку проверки на карточке.</span></div></div> : item.auth === 'oauth' && !item.fields?.length ? <div className="integration-system-info"><AlertCircle size={20} /><div><strong>OAuth endpoint будет подключён отдельно</strong><span>UI готов. До появления provider-specific endpoint статус останется «не подтверждено».</span></div></div> : <div className="integration-fields">{item.fields?.map(field => <label key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span><input type={field.secret ? 'password' : 'text'} value={values[field.key] ?? ''} placeholder={field.placeholder} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} /><small>{field.secret ? 'Значение используется только для подтверждения настройки и не отображается повторно.' : field.placeholder}</small></label>)}</div>}
      <footer>{onDisconnect && <button className="integration-disconnect" onClick={onDisconnect}>Отключить</button>}<span /><button onClick={onClose}>Отмена</button>{item.auth !== 'system' && <button className="primary" disabled={requiredMissing} onClick={() => onSave(values)}>Сохранить настройки</button>}</footer>
    </section>
  </div>;
}
