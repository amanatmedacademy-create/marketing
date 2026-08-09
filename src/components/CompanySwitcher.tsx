import { useMemo, useState } from 'react';
import { Building2, LoaderCircle } from 'lucide-react';
import { useAuth } from './AuthGate';
import './company-switcher.css';

export default function CompanySwitcher() {
  const { user, switchCompany } = useAuth();
  const [busy, setBusy] = useState(false);
  const companies = user.companies || [];
  const currentId = user.companyId || companies[0]?.id || '';
  const current = useMemo(() => companies.find((company) => company.id === currentId) || companies[0], [companies, currentId]);

  if (!current) return null;

  const changeCompany = async (companyId: string) => {
    if (!companyId || companyId === currentId || busy) return;
    setBusy(true);
    try {
      await switchCompany(companyId);
    } finally {
      setBusy(false);
    }
  };

  return <label className="company-switcher" title="Текущая клиника">
    <span className="company-switcher__icon">{busy ? <LoaderCircle size={16} className="spin"/> : <Building2 size={16}/>}</span>
    <span className="company-switcher__copy">
      <small>Клиника</small>
      <select value={currentId} onChange={(event) => void changeCompany(event.target.value)} disabled={busy || companies.length <= 1} aria-label="Выберите клинику">
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
    </span>
  </label>;
}
