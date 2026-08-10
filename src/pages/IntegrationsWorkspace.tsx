import IntegrationManager from '../components/IntegrationManager';
import ZadarmaIntegrationPanel from '../components/ZadarmaIntegrationPanel';

export default function IntegrationsWorkspace() {
  return <>
    <ZadarmaIntegrationPanel />
    <IntegrationManager />
  </>;
}