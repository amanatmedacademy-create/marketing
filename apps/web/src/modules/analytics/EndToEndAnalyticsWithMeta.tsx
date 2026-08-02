import { MetaAdsInsightsPanel } from '../ads/MetaAdsInsightsPanel';
import { EndToEndAnalytics } from './EndToEndAnalytics';

export function EndToEndAnalyticsWithMeta() {
  return (
    <div className="end-to-end-with-meta">
      <MetaAdsInsightsPanel compact />
      <EndToEndAnalytics />
    </div>
  );
}
