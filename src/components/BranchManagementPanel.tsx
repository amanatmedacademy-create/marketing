import { useEffect, useState } from 'react';
import { Archive, Building2, CheckCircle2, LoaderCircle, MapPin, Plus, Save, Star } from 'lucide-react';
import { archiveBranch, createBranch, loadBranches, setPrimaryBranch, updateBranch, type Branch } from '../services/branches';
import './branch-management.css';

const emptyDraft = { name: '', code: '', city: '', address: '', phone: '', timezone: 'Asia/Almaty' };

export default function BranchManagementPanel() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    setLoading(true); setError('');
    try { const result = await loadBranches(); setBranches(result.items || []); setCanManage(result.canManage); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    setBusy('create'); setError(''); setNotice('');
    try { await createBranch(draft); setDraft(emptyDraft); setCreating(false); setNotice('Филиал создан.'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  const patch = async (branch: Branch, input: Partial<Branch>) => {
    setBusy(branch.id); setError(''); setNotice('');
    try { await updateBranch(branch.id, input); setNotice('Филиал обновлён.'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="users-loading"><LoaderCircle className="spin"/>Загрузка филиалов…</div>;

  return <section className="branch-admin">
    <div className="branch-admin__title"><div><h3>Филиалы</h3><p>Операционный уровень внутри текущей клиники. CRM tenant остаётся единым для клиники.</p></div>{canManage && <button className="workspace-primary" type="button" onClick={() => setCreating((value) => !value)}><Plus size={15}/>Добавить филиал</button>}</div>
    {error && <div className="workspace-message workspace-message--error">{error}</div>}
    {notice && <div className="workspace-message workspace-message--notice">{notice}</div>}

    {creating && canManage && <div className="workspace-card branch-admin__create">
      <h4>Новый филиал</h4>
      <div className="branch-admin__form"><input placeholder="Название" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/><input placeholder="Код, например ALM-02" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}/><input placeholder="Город" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })}/><input placeholder="Адрес" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })}/><input placeholder="Телефон" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}/><select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}><option value="Asia/Almaty">Asia/Almaty</option><option value="Asia/Aqtobe">Asia/Aqtobe</option><option value="UTC">UTC</option></select></div>
      <div className="workspace-actions"><button type="button" onClick={() => { setCreating(false); setDraft(emptyDraft); }}>Отмена</button><button className="workspace-primary" type="button" disabled={busy === 'create' || draft.name.trim().length < 2} onClick={() => void create()}><Save size={14}/>{busy === 'create' ? 'Создание…' : 'Создать'}</button></div>
    </div>}

    <div className="branch-admin__grid">{branches.map((branch) => <article className="workspace-card branch-admin__card" key={branch.id}>
      <div className="branch-admin__head"><span className="branch-admin__icon"><Building2 size={19}/></span><div><strong>{branch.name}</strong><small>{branch.code || 'Без кода'} · {branch.status === 'active' ? 'Активен' : 'Неактивен'}</small></div>{branch.isPrimary && <em><CheckCircle2 size={13}/>Основной</em>}</div>
      <div className="branch-admin__facts"><span><MapPin size={13}/>{branch.city || 'Город не указан'}{branch.address ? ` · ${branch.address}` : ''}</span><span>Сотрудников: {branch.memberCount}</span><span>{branch.timezone}</span></div>
      {canManage && <div className="branch-admin__actions">
        {!branch.isPrimary && <button type="button" disabled={busy === branch.id} onClick={() => void setPrimaryBranch(branch.id).then(refresh).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}><Star size={13}/>Сделать основным</button>}
        <button type="button" disabled={busy === branch.id} onClick={() => void patch(branch, { status: branch.status === 'active' ? 'inactive' : 'active' })}>{branch.status === 'active' ? 'Приостановить' : 'Активировать'}</button>
        {!branch.isPrimary && <button className="danger" type="button" disabled={busy === branch.id} onClick={() => void archiveBranch(branch.id).then(refresh).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}><Archive size={13}/>Архивировать</button>}
      </div>}
    </article>)}</div>
  </section>;
}
