import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, LoaderCircle, Settings2, X } from 'lucide-react';
import { marketingApi } from '../services/api';

function isIntegrationsRoute(): boolean {
  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  return normalized === '/integrations';
}

export default function BitrixOAuthLauncher() {
  const [target, setTarget] = useState<Element | null>(null);
  const [card, setCard] = useState<Element | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isIntegrationsRoute()) return;

    const params = new URLSearchParams(window.location.search);
    const oauthState = params.get('bitrix');
    if (oauthState === 'connected') {
      setMessage('Bitrix24 подключён. Запускаем загрузку CRM-данных.');
      params.delete('bitrix');
      window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
      window.setTimeout(() => window.location.reload(), 1000);
    } else if (oauthState === 'error') {
      setMessage('Bitrix24 не подключён. Авторизация была отменена или завершилась ошибкой.');
      params.delete('bitrix');
      window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    }

    const mountIntoCard = () => {
      const nextCard = document.querySelector('.connection-card--bitrix');
      const actions = nextCard?.querySelector('.connection-actions');
      if (nextCard && actions) {
        setCard(nextCard);
        setTarget(actions);
      }
    };

    mountIntoCard();
    const observer = new MutationObserver(mountIntoCard);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!card) return;
    const setupHead = card.querySelector('.connection-setup__head') as HTMLElement | null;
    const fields = card.querySelector('.connection-fields') as HTMLElement | null;
    const advanced = card.querySelector('.connection-advanced') as HTMLElement | null;
    const saveButton = Array.from(card.querySelectorAll('.connection-actions button')).find((button) => button.textContent?.includes('Сохранить и проверить')) as HTMLElement | undefined;

    for (const element of [setupHead, fields, advanced, saveButton]) {
      if (element) element.hidden = !manualMode;
    }

    return () => {
      for (const element of [setupHead, fields, advanced, saveButton]) {
        if (element) element.hidden = false;
      }
    };
  }, [card, manualMode, target]);

  if (!isIntegrationsRoute() || !target) return null;

  const connect = () => {
    setBusy(true);
    setMessage(null);
    try {
      marketingApi.startBitrixOAuth();
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return createPortal(<>
    <button
      type="button"
      className="connections-button connections-button--primary"
      onClick={connect}
      disabled={busy}
    >
      {busy ? <LoaderCircle size={16} className="spin"/> : <ExternalLink size={16}/>} {busy ? 'Открываем Bitrix24…' : 'Подключить через Bitrix24'}
    </button>
    <button
      type="button"
      className="connections-button"
      onClick={() => setManualMode((value) => !value)}
      disabled={busy}
    >
      {manualMode ? <X size={16}/> : <Settings2 size={16}/>} {manualMode ? 'Скрыть ручные настройки' : 'Ручное подключение'}
    </button>
    {message && <span className="meta-oauth-message">{message}</span>}
  </>, target);
}
