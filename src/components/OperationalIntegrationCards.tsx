import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { IntegrationCard } from './integrationCards/IntegrationCard';
import type { CardIntegrationProvider, CardIntegrationSummary } from './integrationCards/types';
import CloudTelephonyIntegrationPanel from './CloudTelephonyIntegrationPanel';
import MisIntegrationPanel from './MisIntegrationPanel';
import TelephonyDiagnosticsPanel from './TelephonyDiagnosticsPanel';
import ZadarmaInboundControls from './ZadarmaInboundControls';
import ZadarmaIntegrationPanel from './ZadarmaIntegrationPanel';
import { useAuth } from './AuthGate';
import '../integrations-v2.css';

type MisStatus = {
  credential?: { configured?: boolean; status?: string; lastVerifiedAt?: string | null; lastError?: string | null };
  settings?: { last_success_at?: string | null; last_error?: string | null };
  queue?: { pending?: number; failed?: number };
};

type TelephonyStatus = {
  provider?: string;
  providerLabel?: string;
  configured?: boolean;
  connected?: boolean;
  extension?: string | null;
  capabilities?: string[];
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

type ProviderConfig = {
  provider?: string;
  configured?: boolean;
  status?: string;
  values?: Record<string, string>;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};
type ProvidersResponse = { providers?: ProviderConfig[] };
type DetailKey = 'mis' | 'zadarma' | 'binotel' | 'sipuni' | null;

type OperationalIntegrationCardsProps = { inline?: boolean };

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || `HTTP ${response.status}`);
  return (raw ? JSON.parse(raw) : {}) as T;
}

