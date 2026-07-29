import { useEffect } from 'react';
import CommunicationIntegrations from './CommunicationIntegrations';
import IntegrationWorkspace from './IntegrationWorkspace';
import '../integration-catalog.css';

export default function IntegrationManager() {
  useEffect(() => {
    const removeEmbeddedJournal = () => {
      document.querySelectorAll('.connections-page .connections-runs').forEach((node) => node.remove());
    };

    removeEmbeddedJournal();
    const observer = new MutationObserver(removeEmbeddedJournal);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return <div className="stack">
    <IntegrationWorkspace />
    <CommunicationIntegrations />
  </div>;
}
