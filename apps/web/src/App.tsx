import { useState } from 'react';
import { BarChart3, Layers3, LogOut, PanelLeftClose } from 'lucide-react';
import { useAuth } from './modules/auth/AuthContext';
import { MetaAdsAllAccounts } from './modules/ads/MetaAdsAllAccounts';
import { TikTokAdsCampaigns } from './modules/ads/TikTokAdsCampaigns';
import { BulkOperations } from './modules/operations/BulkOperations';

type AnalyticsView = 'meta' | 'tiktok' | 'bulk';

const views: Array<{ id: AnalyticsView; label: string; description: string; icon?: typeof Layers3 }> = [
  { id: 'meta', label: 'Meta Ads', description: 'Кабинеты, кампании и группы объявлений' },
  { id: 'tiktok', label: 'TikTok Ads', description: 'Кампании и рекламные показатели' },
  { id: 'bulk', label: 'Bulk Operations', description: 'Массовые операции с отчётами и dashboard sections', icon: Layers3 },
];

export default function App() {
  const { currentUser, logout } = useAuth();
  const [view, setView] = useState<AnalyticsView>('meta');
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
              <span>{Icon && <Icon size={14} />} {item.label}</span>
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
            <span className="marketing-eyebrow">Рекламная аналитика</span>
            <h1>{activeView.label}</h1>
            <p>{activeView.description}</p>
          </div>
          <PanelLeftClose size={20} aria-hidden="true" />
        </header>

        <section className="marketing-content">
          {view === 'meta' && <MetaAdsAllAccounts />}
          {view === 'tiktok' && <TikTokAdsCampaigns />}
          {view === 'bulk' && <BulkOperations />}
        </section>
      </main>
    </div>
  );
}