function formatDate(value?: string | null): string {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Нет данных' : date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function OperationalIntegrationCards({ inline = false }: OperationalIntegrationCardsProps) {
  const { user } = useAuth();
  const [mis, setMis] = useState<MisStatus | null>(null);
  const [telephony, setTelephony] = useState<TelephonyStatus | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [detail, setDetail] = useState<DetailKey>(null);
  const [active, setActive] = useState<CardIntegrationProvider | null>(null);

  const load = useCallback(async () => {
    const [nextMis, nextTelephony, nextProviders] = await Promise.all([
      readJson<MisStatus>('/api/integrations/mis/status').catch(() => null),
      readJson<TelephonyStatus>('/api/telephony/status').catch(() => null),
      readJson<ProvidersResponse>('/api/telephony/providers').catch(() => ({ providers: [] })),
    ]);
    setMis(nextMis);
    setTelephony(nextTelephony);
    setProviders(nextProviders.providers || []);
  }, []);

  useEffect(() => { void load(); }, [load, user.companyId]);

  const providerMap = useMemo(() => new Map(providers.map((item) => [item.provider || '', item])), [providers]);

  const cards = useMemo<CardIntegrationSummary[]>(() => {
    const misError = mis?.credential?.lastError || mis?.settings?.last_error || undefined;
    const misConfigured = Boolean(mis?.credential?.configured);
    const misConnected = mis?.credential?.status === 'connected' && !misError;
    const telephonyConfigured = Boolean(telephony?.configured);
    const binotel = providerMap.get('binotel');
    const sipuni = providerMap.get('sipuni');
    const cloudCard = (id: 'binotel' | 'sipuni', item?: ProviderConfig): CardIntegrationSummary => ({
      id,
      name: id === 'binotel' ? 'Binotel' : 'Sipuni',
      description: id === 'binotel'
        ? 'Облачная телефония, события звонков, записи, пропущенные и CRM-аналитика.'
        : 'Виртуальная АТС, realtime-события, записи, пропущенные и CRM-аналитика.',
      status: item?.lastError ? 'error' : item?.status === 'connected' ? 'connected' : item?.configured ? 'disconnected' : 'not_connected',
      lastSyncedAt: item?.lastVerifiedAt || null,
      stats: [
        { label: 'Webhook', value: item?.status === 'connected' ? 'Получает события' : item?.configured ? 'Ожидает событие' : 'Не настроен' },
        { label: 'Последняя проверка', value: formatDate(item?.lastVerifiedAt) },
        { label: 'Контур', value: 'Организация' },
      ],
      fields: [{ label: id === 'binotel' ? 'API' : 'User ID', value: item?.configured ? 'Настроено' : 'Не подключено' }],
      errorMessage: item?.lastError || undefined,
    });
    return [
      {
        id: 'mis',
        name: 'МИС / Клиническая система',
        description: 'Клинические данные, врачи, расписание, пациенты и записи выбранной организации.',
        status: misError ? 'error' : misConnected ? 'connected' : misConfigured ? 'disconnected' : 'not_connected',
        lastSyncedAt: mis?.settings?.last_success_at || mis?.credential?.lastVerifiedAt || null,
        stats: [
          { label: 'Последняя синхронизация', value: formatDate(mis?.settings?.last_success_at || mis?.credential?.lastVerifiedAt) },
          { label: 'В очереди', value: String(mis?.queue?.pending || 0) },
          { label: 'Ошибок', value: String(mis?.queue?.failed || 0), tone: (mis?.queue?.failed || 0) > 0 ? 'negative' : 'neutral' },
        ],
        fields: [{ label: 'Контур', value: 'Организация' }],
        errorMessage: misError,
      },
      {
        id: 'zadarma',
        name: 'Zadarma',
        description: 'Телефония, входящие и исходящие звонки, записи разговоров и AI Call Intelligence.',
        status: telephony?.provider === 'zadarma' && telephonyConfigured ? 'connected' : telephonyConfigured ? 'disconnected' : 'not_connected',
        lastSyncedAt: telephony?.lastVerifiedAt || null,
        stats: [
          { label: 'Provider', value: telephony?.providerLabel || telephony?.provider || 'Не настроен' },
          { label: 'Внутренний номер', value: telephony?.extension || '—' },
          { label: 'Функций', value: String(telephony?.capabilities?.length || 0) },
        ],
        fields: [{ label: 'Контур', value: 'Организация' }],
        errorMessage: telephony?.lastError || undefined,
      },
      cloudCard('binotel', binotel),
      cloudCard('sipuni', sipuni),
    ];
  }, [mis, telephony, providerMap]);

  const open = (id: CardIntegrationProvider) => {
    setActive(id);
    if (id === 'mis' || id === 'zadarma' || id === 'binotel' || id === 'sipuni') setDetail(id);
  };

  const cardNodes = cards.map((card) => <IntegrationCard
    key={card.id}
    integration={card}
    active={active === card.id}
    onSelect={() => setActive(card.id)}
    onConfigure={() => open(card.id)}
  />);

  const detailTitle = detail === 'mis' ? 'МИС / Клиническая система' : detail === 'zadarma' ? 'Zadarma / Телефония' : detail === 'binotel' ? 'Binotel / Телефония' : 'Sipuni / Телефония';

  return <>
    {inline ? cardNodes : <section className="iv2-section iv2-section--operational" aria-label="Операционные интеграции"><div className="iv2-grid">{cardNodes}</div></section>}

    {detail && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
      <section className="iv2-modal iv2-modal--workspace" role="dialog" aria-modal="true" aria-label={`Настройка ${detailTitle}`}>
        <header className="iv2-workspace-head">
          <div><h2>{detailTitle}</h2><p>Подробные настройки выбранной организации.</p></div>
          <button type="button" onClick={() => { setDetail(null); void load(); }} aria-label="Закрыть"><X size={20}/></button>
        </header>
        <div className="iv2-workspace-body">
          {detail === 'mis' ? <MisIntegrationPanel /> : detail === 'zadarma' ? <>
            <ZadarmaIntegrationPanel />
            <ZadarmaInboundControls />
            <TelephonyDiagnosticsPanel />
          </> : <CloudTelephonyIntegrationPanel provider={detail} onChanged={() => void load()}/>} 
        </div>
      </section>
    </div>}
  </>;
}
