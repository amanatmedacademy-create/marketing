import { useEffect, useState } from 'react';
import { CheckCircle2, Facebook, LoaderCircle, RefreshCw, Unplug } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';
import { MetaBusinessConnect } from './MetaBusinessConnect';

type TikTokAdvertiser = {
  advertiser_id: string;
  advertiser_name?: string;
  currency?: string;
  timezone?: string;
  status?: string;
};

type TikTokConnection = {
  provider: 'tiktok_ads';
  status: string;
  scopes: string[];
  accounts: TikTokAdvertiser[];
  connected_at: string;
  updated_at: string;
  last_error: string | null;
};

type TikTokResponse = {
  connection: TikTokConnection | null;
  configured: boolean;
};

export function MarketingDataSources() {
  const [data, setData] = useState<TikTokResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setData(await apiFetch<TikTokResponse>('/integrations/tiktok'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить TikTok integration');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function connectTikTok() {
    setConnecting(true);
    setError('');
    try {
      const response = await apiFetch<{ authorizationUrl: string }>('/integrations/tiktok/start', { method: 'POST' });
      window.location.assign(response.authorizationUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось начать TikTok OAuth');
      setConnecting(false);
    }
  }

  async function disconnectTikTok() {
    setLoading(true);
    setError('');
    try {
      await apiFetch('/integrations/tiktok', { method: 'DELETE' });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отключить TikTok Ads');
      setLoading(false);
    }
  }

  const connection = data?.connection;

  return <div className="data-sources-page">
    <section className="data-sources-intro">
      <span>Data Sources</span>
      <h2>Подключение рекламных кабинетов</h2>
      <p>OAuth-токены хранятся только на сервере. Валюта берётся из каждого рекламного кабинета и не заменяется принудительно на USD.</p>
    </section>

    <MetaBusinessConnect />

    <section className="source-card tiktok-source-card">
      <div className="source-card-head">
        <div className="source-logo tiktok-logo">♪</div>
        <div>
          <span>TikTok for Business</span>
          <h2>TikTok Ads</h2>
          <p>Авторизация рекламодателей, рекламные кабинеты, кампании, расходы и отчётность.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? <LoaderCircle className="auth-spinner" size={15} /> : <RefreshCw size={15} />} Обновить
        </button>
      </div>

      {error && <div className="source-error">{error}</div>}

      {!connection && <div className="source-connect-state">
        <div>
          <strong>{data?.configured ? 'Готово к подключению' : 'Нужна конфигурация TikTok App'}</strong>
          <small>{data?.configured
            ? 'После входа будут получены доступные рекламные кабинеты и их исходные валюты.'
            : 'Добавьте TIKTOK_APP_ID, TIKTOK_APP_SECRET, TIKTOK_REDIRECT_URI и OAUTH_TOKEN_ENCRYPTION_KEY в Cloudflare secrets.'}</small>
        </div>
        <button className="primary" type="button" onClick={() => void connectTikTok()} disabled={!data?.configured || connecting}>
          {connecting ? <LoaderCircle className="auth-spinner" size={15} /> : <span aria-hidden="true">♪</span>}
          {connecting ? 'Переход…' : 'Подключить TikTok Ads'}
        </button>
      </div>}

      {connection && <div className="source-connected-state">
        <div className="source-connected-badge"><CheckCircle2 size={15} /> Подключено</div>
        <div className="source-account-grid">
          {(connection.accounts ?? []).map((account) => <article key={account.advertiser_id}>
            <strong>{account.advertiser_name || account.advertiser_id}</strong>
            <span>ID: {account.advertiser_id}</span>
            <small>{account.currency || 'Валюта не получена'}{account.timezone ? ` · ${account.timezone}` : ''}</small>
          </article>)}
          {!connection.accounts?.length && <div className="source-empty">TikTok подключён, но рекламные кабинеты пока не получены.</div>}
        </div>
        <button className="danger" type="button" onClick={() => void disconnectTikTok()}><Unplug size={15} /> Отключить</button>
      </div>}
    </section>

    <section className="currency-policy-card">
      <h3>Правило валюты</h3>
      <div className="currency-policy-grid">
        <article><strong>Источник</strong><span>Расходы и бюджеты сохраняются в валюте рекламного кабинета.</span></article>
        <article><strong>Отображение</strong><span>Один кабинет — его собственная валюта. Смешанные кабинеты — раздельно по валютам.</span></article>
        <article><strong>Конвертация</strong><span>USD или KZT показываются только после явного пересчёта по сохранённому курсу.</span></article>
      </div>
    </section>
  </div>;
}
