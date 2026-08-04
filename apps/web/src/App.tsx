import { useState } from 'react';
import { BarChart3, Cable, LogOut, PanelLeftClose } from 'lucide-react';
import { useAuth } from './modules/auth/AuthContext';
import { MetaAdsAllAccounts } from './modules/ads/MetaAdsAllAccounts';
import { TikTokAdsCampaigns } from './modules/ads/TikTokAdsCampaigns';
import { MarketingDataSources } from './modules/integrations/MarketingDataSources';

type AnalyticsView = 'sources' | 'meta' | 'tiktok';

const views: Array<{ id: AnalyticsView; label: string; description: string; icon: typeof Cable }> = [
  { id: 'sources', label: 'Data Sources', description: 'OAuth-подключения рекламных кабинетов', icon: Cable },
  { id: 'meta', label: 'Meta Ads', description: 'Кабинеты, кампании и группы объявлений', icon: BarChart3 },
  { id: 'tiktok', label: 'TikTok Ads', description: 'Кампании и рекламные показатели', icon: BarChart3 },
];

export default function App() {
  const { currentUser, logout } = useAuth();
  const [view, setView] = useState<AnalyticsView>('sources');
  const activeView = views.find((item) => item.id === view) ?? views[0];

  return (
    <div className="marketing-app">
      <aside className="marketing-sidebar">
        <div className="marketing-brand">
          <span className="marketing-brand-mark"><BarChart3 size={20} /></span>
          <div>
            <strong>IMDS Marketing</strong>
            <small>Analytics</small>
          </div>
        </div>

        <nav className="marketing-navigation" aria-label="Marketing Analytics">
          {views.map((item) => {
            const Icon = item.icon;
            return <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>;
          })}
        </nav>

        <div className="marketing-sidebar-footer">
          <div className="marketing-company">
            <strong>{currentUser.companyName}</strong>
            <small>{currentUser.email}</small>
          </div>
          <button type="button" className="marketing-logout" onClick={() => void logout()}>
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </aside>

      <main className="marketing-main">
        <header className="marketing-header">
          <div>
            <span className="marketing-eyebrow">Marketing Analytics</span>
            <h1>{activeView.label}</h1>
            <p>{activeView.description}</p>
          </div>
          <PanelLeftClose size={20} aria-hidden="true" />
        </header>

        <section className="marketing-content">
          {view === 'sources' && <MarketingDataSources />}
          {view === 'meta' && <MetaAdsAllAccounts />}
          {view === 'tiktok' && <TikTokAdsCampaigns />}
        </section>
      </main>
    </div>
  );
}
