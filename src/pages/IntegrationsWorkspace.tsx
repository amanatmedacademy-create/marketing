import IntegrationManager from '../components/IntegrationManager';
import ZadarmaIntegrationPanel from '../components/ZadarmaIntegrationPanel';
import ZadarmaInboundControls from '../components/ZadarmaInboundControls';

export default function IntegrationsWorkspace() {
  return <>
    <ZadarmaIntegrationPanel />
    <ZadarmaInboundControls />
    <IntegrationManager />
  </>;
}
