import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Layers3, LoaderCircle, MapPin, Settings, X } from 'lucide-react';
import { activeBranchId, loadBranches, setActiveBranchId, type Branch } from '../services/branches';
import { useAuth } from './AuthGate';
import BranchManagementPanel from './BranchManagementPanel';
import './branch-switcher.css';

export default function BranchSwitcher() {
  const { user } = useAuth(); const rootRef=useRef<HTMLDivElement|null>(null);
  const [open,setOpen]=useState(false); const [manageOpen,setManageOpen]=useState(false); const [loading,setLoading]=useState(true);
  const [branches,setBranches]=useState<Branch[]>([]); const [restricted,setRestricted]=useState(false); const [canManage,setCanManage]=useState(false); const [allAvailable,setAllAvailable]=useState(false); const [error,setError]=useState('');
  const currentId=activeBranchId(); const allSelected=currentId==='all'&&allAvailable;
  const current=useMemo(()=>branches.find(item=>item.id===currentId)||branches.find(item=>item.isPrimary)||branches[0],[branches,currentId]);

  useEffect(()=>{let active=true;setLoading(true);loadBranches().then(result=>{if(!active)return;setBranches(result.items||[]);setRestricted(result.restricted);setCanManage(result.canManage);setAllAvailable(Boolean(result.allAvailable));const stored=activeBranchId();if(stored==='all'&&result.allAvailable){setError('');return;}const selected=result.items.find(item=>item.id===stored)||result.items.find(item=>item.isPrimary)||result.items[0];if(selected&&selected.id!==stored)setActiveBranchId(selected.id);setError('');}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[user.companyId]);
  useEffect(()=>{if(!open)return;const pointer=(event:PointerEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node))setOpen(false);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};},[open]);
  if(!loading&&branches.length<=1&&!error&&!canManage)return null;
  const choose=(id:string)=>{if(id===currentId){setOpen(false);return;}setActiveBranchId(id);window.location.reload();};

  return <>
    <div className="branch-switcher" ref={rootRef}>
      <button className="branch-switcher__trigger" type="button" aria-haspopup="dialog" aria-expanded={open} title="Активный филиал" onClick={()=>setOpen(v=>!v)}>
        <span className="branch-switcher__icon">{loading?<LoaderCircle className="spin" size={15}/>:allSelected?<Layers3 size={15}/>:<GitBranch size={15}/>}</span>
        <span><small>Филиал</small><strong>{allSelected?'Все филиалы':current?.name||'Выбрать'}</strong></span><ChevronDown size={14}/>
      </button>
      {open&&<div className="branch-switcher__popover" role="dialog" aria-label="Выбор филиала">
        <div className="branch-switcher__head"><div><strong>Филиалы</strong><span>{restricted?'Назначенные вам':`${branches.length} доступно`}</span></div><button type="button" aria-label="Закрыть" onClick={()=>setOpen(false)}><X size={15}/></button></div>
        {error&&<div className="branch-switcher__error">{error}</div>}
        <div className="branch-switcher__list">
          {allAvailable&&<button type="button" className={allSelected?'active':''} onClick={()=>choose('all')}><span className="branch-switcher__pin"><Layers3 size={14}/></span><span><strong>Все филиалы</strong><small>Общий обзор и аналитика клиники</small></span>{allSelected&&<Check size={15}/>}</button>}
          {branches.map(branch=><button key={branch.id} type="button" className={!allSelected&&branch.id===current?.id?'active':''} onClick={()=>choose(branch.id)}><span className="branch-switcher__pin"><MapPin size={14}/></span><span><strong>{branch.name}</strong><small>{branch.city||branch.code||(branch.isPrimary?'Основной филиал':'Филиал')}</small></span>{!allSelected&&branch.id===current?.id&&<Check size={15}/>}</button>)}
        </div>
        {canManage&&<button className="branch-switcher__manage" type="button" onClick={()=>{setOpen(false);setManageOpen(true);}}><Settings size={14}/>Управление филиалами</button>}
      </div>}
    </div>
    {manageOpen&&<div className="branch-manager-layer" role="dialog" aria-modal="true" aria-label="Управление филиалами"><button className="branch-manager-overlay" type="button" aria-label="Закрыть" onClick={()=>setManageOpen(false)}/><section className="branch-manager-modal"><header><div><strong>Филиалы клиники</strong><span>Структура, основной филиал и сравнительная аналитика</span></div><button type="button" aria-label="Закрыть" onClick={()=>setManageOpen(false)}><X size={18}/></button></header><div className="branch-manager-content"><BranchManagementPanel/></div></section></div>}
  </>;
}
