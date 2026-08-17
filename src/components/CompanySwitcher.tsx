import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, LoaderCircle, LogIn, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { createClinic, joinClinic } from '../services/auth';
import { useAuth } from './AuthGate';
import './company-switcher.css';

type ActionMode = 'create' | 'join' | null;

const roleLabel = (role: string) => ({
  owner: 'Владелец',
  administrator: 'Администратор',
  manager: 'Менеджер',
  marketer: 'Маркетолог',
  operator: 'Оператор',
  analyst: 'Аналитик',
  viewer: 'Наблюдатель',
  super_admin: 'Super Admin',
}[role] || role);

export default function CompanySwitcher() {
  const { user, switchCompany } = useAuth();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ActionMode>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const companies = user.companies || [];
  const currentId = user.companyId || companies[0]?.id || '';
  const current = useMemo(() => companies.find((company) => company.id === currentId) || companies[0], [companies, currentId]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((company) => `${company.name} ${company.slug} ${roleLabel(company.role)}`.toLowerCase().includes(needle));
  }, [companies, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!current) return null;

  const changeCompany = async (companyId: string) => {
    if (!companyId || companyId === currentId || busy) { setOpen(false); return; }
    setBusy(true); setError('');
    try { await switchCompany(companyId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось переключить клинику'); setBusy(false); }
  };

  const submitAction = async () => {
    if (busy || !mode) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'create') {
        const sourceCompanyId = current.accessSource !== 'platform' && ['owner', 'administrator'].includes(current.role) ? current.id : null;
        const clinic = await createClinic(value, sourceCompanyId);
        setValue(''); setMode(null);
        await switchCompany(clinic.id);
        return;
      }
      const clinic = await joinClinic(value);
      setValue(''); setMode(null);
      if (clinic.status === 'active') await switchCompany(clinic.id);
      else setNotice(`Заявка в «${clinic.name}» отправлена. После подтверждения клиника появится в списке.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Операция не выполнена');
    } finally {
      setBusy(false);
    }
  };

  return <div className="company-switcher" ref={rootRef}>
    <button className="company-switcher__trigger" type="button" title="Текущая клиника" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((state) => !state); setError(''); }}>
      <span className="company-switcher__icon">{busy ? <LoaderCircle size={16} className="spin"/> : <Building2 size={16}/>}</span>
      <span className="company-switcher__copy"><small>Клиника</small><strong>{current.name}</strong></span>
      {user.platformRole === 'super_admin' && <span className="company-switcher__platform" title="Platform access"><ShieldCheck size={13}/></span>}
      <ChevronDown size={15} className={open ? 'company-switcher__chevron open' : 'company-switcher__chevron'}/>
    </button>

    {open && <div className="company-switcher__popover" role="dialog" aria-label="Выбор клиники">
      <div className="company-switcher__head"><div><strong>Клиники</strong><span>{user.platformRole === 'super_admin' ? 'Platform access' : `${companies.length} доступно`}</span></div><button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={16}/></button></div>
      {companies.length > 5 && <label className="company-switcher__search"><Search size={15}/><input autoFocus placeholder="Найти клинику" value={query} onChange={(event) => setQuery(event.target.value)}/></label>}
      <div className="company-switcher__list">
        {filtered.map((company) => <button key={company.id} type="button" className={company.id === currentId ? 'active' : ''} disabled={busy} onClick={() => void changeCompany(company.id)}>
          <span className="company-switcher__clinic-icon"><Building2 size={15}/></span>
          <span><strong>{company.name}</strong><small>{roleLabel(company.role)}{company.accessSource === 'platform' ? ' · platform' : ''}</small></span>
          {company.id === currentId && <Check size={16}/>} 
        </button>)}
        {!filtered.length && <div className="company-switcher__empty">Клиники не найдены</div>}
      </div>
      {companies.length === 1 && !query && <div className="company-switcher__hint">Других доступных клиник пока нет. Можно добавить новую или присоединиться по коду.</div>}

      {mode && <form className="company-switcher__form" onSubmit={(event) => { event.preventDefault(); void submitAction(); }}>
        <label><span>{mode === 'create' ? 'Название новой клиники' : 'Код клиники'}</span><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={mode === 'create' ? 'Например, IMDS Dental' : 'Введите код'} minLength={mode === 'create' ? 2 : 6} required/></label>
        <div><button type="button" onClick={() => { setMode(null); setValue(''); setError(''); }}>Отмена</button><button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin"/> : mode === 'create' ? <Plus size={14}/> : <LogIn size={14}/>} {mode === 'create' ? 'Создать' : 'Присоединиться'}</button></div>
      </form>}
      {error && <div className="company-switcher__error">{error}</div>}
      {notice && <div className="company-switcher__notice">{notice}</div>}
      {!mode && <div className="company-switcher__actions">
        <button type="button" onClick={() => { setMode('create'); setValue(''); setError(''); setNotice(''); }}><Plus size={15}/>Добавить клинику</button>
        <button type="button" onClick={() => { setMode('join'); setValue(''); setError(''); setNotice(''); }}><LogIn size={15}/>Присоединиться по коду</button>
      </div>}
    </div>}
  </div>;
}
