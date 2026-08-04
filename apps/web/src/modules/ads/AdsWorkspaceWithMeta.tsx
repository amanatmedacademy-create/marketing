import { MetaAdsInsightsPanel } from './MetaAdsInsightsPanel';
import { TikTokAdsCampaigns } from './TikTokAdsCampaigns';
import { AdsWorkspace } from './AdsWorkspace';

export function AdsWorkspaceWithMeta() {
  return (
    <div className="ads-workspace-with-meta">
      <MetaAdsInsightsPanel />
      <TikTokAdsCampaigns />
      <AdsWorkspace />
    </div>
  );
}
