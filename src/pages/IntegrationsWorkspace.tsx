import IntegrationManager from '../components/IntegrationManager';
import OperationalIntegrationCards from '../components/OperationalIntegrationCards';
import '../integration-workspace-unified.css';

// Keep the integrations route on the dedicated VPS frontend release path.
export default function IntegrationsWorkspace() {
  return <IntegrationManager>
    <OperationalIntegrationCards inline />
  </IntegrationManager>;
}
