import { useEffect } from 'react';
import IntegrationWorkspace from './IntegrationWorkspace';
import { marketingApi, type IntegrationProvider } from '../services/api';
import '../integration-catalog.css';

function advertisingProvider(modal: Element): IntegrationProvider | null {
  if (modal.classList.contains('connection-card--meta')) return 'meta';
  if (modal.classList.contains('connection-card--tiktok')) return 'tiktok';
  return null;
}

const premiumMetrics: Record<string, Array<[string, string, boolean?]>> = {
  'meta ads': [['Расход', '—'], ['Лиды', '—'], ['ROAS', '—', true]],
  'tiktok ads': [['Расход', '—'], ['Лиды', '—'], ['CPL', '—', true]],
  bitrix24: [['Лиды', '—'], ['Сделки', '—'], ['Конверсия', '—', true]],
  n8n: [['Сценарии', '—'], ['Запуски', '—'], ['Успешно', '—', true]],
};

const guideVisuals: Record<string, Array<{ title: string; text: string; visual: string; requirement: string }>> = {
  'meta ads': [
    { title: 'Войдите через Facebook', text: 'Нажмите «Начать подключение». Система откроет безопасную авторизацию Meta.', visual: 'facebook-login', requirement: 'Пользователь с правами администратора Business Manager.' },
    { title: 'Разрешите доступ', text: 'Подтвердите доступ к рекламным кабинетам, страницам и Lead Ads.', visual: 'meta-permissions', requirement: 'Не отключайте ads_read, ads_management и leads_retrieval.' },
    { title: 'Выберите кабинеты', text: 'Отметьте рекламные аккаунты, которые должны синхронизироваться с IMDS.', visual: 'meta-assets', requirement: 'Выберите только рабочие кабинеты Amanat Med Academy.' },
    { title: 'Завершите подключение', text: 'После возврата в IMDS начнётся первичная синхронизация.', visual: 'success', requirement: 'Первичная загрузка может занять несколько минут.' },
  ],
  'tiktok ads': [
    { title: 'Откройте TikTok Business', text: 'Нажмите «Начать подключение» и войдите в TikTok for Business.', visual: 'tiktok-login', requirement: 'Доступ к нужному Business Center.' },
    { title: 'Разрешите Marketing API', text: 'Подтвердите чтение кампаний, расходов и лидов.', visual: 'tiktok-permissions', requirement: 'Права на рекламные аккаунты и Lead Generation.' },
    { title: 'Выберите Advertiser ID', text: 'Укажите рекламные кабинеты для синхронизации.', visual: 'tiktok-assets', requirement: 'Проверьте правильность Advertiser ID.' },
    { title: 'Проверьте подключение', text: 'Сохраните настройки и выполните тестовый обмен.', visual: 'success', requirement: 'После проверки включится автосинхронизация.' },
  ],
  bitrix24: [
    { title: 'Введите адрес портала', text: 'Укажите домен Bitrix24 без https://.', visual: 'bitrix-domain', requirement: 'Например: amanatmed.bitrix24.kz.' },
    { title: 'Создайте webhook', text: 'В Bitrix24 откройте Разработчикам → Входящий webhook.', visual: 'bitrix-webhook', requirement: 'Создавать webhook должен администратор портала.' },
    { title: 'Разрешите CRM', text: 'Выдайте права на лиды, сделки, контакты и пользователей.', visual: 'bitrix-permissions', requirement: 'Не отключайте CRM и user permissions.' },
    { title: 'Сохраните и проверьте', text: 'Вставьте URL webhook и запустите проверку.', visual: 'success', requirement: 'После проверки начнётся синхронизация.' },
  ],
};

function normalizeTitle(card: Element): string {
  return (card.querySelector('.integration-platform-heading > strong, :scope > strong, h3, h4')?.textContent || '')
    .trim()
    .toLowerCase();
}

function addPremiumCardUi(card: HTMLElement) {
  if (card.dataset.premiumReady === 'true') return;
  const title = normalizeTitle(card);
  const metrics = premiumMetrics[title];
  if (!metrics) return;

  card.dataset.premiumReady = 'true';
  card.classList.add('integration-premium-card');

  const tags = card.querySelector('.integration-card-tags');
  const button = card.querySelector<HTMLButtonElement>(':scope > button');
  if (!button) return;

  const metricsNode = document.createElement('div');
  metricsNode.className = 'integration-premium-metrics';
  metricsNode.innerHTML = metrics.map(([label, value, positive]) => `<div><span>${label}</span><strong${positive ? ' class="is-positive"' : ''}>${value}</strong></div>`).join('');
  tags?.insertAdjacentElement('afterend', metricsNode);

  const actions = document.createElement('div');
  actions.className = 'integration-premium-actions';
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'integration-premium-icon';
  settings.title = 'Настройки';
  settings.setAttribute('aria-label', 'Настройки');
  settings.textContent = '⚙';
  settings.onclick = () => button.click();

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'integration-premium-arrow';
  open.title = 'Открыть инструкцию';
  open.setAttribute('aria-label', 'Открыть инструкцию');
  open.textContent = '›';
  open.onclick = () => button.click();

  button.classList.add('integration-premium-primary');
  button.remove();
  actions.append(settings, button, open);
  card.appendChild(actions);
}

