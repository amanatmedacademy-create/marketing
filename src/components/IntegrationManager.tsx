import CommunicationIntegrations from './CommunicationIntegrations';
import IntegrationWorkspace from './IntegrationWorkspace';
import '../integration-catalog.css';

export default function IntegrationManager() {
  return <div className="stack">
    <IntegrationWorkspace />
    <CommunicationIntegrations />
  </div>;
}
