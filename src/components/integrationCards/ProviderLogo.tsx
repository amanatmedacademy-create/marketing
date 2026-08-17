import type { CardIntegrationProvider } from './types';
import styles from './integrationCards.module.css';

function MetaLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8.5 29.7c2.8-9.7 6.3-15.4 10.3-15.4 5.7 0 9.8 15.4 14.3 15.4 2.7 0 4.4-2.2 4.4-5.7 0-5.1-2.5-9.7-6.4-9.7-5 0-8.9 8.8-12.5 15.4-2.2 4-4 6-6.2 6-2.8 0-4.7-2.4-3.9-6Z" fill="none" stroke="#0866FF" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function TikTokLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M27.8 9.5v18.3a8.4 8.4 0 1 1-6.7-8.2" fill="none" stroke="#25F4EE" strokeWidth="5.2" strokeLinecap="round"/><path d="M30.3 8.5c.7 5 3.5 7.7 8.2 8.5" fill="none" stroke="#FE2C55" strokeWidth="5.2" strokeLinecap="round"/><path d="M29 9v18.1a7.8 7.8 0 1 1-6.2-7.6" fill="none" stroke="#111" strokeWidth="4.2" strokeLinecap="round"/><path d="M29 9c.7 4.7 3.2 7.2 7.8 8" fill="none" stroke="#111" strokeWidth="4.2" strokeLinecap="round"/></svg>;
}

function GoogleAdsLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M20 10 8.5 31.5a5.4 5.4 0 0 0 9.5 5.2L29.6 15A5.4 5.4 0 0 0 20 10Z" fill="#34A853"/><path d="m28 10 11.5 21.5a5.4 5.4 0 0 1-9.5 5.2L18.4 15A5.4 5.4 0 0 1 28 10Z" fill="#4285F4"/><circle cx="13.2" cy="34.2" r="5.2" fill="#FBBC04"/></svg>;
}

function Ga4Logo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="25" width="7" height="13" rx="3.5" fill="#F9AB00"/><rect x="21" y="16" width="7" height="22" rx="3.5" fill="#E37400"/><rect x="32" y="9" width="7" height="29" rx="3.5" fill="#E37400"/></svg>;
}

function BitrixLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="#2FC6F6"/><text x="24" y="21" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">Bitrix</text><text x="24" y="31" textAnchor="middle" fontSize="12" fontWeight="900" fill="#fff">24</text></svg>;
}

function N8nLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#EA4B71" strokeWidth="2.6" strokeLinecap="round"><path d="M8 27c7 0 8-11 14-11 7 0 6 16 13 16 3 0 5-2 5-5"/><path d="M15 33c4-8 7-12 12-12 5 0 8 4 13 4"/></g><g fill="#fff" stroke="#EA4B71" strokeWidth="2.4"><circle cx="8" cy="27" r="3.3"/><circle cx="15" cy="33" r="3.3"/><circle cx="22" cy="16" r="3.3"/><circle cx="27" cy="21" r="3.3"/><circle cx="35" cy="32" r="3.3"/><circle cx="40" cy="25" r="3.3"/></g></svg>;
}

function WhatsAppLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7.5A16.5 16.5 0 0 0 9.8 32.4L7.6 40l7.8-2a16.5 16.5 0 1 0 8.6-30.5Z" fill="#25D366"/><path d="M18 15.5c.7-.2 1.2 0 1.6.8l2 4.5c.3.7.2 1.2-.3 1.8l-1.6 1.8c1.4 3 3.7 5.2 6.8 6.6l1.7-2c.5-.6 1.1-.7 1.8-.4l4.4 2.1c.8.4 1 1 .8 1.7-.5 2.5-2.7 4.2-5.2 4.4-6.7.4-16.5-8.8-16.6-15.8 0-2.6 1.7-4.8 4.6-5.5Z" fill="#fff"/></svg>;
}

function MisLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 39 12v10.5C39 31.3 32.6 38 24 42 15.4 38 9 31.3 9 22.5V12l15-6Z" fill="#0FA89A"/><path d="M21 15h6v6h6v6h-6v6h-6v-6h-6v-6h6v-6Z" fill="#fff"/></svg>;
}

function ZadarmaLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="#E4232B"/><path d="M13 15h22L20 32h15v5H12l15-17H13v-5Z" fill="#fff"/><path d="M30 10c2.8 0 5 2.2 5 5h-5v-5Z" fill="#FFB5B7"/></svg>;
}

function FallbackLogo({ label }: { label: string }) {
  return <span className={styles.logoFallback}>{label}</span>;
}

const labels: Partial<Record<CardIntegrationProvider, string>> = {
  wazzup: 'WZ',
  binotel: 'BI',
  sipuni: 'SI',
};

export function ProviderLogo({ provider }: { provider: CardIntegrationProvider }) {
  let mark = null;
  if (provider === 'meta') mark = <MetaLogo/>;
  else if (provider === 'tiktok') mark = <TikTokLogo/>;
  else if (provider === 'google_ads') mark = <GoogleAdsLogo/>;
  else if (provider === 'ga4') mark = <Ga4Logo/>;
  else if (provider === 'bitrix') mark = <BitrixLogo/>;
  else if (provider === 'n8n') mark = <N8nLogo/>;
  else if (provider === 'waba') mark = <WhatsAppLogo/>;
  else if (provider === 'mis') mark = <MisLogo/>;
  else if (provider === 'zadarma') mark = <ZadarmaLogo/>;
  else mark = <FallbackLogo label={labels[provider] || provider.slice(0, 2).toUpperCase()}/>;

  return <span className={`${styles.logo} ${styles[`logo_${provider}`] || ''}`} aria-hidden="true">{mark}</span>;
}
