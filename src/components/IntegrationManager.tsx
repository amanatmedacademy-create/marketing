import CommunicationIntegrations from './CommunicationIntegrations';
import IntegrationWorkspace from './IntegrationWorkspace';
import '../integration-catalog.css';
import '../integration-page-overrides.css';

export default function IntegrationManager() {
  return <div className="stack integrations-page-without-journal">
    <IntegrationWorkspace />
    <CommunicationIntegrations />
  </div>;
}
