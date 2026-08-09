import { ChevronRight, Settings } from 'lucide-react';
import DataInspector from '../DataInspector';
import type { CardIntegrationSummary } from './types';
import { ProviderLogo } from './ProviderLogo';
import { StatusBadge } from './StatusBadge';
import styles from './integrationCards.module.css';

interface IntegrationCardProps {
  integration: CardIntegrationSummary;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onConfigure: () => void;
}

const integrationInspector = (id: string, name: string) => {
  const key = id.toLowerCase();
  if (key === 'meta') return {
    description: 'Рекламные кабинеты Meta: расходы, показы, охват, клики, кампании, группы объявлений и объявления.',
    sources: ['Meta Marketing API'],
    fields: ['spend', 'impressions', 'reach', 'clicks', 'campaign_id', 'adset_id', 'ad_id'],
    technical: ['Provider: meta', 'API: Meta Graph / Marketing API', 'Tenant: текущая клиника'],
  };
  if (key === 'tiktok') return {
    description: 'Рекламные данные TikTok: расходы, показы, клики и структура рекламных кампаний.',
    sources: ['TikTok Ads API'],
    fields: ['spend', 'impressions', 'clicks', 'campaign_id', 'adgroup_id', 'ad_id'],
    technical: ['Provider: tiktok', 'Tenant: текущая клиника'],
  };
  if (key === 'bitrix') return {
    description: 'CRM-данные по лидам, стадиям, записям, сделкам, продажам и выручке.',
    sources: ['Bitrix24 CRM'],
    fields: ['lead_id', 'stage', 'appointment', 'deal', 'sale_amount', 'source'],
    technical: ['Provider: bitrix', 'Entity mapping: CRM → IMDS', 'Tenant: текущая клиника'],
  };
  if (key === 'n8n') return {
    description: 'Автоматизации и служебные события, которые передаются между внешними системами и IMDS.',
    sources: ['n8n Webhooks', 'IMDS API'],
    fields: ['event', 'payload', 'status', 'timestamp'],
    technical: ['Provider: n8n', 'Transport: webhook/API', 'Tenant: текущая клиника'],
  };
  if (key === 'waba') return {
    description: 'WhatsApp Business: диалоги, сообщения, статусы доставки, шаблоны и данные подключённого номера.',
    sources: ['WhatsApp Cloud API'],
    fields: ['phone_number_id', 'waba_id', 'message_id', 'status', 'template', 'referral'],
    technical: ['Provider: waba', 'Webhook: Meta', 'Tenant: текущая клиника'],
  };
  return {
    description: `Интеграция ${name}: IMDS получает доступные данные и статус синхронизации только в контексте текущей клиники.`,
    sources: [name],
    fields: ['status', 'last_verified_at', 'provider data'],
    technical: [`Provider: ${id}`, 'Tenant: текущая клиника'],
  };
};

export function IntegrationCard({ integration, active = false, disabled = false, onSelect, onConfigure }: IntegrationCardProps) {
  const connected = integration.status === 'connected' || integration.status === 'syncing';
  const inspector = integrationInspector(integration.id, integration.name);
  const quality = integration.status === 'error' ? 'error' : integration.status === 'syncing' ? 'delayed' : connected ? 'fresh' : 'partial';

  return <article
    className={`${styles.card} ${active ? styles.cardActive : ''}`}
    onClick={onSelect}
    role="button"
    tabIndex={0}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect();
      }
    }}
  >
    <div className={styles.cardTop}>
      <ProviderLogo provider={integration.id}/>
      <div className={styles.cardTitle}>
        <strong className="data-inspector-card-title">
          {integration.name}
          <DataInspector
            compact
            title={integration.name}
            description={inspector.description}
            sources={inspector.sources}
            fields={inspector.fields}
            updatedAt={integration.lastSyncedAt}
            quality={quality}
            qualityNote={connected ? 'Интеграция участвует в текущем контуре данных.' : 'Часть показателей может быть недоступна до подключения.'}
            filters={['Текущая клиника']}
            technical={inspector.technical}
          />
        </strong>
        <span>{integration.description}</span>
      </div>
      <StatusBadge status={integration.status}/>
    </div>

    <div className={styles.divider}/>

    {connected && integration.stats.length > 0 ? <div className={styles.stats}>
      {integration.stats.map((stat) => <div key={stat.label}>
        <span>{stat.label}</span>
        <strong className={stat.tone ? styles[`tone_${stat.tone}`] : ''}>{stat.value}</strong>
      </div>)}
    </div> : <p className={styles.emptyHint}>
      {integration.status === 'error'
        ? integration.errorMessage || 'Последняя проверка завершилась ошибкой.'
        : disabled
          ? 'Подключение будет добавлено на следующем этапе.'
          : 'Подключите сервис, чтобы видеть данные и статус синхронизации.'}
    </p>}

    <div className={styles.actions}>
      <button type="button" className={styles.iconButton} onClick={(event) => { event.stopPropagation(); onConfigure(); }} disabled={disabled} aria-label="Настройки">
        <Settings size={17}/>
      </button>
      <button type="button" className={styles.mainButton} onClick={(event) => { event.stopPropagation(); onConfigure(); }} disabled={disabled}>
        {disabled ? 'Скоро' : connected ? 'Настроить' : 'Подключить'}
      </button>
      <button type="button" className={styles.arrowButton} onClick={(event) => { event.stopPropagation(); onConfigure(); }} disabled={disabled} aria-label="Открыть">
        <ChevronRight size={18}/>
      </button>
    </div>
  </article>;
}