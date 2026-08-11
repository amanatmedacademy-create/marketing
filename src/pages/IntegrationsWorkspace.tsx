import IntegrationManager from '../components/IntegrationManager';
import MisIntegrationPanel from '../components/MisIntegrationPanel';
import ZadarmaIntegrationPanel from '../components/ZadarmaIntegrationPanel';
import ZadarmaInboundControls from '../components/ZadarmaInboundControls';

export default function IntegrationsWorkspace() {
  return <>
    <MisIntegrationPanel />
    <ZadarmaIntegrationPanel />
    <ZadarmaInboundControls />
    <IntegrationManager />
  </>;
}
