import IntegrationManager from '../components/IntegrationManager';
import { GoogleIntegrationsPage } from './StrategicPlatformPages';
import '../integrations-workspace.css';

export default function IntegrationsWorkspace() {
  return <div className="integrations-workspace">
    <IntegrationManager />
    <section className="integrations-google-embedded" aria-label="Google integrations">
      <div className="integrations-google-divider">
        <span>GOOGLE</span>
        <div>
          <h2>Google Ads и Google Analytics 4</h2>
          <p>Google-подключения являются частью общего каталога интеграций. Здесь настраиваются OAuth, аккаунты, свойства и синхронизация.</p>
        </div>
      </div>
      <GoogleIntegrationsPage />
    </section>
  </div>;
}
