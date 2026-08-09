import { Facebook, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

export type InstagramCandidate = {
  instagramAccountId: string;
  username?: string;
  name?: string;
  pageId?: string;
  pageName?: string;
};

export type InstagramDirectConfig = {
  configured?: boolean;
  connected?: boolean;
  status?: string;
  values?: {
    instagramAccountId?: string;
    username?: string;
    name?: string;
    pageId?: string;
    pageName?: string;
    webhookSubscription?: string;
  };
  candidates?: InstagramCandidate[];
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

type Props = {
  config: InstagramDirectConfig | null;
  onRefresh: () => void | Promise<void>;
  onMessage: (type: 'ok' | 'error', text: string) => void;
};

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try {
    return (JSON.parse(error.message) as { error?: string }).error || error.message;
  } catch {
    return error.message;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { throw new Error(body || `HTTP ${response.status}`); }
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload as T;
}

export default function InstagramDirectSetup({ config, onRefresh, onMessage }: Props) {
  const [busy, setBusy] = useState('');
  const values = config?.values || {};
  const connected = Boolean(config?.connected);
  const candidates = config?.candidates || [];

  const startOAuth = async () => {
    setBusy('oauth');
    try {
      const result = await readJson<{ authorizationUrl?: string; error?: string }>(await fetch('/api/integrations/instagram/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }));
      if (!result.authorizationUrl) throw new Error(result.error || 'Meta не вернула URL авторизации');
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      onMessage('error', `Instagram Direct: ${errorText(error)}`);
      setBusy('');
    }
  };

  const selectAccount = async (instagramAccountId: string) => {
    setBusy(`select:${instagramAccountId}`);
    try {
      const result = await readJson<{ username?: string; subscribed?: boolean; warning?: string }>(await fetch('/api/integrations/instagram/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instagramAccountId }),
      }));
      await onRefresh();
      onMessage('ok', result.subscribed === false
        ? `Instagram @${result.username || instagramAccountId} подключён. Webhook subscription требует проверки в Meta App Dashboard.`
        : `Instagram @${result.username || instagramAccountId} подключён к Direct.`);
    } catch (error) {
      onMessage('error', `Instagram Direct: ${errorText(error)}`);
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить Instagram Direct для выбранной клиники?')) return;
    setBusy('disconnect');
    try {
      await readJson(await fetch('/api/integrations/instagram/disconnect', { method: 'DELETE' }));
      await onRefresh();
      onMessage('ok', 'Instagram Direct отключён.');
    } catch (error) {
      onMessage('error', `Instagram Direct: ${errorText(error)}`);
    } finally {
      setBusy('');
    }
  };

  return <div className="iv2-form">
    <div className="iv2-oauth">
      <div>
        <strong>{connected ? `@${values.username || values.instagramAccountId || 'Instagram'}` : 'Подключение Instagram Direct'}</strong>
        <span>{connected
          ? `Professional Account подключён${values.pageName ? ` через Facebook Page «${values.pageName}»` : ''}. Входящие и исходящие Direct идут в единый чат IMDS.`
          : 'Авторизуйтесь через Meta и предоставьте доступ к Instagram Professional Account клиники.'}</span>
      </div>
      <button className="iv2-facebook" type="button" onClick={() => void startOAuth()} disabled={Boolean(busy)}>
        {busy === 'oauth' ? <LoaderCircle className="spin" size={17}/> : <Facebook size={17}/>} {connected ? 'Переподключить Instagram' : 'Подключить Instagram'}
      </button>
    </div>

    {config?.status === 'selection_required' && <div className="iv2-form">
      <div className="iv2-form-title">
        <strong>Выберите Instagram аккаунт</strong>
        <span>Meta вернула несколько Professional Accounts. Подключится только выбранный аккаунт к текущей клинике.</span>
      </div>
      {candidates.map((candidate) => <button
        key={candidate.instagramAccountId}
        type="button"
        className="iv2-primary"
        disabled={Boolean(busy)}
        onClick={() => void selectAccount(candidate.instagramAccountId)}
      >
        {busy === `select:${candidate.instagramAccountId}` && <LoaderCircle className="spin" size={16}/>} @{candidate.username || candidate.instagramAccountId}{candidate.pageName ? ` · ${candidate.pageName}` : ''}
      </button>)}
    </div>}

    {connected && <div className="iv2-form-title">
      <strong>Direct API</strong>
      <span>Instagram Account ID: {values.instagramAccountId || '—'} · Webhook: {values.webhookSubscription === 'automatic' ? 'подписан автоматически' : 'требует проверки'}</span>
    </div>}

    {config?.lastError && <div className="iv2-message iv2-message--error">{config.lastError}</div>}

    {config?.configured && <button className="iv2-danger" type="button" onClick={() => void disconnect()} disabled={Boolean(busy)}>
      {busy === 'disconnect' && <LoaderCircle className="spin" size={16}/>} Отключить Instagram Direct
    </button>}
  </div>;
}
