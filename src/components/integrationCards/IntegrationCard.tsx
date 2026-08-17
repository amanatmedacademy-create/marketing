import { ChevronRight, ExternalLink, Settings } from 'lucide-react';
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

export function IntegrationCard({ integration, active = false, disabled = false, onSelect, onConfigure }: IntegrationCardProps) {
  const connected = integration.status === 'connected' || integration.status === 'syncing';
  const error = integration.status === 'error';
  const visibleFields = integration.fields.slice(0, 1);
  const visibleStats = integration.stats.slice(0, 3);

  const primaryLabel = disabled
    ? 'Скоро'
    : connected
      ? 'Управлять'
      : error
        ? 'Проверить подключение'
        : 'Подключить';

  return <article
    className={`${styles.card} ${connected ? styles.cardConnected : ''} ${error ? styles.cardError : ''} ${active ? styles.cardActive : ''}`}
    onClick={onSelect}
  >
    <div className={styles.cardTop}>
      <ProviderLogo provider={integration.id}/>
      <div className={styles.cardTitle}>
        <strong>{integration.name}</strong>
        <span>{integration.description}</span>
      </div>
      <StatusBadge status={integration.status}/>
    </div>

    <div className={styles.divider}/>

    {connected ? <>
      <div className={styles.connectedMeta}>
        <div className={styles.accountLine}>
          <span>Аккаунт</span>
          <strong title={visibleFields[0]?.value}>{visibleFields[0]?.value || 'Подключён'}</strong>
        </div>
        <div className={styles.syncLine}>
          <span>Синхронизация</span>
          <strong>{integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Нет данных'}</strong>
        </div>
      </div>

      <div className={styles.stats}>
        {visibleStats.map((stat) => <div key={stat.label}>
          <span>{stat.label}</span>
          <strong className={stat.tone ? styles[`tone_${stat.tone}`] : ''}>{stat.value}</strong>
        </div>)}
      </div>
    </> : <div className={styles.disconnectedBody}>
      <p>{error
        ? integration.errorMessage || 'Подключение требует внимания. Проверьте параметры и повторите попытку.'
        : disabled
          ? 'Интеграция появится на следующем этапе развития платформы.'
          : 'Подключите сервис, чтобы видеть данные, статус API и синхронизацию.'}</p>
    </div>}

    <div className={styles.actions}>
      <button
        type="button"
        className={styles.mainButton}
        onClick={(event) => { event.stopPropagation(); onConfigure(); }}
        disabled={disabled}
      >
        {connected ? <ExternalLink size={16}/> : <Settings size={16}/>} 
        <span>{primaryLabel}</span>
        <ChevronRight size={17}/>
      </button>
      {connected && !disabled && <button
        type="button"
        className={styles.secondaryButton}
        onClick={(event) => { event.stopPropagation(); onConfigure(); }}
      >
        <Settings size={14}/>
        Настройки
      </button>}
    </div>
  </article>;
}