function findPrimaryConnectionButton(modal: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>('.integration-modal-body main button'));
  return buttons.find((button) => /подключить через|подключить|продолжить|авториз/i.test(button.textContent || '')) || null;
}

function addPremiumModalScreen(modal: HTMLElement) {
  if (modal.dataset.premiumScreenReady === 'true') return;
  const title = (modal.querySelector('header h2')?.textContent || '').trim().toLowerCase();
  const steps = guideVisuals[title];
  const body = modal.querySelector<HTMLElement>('.integration-modal-body');
  const main = body?.querySelector<HTMLElement>(':scope > main');
  const guide = body?.querySelector<HTMLElement>(':scope > .connection-guide');
  if (!body || !main || !steps) return;

  modal.dataset.premiumScreenReady = 'true';
  modal.classList.add('premium-connection-modal');
  main.classList.add('premium-original-settings');
  guide?.classList.add('premium-original-guide');

  const screen = document.createElement('section');
  screen.className = 'premium-instruction-screen';
  screen.innerHTML = `
    <div class="premium-instruction-heading">
      <div>
        <h3>Как подключить ${modal.querySelector('header h2')?.textContent || 'интеграцию'}</h3>
        <p>Выполните четыре шага. После подключения данные начнут синхронизироваться автоматически.</p>
      </div>
    </div>
    <div class="premium-instruction-steps">
      ${steps.map((step, index) => `
        <article class="premium-instruction-step">
          <div class="premium-step-title"><span>${index + 1}</span><strong>${step.title}</strong></div>
          <p>${step.text}</p>
          <div class="connection-guide-visual connection-guide-visual--${step.visual}" aria-hidden="true"><i></i><b></b><em></em></div>
          <div class="premium-step-requirement"><strong>Что потребуется</strong>${step.requirement}</div>
        </article>
      `).join('')}
    </div>
    <div class="premium-instruction-footer">
      <button type="button" class="premium-start-button">Начать подключение</button>
      <button type="button" class="premium-settings-button">Открыть настройки</button>
      <span>Подключение выполняется через безопасную OAuth-авторизацию.</span>
    </div>
  `;

  body.insertBefore(screen, main);
  const start = screen.querySelector<HTMLButtonElement>('.premium-start-button');
  const settings = screen.querySelector<HTMLButtonElement>('.premium-settings-button');
  start?.addEventListener('click', () => findPrimaryConnectionButton(modal)?.click());
  settings?.addEventListener('click', () => {
    const showingSettings = modal.classList.toggle('premium-show-settings');
    settings.textContent = showingSettings ? 'Вернуться к инструкции' : 'Открыть настройки';
  });
}

export default function IntegrationManager() {
  useEffect(() => {
    const enhanceIntegrationUi = () => {
      document.querySelectorAll('.connections-page .connections-runs').forEach((node) => node.remove());
      document.querySelectorAll<HTMLElement>('.integration-catalog-card').forEach(addPremiumCardUi);

      document.querySelectorAll<HTMLElement>('.integration-modal').forEach((modal) => {
        addPremiumModalScreen(modal);
        const provider = advertisingProvider(modal);
        if (!provider) return;
        const actions = modal.querySelector('.connection-actions');
        const disconnect = actions?.querySelector<HTMLButtonElement>('.connections-button--danger');
        if (!actions || !disconnect) return;

        disconnect.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) node.textContent = 'Отключить и скрыть';
        });
        disconnect.title = 'Удалить токен, остановить синхронизацию и убрать данные кабинета из текущих отчётов. История сохранится в архиве.';

        if (actions.querySelector('[data-purge-ad-provider]')) return;
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'connections-button connections-button--danger';
        purge.dataset.purgeAdProvider = provider;
        purge.textContent = 'Удалить кабинет и данные';
        purge.title = 'Безвозвратно удалить активные и архивные рекламные данные этого провайдера.';
        purge.onclick = async () => {
          const confirmation = window.prompt('Действие необратимо. Введите УДАЛИТЬ, чтобы удалить кабинет и все его рекламные данные.');
          if (confirmation !== 'УДАЛИТЬ') return;
          purge.disabled = true;
          disconnect.disabled = true;
          purge.textContent = 'Удаляем…';
          try {
            await marketingApi.deleteIntegrationConfig(provider, true);
            window.location.reload();
          } catch (error) {
            purge.disabled = false;
            disconnect.disabled = false;
            purge.textContent = 'Удалить кабинет и данные';
            window.alert(error instanceof Error ? error.message : String(error));
          }
        };
        actions.appendChild(purge);
      });
    };

    enhanceIntegrationUi();
    const observer = new MutationObserver(enhanceIntegrationUi);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <IntegrationWorkspace />;
}
