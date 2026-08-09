import { LoaderCircle, Send } from 'lucide-react';
import { useState } from 'react';

export type TelegramBotConfig = {
  configured?: boolean;
  connected?: boolean;
  status?: string;
  values?: {
    botId?: string;
    botUsername?: string;
    botName?: string;
    webhook?: string;
  };
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

type Props = {
  config: TelegramBotConfig | null;
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

export default function TelegramBotSetup({ config, onRefresh, onMessage }: Props) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const values = config?.values || {};
  const connected = Boolean(config?.connected);

  const connect = async () => {
    const botToken = token.trim();
    if (!botToken) {
      onMessage('error', 'Telegram: укажите Bot Token из @BotFather.');
      return;
    }
    setBusy('connect');
    try {
      const result = await readJson<{ botUsername?: string; botName?: string }>(await fetch('/api/integrations/telegram/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botToken }),
      }));
      setToken('');
      await onRefresh();
      onMessage('ok', `Telegram ${result.botUsername ? `@${result.botUsername}` : result.botName || 'bot'} подключён. Webhook настроен автоматически.`);
    } catch (error) {
      onMessage('error', `Telegram: ${errorText(error)}`);
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить Telegram Bot для выбранной клиники?')) return;
    setBusy('disconnect');
    try {
      await readJson(await fetch('/api/integrations/telegram/disconnect', { method: 'DELETE' }));
      await onRefresh();
      onMessage('ok', 'Telegram Bot отключён, webhook удалён.');
    } catch (error) {
      onMessage('error', `Telegram: ${errorText(error)}`);
    } finally {
      setBusy('');
    }
  };

  return <div className="iv2-form">
    <div className="iv2-oauth">
      <div>
        <strong>{connected ? `@${values.botUsername || values.botId || 'Telegram bot'}` : 'Подключение Telegram Bot'}</strong>
        <span>{connected
          ? `${values.botName || 'Бот'} подключён к текущей клинике. Входящие сообщения автоматически создают лид и диалог в IMDS.`
          : 'Создайте бота в @BotFather, скопируйте Bot Token и вставьте его ниже. IMDS проверит токен и установит webhook автоматически.'}</span>
      </div>
      <Send size={22}/>
    </div>

    <label>
      <span>Bot Token {connected ? '(введите новый только для переподключения)' : '*'}</span>
      <input
        type="password"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder={connected ? 'Токен сохранён в зашифрованном виде' : '123456789:AA...'}
      />
    </label>

    <button className="iv2-primary" type="button" onClick={() => void connect()} disabled={Boolean(busy) || !token.trim()}>
      {busy === 'connect' ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>} {connected ? 'Переподключить Telegram' : 'Подключить Telegram'}
    </button>

    {connected && <div className="iv2-form-title">
      <strong>Telegram Bot API</strong>
      <span>Bot ID: {values.botId || '—'} · Webhook: {values.webhook === 'configured' ? 'подключён' : '—'}</span>
    </div>}

    {config?.lastError && <div className="iv2-message iv2-message--error">{config.lastError}</div>}

    {config?.configured && <button className="iv2-danger" type="button" onClick={() => void disconnect()} disabled={Boolean(busy)}>
      {busy === 'disconnect' && <LoaderCircle className="spin" size={16}/>} Отключить Telegram Bot
    </button>}
  </div>;
}
