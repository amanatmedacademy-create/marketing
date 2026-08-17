import type { CardIntegrationProvider } from './types';
import styles from './integrationCards.module.css';

const glyphs: Record<CardIntegrationProvider, string> = {
  meta: '∞',
  tiktok: '♪',
  google_ads: 'G',
  ga4: 'GA',
  bitrix: '24',
  n8n: 'N8',
  waba: 'WA',
  mis: 'MIS',
  zadarma: 'ZA',
  wazzup: 'WZ',
  binotel: 'BI',
  sipuni: 'SI',
};

export function ProviderLogo({ provider }: { provider: CardIntegrationProvider }) {
  return <span className={`${styles.logo} ${styles[`logo_${provider}`] || ''}`} aria-hidden="true">{glyphs[provider]}</span>;
}
