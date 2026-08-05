import CommunicationIntegrations from './CommunicationIntegrations';
import IntegrationWorkspace from './IntegrationWorkspace';
import MetaOAuthLauncher from './MetaOAuthLauncher';
import '../integration-catalog.css';
import '../integration-page-overrides.css';

export default function IntegrationManager() {
  return <div className="stack integrations-page-without-journal">
    <IntegrationWorkspace />
    <MetaOAuthLauncher />
    <CommunicationIntegrations />
  </div>;
}
