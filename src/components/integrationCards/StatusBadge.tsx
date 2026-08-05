import type { CardConnectionStatus } from './types';
import styles from './integrationCards.module.css';

const labels: Record<CardConnectionStatus, string> = {
  connected: 'Подключено',
  syncing: 'Синхронизация',
  error: 'Ошибка',
  disconnected: 'Отключено',
  not_connected: 'Не подключено',
};

export function StatusBadge({ status }: { status: CardConnectionStatus }) {
  return <span className={`${styles.status} ${styles[`status_${status}`] || ''}`}>{labels[status]}</span>;
}
