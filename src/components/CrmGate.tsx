import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import CompanyOnboarding from './CompanyOnboarding';
import { loadCrmBootstrap, type CrmBootstrap } from '../services/crmBootstrap';

export default function CrmGate({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<CrmBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadCrmBootstrap();
      setBootstrap(result);
      const storedCompanyId = localStorage.getItem('imds_active_company_id');
      const activeCompany = result.companies.find((company) => company.id === storedCompanyId) ?? result.companies[0];
      if (activeCompany) localStorage.setItem('imds_active_company_id', activeCompany.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <div className="auth-screen auth-screen--loading">
    <div className="auth-loading-card">
      <LoaderCircle className="spin" size={25}/>
      <p>Загружаем рабочее пространство</p>
    </div>
  </div>;

  if (error) return <div className="auth-screen">
    <div className="auth-login-card" style={{ margin: 'auto', maxWidth: 520 }}>
      <h2>Не удалось открыть CRM</h2>
      <div className="auth-error" role="alert">{error}</div>
      <button className="google-login" onClick={() => void reload()}><span>Повторить</span></button>
    </div>
  </div>;

  if (bootstrap?.requiresOnboarding) return <CompanyOnboarding onComplete={() => void reload()} />;

  return <>{children}</>;
}
