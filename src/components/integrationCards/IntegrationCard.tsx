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
  const visibleSettings = integration.fields.slice(0, 2);
  const hiddenSettingsCount = Math.max(0, integration.fields.length - visibleSettings.length);
  const settingsState = disabled
    ? 'Скоро'
    : integration.status === 'error'
      ? 'Проверить'
      : connected
        ? 'Настроено'
        : 'Не настроено';

  return <article
    className={`${styles.card} ${active ? styles.cardActive : ''}`}
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

    <div className={styles.dataArea}>
      {connected && integration.stats.length > 0 ? <div className={styles.stats}>
        {integration.stats.slice(0, 3).map((stat) => <div key={stat.label}>
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
    </div>

    <div className={styles.settingsPanel}>
      <div className={styles.settingsHead}>
        <div><Settings size={15}/><strong>Настройки</strong></div>
        <span>{settingsState}</span>
      </div>

      {visibleSettings.length > 0 ? <div className={styles.settingsList}>
        {visibleSettings.map((field, index) => <div className={styles.settingsRow} key={`${field.label}-${index}`}>
          <span>{field.label}</span>
          <strong title={field.value}>{field.value || '—'}</strong>
        </div>)}
        {hiddenSettingsCount > 0 && <div className={styles.settingsMore}>Ещё параметров: {hiddenSettingsCount}</div>}
      </div> : <p className={styles.settingsEmpty}>
        {disabled
          ? 'Параметры появятся после запуска интеграции.'
          : connected
            ? 'Подключение активно. Откройте настройки для изменения параметров.'
            : 'Откройте настройки и задайте параметры подключения.'}
      </p>}
    </div>

    <div className={styles.actions}>
      <button
        type="button"
        className={styles.mainButton}
        onClick={(event) => { event.stopPropagation(); onConfigure(); }}
        disabled={disabled}
      >
        <Settings size={16}/>
        <span>{disabled ? 'Скоро' : connected ? 'Открыть настройки' : 'Настроить подключение'}</span>
        <ChevronRight size={17}/>
      </button>
    </div>
  </article>;
}
