import { IntegrationsWorkspace } from './IntegrationsWorkspace';
import { MetaBusinessConnect } from './MetaBusinessConnect';
import './meta-business-connect.css';

export function IntegrationsWorkspaceWithMeta() {
  return (
    <div className="integrations-meta-page">
      <MetaBusinessConnect />
      <IntegrationsWorkspace />
    </div>
  );
}
