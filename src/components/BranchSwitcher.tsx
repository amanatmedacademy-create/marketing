import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, LoaderCircle, MapPin, X } from 'lucide-react';
import { activeBranchId, loadBranches, setActiveBranchId, type Branch } from '../services/branches';
import { useAuth } from './AuthGate';
import './branch-switcher.css';

export default function BranchSwitcher() {
  const { user } = useAuth();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState('');
  const currentId = activeBranchId();
  const current = useMemo(() => branches.find((item) => item.id === currentId) || branches.find((item) => item.isPrimary) || branches[0], [branches, currentId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadBranches().then((result) => {
      if (!active) return;
      setBranches(result.items || []);
      setRestricted(result.restricted);
      const stored = activeBranchId();
      const selected = result.items.find((item) => item.id === stored) || result.items.find((item) => item.isPrimary) || result.items[0];
      if (selected && selected.id !== stored) setActiveBranchId(selected.id);
      setError('');
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.companyId]);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);

  if (!loading && branches.length <= 1 && !error) return null;

  const select = (branch: Branch) => {
    if (branch.id === current?.id) { setOpen(false); return; }
    setActiveBranchId(branch.id);
    window.location.reload();
  };

  return <div className="branch-switcher" ref={rootRef}>
    <button className="branch-switcher__trigger" type="button" aria-haspopup="dialog" aria-expanded={open} title="Активный филиал" onClick={() => setOpen((value) => !value)}>
      <span className="branch-switcher__icon">{loading ? <LoaderCircle className="spin" size={15}/> : <GitBranch size={15}/>}</span>
      <span><small>Филиал</small><strong>{current?.name || 'Выбрать'}</strong></span>
      <ChevronDown size={14}/>
    </button>
    {open && <div className="branch-switcher__popover" role="dialog" aria-label="Выбор филиала">
      <div className="branch-switcher__head"><div><strong>Филиалы</strong><span>{restricted ? 'Назначенные вам' : `${branches.length} доступно`}</span></div><button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={15}/></button></div>
      {error && <div className="branch-switcher__error">{error}</div>}
      <div className="branch-switcher__list">{branches.map((branch) => <button key={branch.id} type="button" className={branch.id === current?.id ? 'active' : ''} onClick={() => select(branch)}>
        <span className="branch-switcher__pin"><MapPin size={14}/></span>
        <span><strong>{branch.name}</strong><small>{branch.city || branch.code || (branch.isPrimary ? 'Основной филиал' : 'Филиал')}</small></span>
        {branch.id === current?.id && <Check size={15}/>} 
      </button>)}</div>
    </div>}
  </div>;
}
