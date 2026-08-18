import AnalyticsDataQualityPanel from './AnalyticsDataQualityPanel';
import V36Dashboard from './V36Dashboard';
import DetailedConversionMatrices from './DetailedConversionMatrices';
import '../analytics-workspace.css';

export default function AnalyticsWorkspace() {
  return <div className="stack">
    <AnalyticsDataQualityPanel />
    <V36Dashboard />
    <DetailedConversionMatrices days={7} />
  </div>;
}
