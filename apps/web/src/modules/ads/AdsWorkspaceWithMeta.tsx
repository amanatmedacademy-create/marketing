import { MetaAdsAllAccounts } from './MetaAdsAllAccounts';
import { TikTokAdsCampaigns } from './TikTokAdsCampaigns';
import { AdsWorkspace } from './AdsWorkspace';

export function AdsWorkspaceWithMeta() {
  return (
    <div className="ads-workspace-with-meta">
      <MetaAdsAllAccounts />
      <TikTokAdsCampaigns />
      <AdsWorkspace />
    </div>
  );
}
