import { useState } from 'react';
import { Building2, LoaderCircle } from 'lucide-react';
import { createFirstCompany } from '../services/crmBootstrap';

export default function CompanyOnboarding({ onComplete }: { onComplete: () => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createFirstCompany({ name, timezone: 'Asia/Almaty', locale: 'RU' });
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  return <div className="auth-screen">
    <div className="auth-login-card" style={{ margin: 'auto', maxWidth: 520 }}>
      <div className="auth-login-icon"><Building2 size={28}/></div>
      <span className="auth-login-product">IMDS CRM</span>
      <h2>Создайте компанию</h2>
      <p>Это будет отдельное рабочее пространство с собственными сотрудниками, сделками и настройками.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={(event) => void submit(event)}>
        <label style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          <span>Название компании</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={150}
            required
            autoFocus
            placeholder="Например, Amanat Medical"
            style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(148,163,184,.35)' }}
          />
        </label>
        <button className="google-login" type="submit" disabled={loading || name.trim().length < 2}>
          {loading && <LoaderCircle className="spin" size={20}/>}<span>{loading ? 'Создаём…' : 'Создать рабочее пространство'}</span>
        </button>
      </form>
    </div>
  </div>;
}
