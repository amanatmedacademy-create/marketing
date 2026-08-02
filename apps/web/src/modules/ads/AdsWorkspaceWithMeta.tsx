import { MetaAdsInsightsPanel } from './MetaAdsInsightsPanel';
import { AdsWorkspace } from './AdsWorkspace';

export function AdsWorkspaceWithMeta() {
  return (
    <div className="ads-workspace-with-meta">
      <MetaAdsInsightsPanel />
      <AdsWorkspace />
    </div>
  );
}
