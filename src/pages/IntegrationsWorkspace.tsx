import IntegrationManager from '../components/IntegrationManager';
import OperationalIntegrationCards from '../components/OperationalIntegrationCards';
import '../integration-workspace-unified.css';

export default function IntegrationsWorkspace() {
  return <>
    <IntegrationManager />
    <OperationalIntegrationCards />
  </>;
}
