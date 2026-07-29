import V36Dashboard from './V36Dashboard';
import DetailedConversionMatrices from './DetailedConversionMatrices';
import RemoveLegacyConversionCards from './RemoveLegacyConversionCards';

export default function AnalyticsWorkspace() {
  return <div className="stack">
    <RemoveLegacyConversionCards />
    <V36Dashboard />
    <DetailedConversionMatrices days={7} />
  </div>;
}
