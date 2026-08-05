import { ChevronRight, Settings } from 'lucide-react';
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
        <strong>{integration.name}</strong>
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
