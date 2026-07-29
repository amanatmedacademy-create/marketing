import V36Dashboard from './V36Dashboard';
import DetailedConversionMatrices from './DetailedConversionMatrices';

export default function AnalyticsWorkspace() {
  return <div className="stack">
    <V36Dashboard />
    <DetailedConversionMatrices days={7} />
  </div>;
}
