import { useEffect } from 'react';
import { marketingApi, type WabaConfigResponse } from '../services/api';

type FacebookSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
};

type EmbeddedSignupResult = { wabaId: string; phoneNumberId: string };

async function loadFacebookSdk(config: WabaConfigResponse): Promise<FacebookSdk> {
  const sdkWindow = window as unknown as { FB?: FacebookSdk; fbAsyncInit?: () => void };
  if (sdkWindow.FB) {
    sdkWindow.FB.init({ appId: config.appId, cookie: true, xfbml: false, version: config.version });
    return sdkWindow.FB;
  }

  return new Promise((resolve, reject) => {
    sdkWindow.fbAsyncInit = () => {
      if (!sdkWindow.FB) return reject(new Error('Meta SDK не загрузился'));
      sdkWindow.FB.init({ appId: config.appId, cookie: true, xfbml: false, version: config.version });
      resolve(sdkWindow.FB);
    };

    if (document.getElementById('facebook-jssdk')) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onerror = () => reject(new Error('Не удалось загрузить Meta SDK'));
    document.head.appendChild(script);
  });
}

function waitForEmbeddedSignupResult(): Promise<EmbeddedSignupResult> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Meta не вернула WABA ID и Phone Number ID'));
    }, 120000);

    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      let payload: unknown = event.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || typeof payload !== 'object') return;
      const message = payload as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
      if (message.type !== 'WA_EMBEDDED_SIGNUP' || message.event !== 'FINISH') return;
      const wabaId = message.data?.waba_id || '';
      const phoneNumberId = message.data?.phone_number_id || '';
      if (!wabaId || !phoneNumberId) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve({ wabaId, phoneNumberId });
    };

    window.addEventListener('message', handler);
  });
}

async function connect(button: HTMLButtonElement, card: HTMLElement) {
  const badge = card.querySelector<HTMLElement>('.integration-card-top em');
  const original = button.textContent || 'Подключить через Facebook';
  button.disabled = true;
  button.textContent = 'Открываем Meta…';

  try {
    const config = await marketingApi.wabaConfig();
    if (!config.configured) throw new Error(config.error || 'WABA Embedded Signup не настроен');
    const sdk = await loadFacebookSdk(config);
    const assetsPromise = waitForEmbeddedSignupResult();
    const codePromise = new Promise<string>((resolve, reject) => {
      sdk.login((response) => {
        const code = response.authResponse?.code || '';
        if (!code) return reject(new Error('Meta не вернула authorization code'));
        resolve(code);
      }, {
        config_id: config.configId,
        auth_type: 'rerequest',
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          feature: 'whatsapp_embedded_signup',
          sessionInfoVersion: 3,
          setup: {},
        },
      });
    });

    const [code, assets] = await Promise.all([codePromise, assetsPromise]);
    await marketingApi.connectWaba({ code, ...assets });
    card.classList.remove('integration-state-planned');
    card.classList.add('integration-state-connected');
    if (badge) badge.textContent = 'Подключено';
    button.textContent = 'Переподключить';
    button.disabled = false;
  } catch (error) {
    if (badge) badge.textContent = 'Ошибка';
    button.textContent = original;
    button.disabled = false;
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

function activateCard(card: HTMLElement) {
  if (card.dataset.wabaActivated === 'true') return;
  card.dataset.wabaActivated = 'true';
  const badge = card.querySelector<HTMLElement>('.integration-card-top em');
  const button = card.querySelector<HTMLButtonElement>(':scope > button');
  if (!button) return;

  card.classList.remove('integration-state-planned');
  card.classList.add('integration-state-disconnected');
  button.disabled = false;
  button.textContent = 'Подключить через Facebook';
  if (badge) badge.textContent = 'Доступно';
  button.addEventListener('click', () => void connect(button, card));

  void marketingApi.wabaConfig().then((config) => {
    if (config.connected) {
      card.classList.remove('integration-state-disconnected');
      card.classList.add('integration-state-connected');
      if (badge) badge.textContent = 'Подключено';
      button.textContent = 'Переподключить';
    } else if (!config.configured) {
      if (badge) badge.textContent = 'Нужна настройка';
    }
  }).catch(() => {
    if (badge) badge.textContent = 'Ошибка настройки';
  });
}

export default function WabaCatalogActivation() {
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;
    const scan = () => document.querySelectorAll<HTMLElement>('[data-platform="whatsapp-cloud"]').forEach(activateCard);
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
