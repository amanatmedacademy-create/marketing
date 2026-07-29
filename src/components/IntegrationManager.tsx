import { useEffect } from 'react';
import CommunicationIntegrations from './CommunicationIntegrations';
import IntegrationWorkspace from './IntegrationWorkspace';
import { marketingApi, type IntegrationProvider } from '../services/api';
import '../integration-catalog.css';

function advertisingProvider(modal: Element): IntegrationProvider | null {
  if (modal.classList.contains('connection-card--meta')) return 'meta';
  if (modal.classList.contains('connection-card--tiktok')) return 'tiktok';
  return null;
}

export default function IntegrationManager() {
  useEffect(() => {
    const enhanceIntegrationUi = () => {
      document.querySelectorAll('.connections-page .connections-runs').forEach((node) => node.remove());

      document.querySelectorAll('.integration-modal').forEach((modal) => {
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

  return <div className="stack">
    <IntegrationWorkspace />
    <CommunicationIntegrations />
  </div>;
}