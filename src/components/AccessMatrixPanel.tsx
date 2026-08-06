import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, ShieldCheck, UserRoundCog } from 'lucide-react';
import type { ManagedUser } from '../services/userAdmin';
import {
  assignUserAccess,
  createAccessPosition,
  fetchAccessWorkspace,
  savePositionPermissions,
  saveUserOverrides,
  type AccessAction,
  type AccessGrant,
  type AccessWorkspace,
  type NullableAccessGrant,
} from '../services/accessAdmin';

const ACTIONS: Array<{ id: AccessAction; label: string }> = [
  { id: 'view', label: 'Просмотр' },
  { id: 'create', label: 'Создание' },
  { id: 'edit', label: 'Изменение' },
  { id: 'delete', label: 'Удаление' },
  { id: 'export', label: 'Экспорт' },
  { id: 'manage', label: 'Управление' },
];
const emptyGrant = (): AccessGrant => ({ view: false, create: false, edit: false, delete: false, export: false, manage: false });
const emptyOverride = (): NullableAccessGrant => ({ view: null, create: null, edit: null, delete: null, export: null, manage: null });

export default function AccessMatrixPanel({ users }: { users: ManagedUser[] }) {
  const [workspace, setWorkspace] = useState<AccessWorkspace | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [positionDraft, setPositionDraft] = useState<Record<string, AccessGrant>>({});
  const [overrideDraft, setOverrideDraft] = useState<Record<string, NullableAccessGrant>>({});
  const [jobTitle, setJobTitle] = useState('');
  const [assignedPositionId, setAssignedPositionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'positions' | 'users'>('positions');

  const load = async () => {
    setBusy(true); setError('');
    try {
      const next = await fetchAccessWorkspace();
      setWorkspace(next);
      setSelectedPositionId((current) => current || next.positions[0]?.id || '');
      setSelectedUserId((current) => current || users[0]?.id || '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить матрицу'); }
    finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, []);

  const selectedPosition = workspace?.positions.find((item) => item.id === selectedPositionId);
  const selectedUser = users.find((item) => item.id === selectedUserId);
  const assignment = workspace?.assignments.find((item) => item.user_id === selectedUserId);

  useEffect(() => {
    if (!workspace || !selectedPositionId) return;
    const next: Record<string, AccessGrant> = {};
    for (const module of workspace.modules) {
      const row = workspace.permissions.find((item) => item.position_id === selectedPositionId && item.module_id === module.id);
      next[module.id] = row ? {
        view: row.can_view, create: row.can_create, edit: row.can_edit,
        delete: row.can_delete, export: row.can_export, manage: row.can_manage,
      } : emptyGrant();
    }
    setPositionDraft(next);
  }, [workspace, selectedPositionId]);

  useEffect(() => {
    if (!workspace || !selectedUserId) return;
    const next: Record<string, NullableAccessGrant> = {};
    for (const module of workspace.modules) {
      const row = workspace.overrides.find((item) => item.user_id === selectedUserId && item.module_id === module.id);
      next[module.id] = row ? {
        view: row.can_view, create: row.can_create, edit: row.can_edit,
        delete: row.can_delete, export: row.can_export, manage: row.can_manage,
      } : emptyOverride();
    }
    setOverrideDraft(next);
    const current = workspace.assignments.find((item) => item.user_id === selectedUserId);
    setAssignedPositionId(current?.position_id || '');
    setJobTitle(current?.job_title || selectedUser?.jobTitle || '');
  }, [workspace, selectedUserId, selectedUser?.jobTitle]);

  const groupedModules = useMemo(() => {
    const map = new Map<string, AccessWorkspace['modules']>();
    for (const module of workspace?.modules || []) map.set(module.category, [...(map.get(module.category) || []), module]);
    return [...map.entries()];
  }, [workspace]);

  const addPosition = async () => {
    const name = window.prompt('Название новой должности');
    if (!name?.trim()) return;
    setBusy(true); setError('');
    try { const result = await createAccessPosition({ name: name.trim() }); await load(); setSelectedPositionId(result.position.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать должность'); setBusy(false); }
  };

  const savePosition = async () => {
    if (!selectedPositionId || !workspace) return;
    setBusy(true); setError('');
    try {
      await savePositionPermissions(selectedPositionId, workspace.modules.map((module) => ({ moduleId: module.id, ...(positionDraft[module.id] || emptyGrant()) })));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить права'); }
    finally { setBusy(false); }
  };

  const saveUser = async () => {
    if (!selectedUserId || !workspace) return;
    setBusy(true); setError('');
    try {
      await assignUserAccess(selectedUserId, { positionId: assignedPositionId || null, jobTitle: jobTitle || null });
      await saveUserOverrides(selectedUserId, workspace.modules.map((module) => ({ moduleId: module.id, ...(overrideDraft[module.id] || emptyOverride()) })));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить индивидуальный доступ'); }
    finally { setBusy(false); }
  };

  if (busy && !workspace) return <div className="access-matrix-loading"><LoaderCircle className="spin"/>Загрузка матрицы прав…</div>;
  if (!workspace) return <div className="users-error">{error || 'Матрица прав недоступна'}</div>;

  return <section className="access-matrix-panel">
    <div className="access-matrix-head">
      <div><h3>Матрица прав доступа</h3><p>Должности задают базовые права. Индивидуальные настройки конкретного пользователя имеют приоритет.</p></div>
      <div className="access-mode-switch"><button className={mode === 'positions' ? 'active' : ''} onClick={() => setMode('positions')}><ShieldCheck size={15}/>Должности</button><button className={mode === 'users' ? 'active' : ''} onClick={() => setMode('users')}><UserRoundCog size={15}/>По пользователям</button></div>
    </div>
    {error && <div className="users-error">{error}</div>}

    {mode === 'positions' ? <>
      <div className="access-toolbar"><select value={selectedPositionId} onChange={(event) => setSelectedPositionId(event.target.value)}>{workspace.positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={() => void addPosition()}><Plus size={15}/>Новая должность</button><button className="workspace-primary" type="button" onClick={() => void savePosition()} disabled={busy}><Save size={15}/>{busy ? 'Сохранение…' : 'Сохранить матрицу'}</button></div>
      {selectedPosition && <div className="access-position-note"><strong>{selectedPosition.name}</strong><span>{selectedPosition.description || 'Пользовательская должность'}</span></div>}
      <Matrix modules={groupedModules} values={positionDraft} nullable={false} onChange={(moduleId, action, value) => setPositionDraft((current) => ({ ...current, [moduleId]: { ...(current[moduleId] || emptyGrant()), [action]: Boolean(value) } }))}/>
    </> : <>
      <div className="access-toolbar access-toolbar--user"><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>{users.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.email}</option>)}</select><select value={assignedPositionId} onChange={(event) => setAssignedPositionId(event.target.value)}><option value="">Без должности</option>{workspace.positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Название должности для отображения"/><button className="workspace-primary" type="button" onClick={() => void saveUser()} disabled={busy}><Save size={15}/>{busy ? 'Сохранение…' : 'Сохранить доступ'}</button></div>
      <div className="access-position-note"><strong>{selectedUser?.name || 'Пользователь'}</strong><span>Пустое значение наследуется от должности; «Разрешить» или «Запретить» создаёт персональное исключение.</span></div>
      <Matrix modules={groupedModules} values={overrideDraft} nullable onChange={(moduleId, action, value) => setOverrideDraft((current) => ({ ...current, [moduleId]: { ...(current[moduleId] || emptyOverride()), [action]: value } }))}/>
    </>}
  </section>;
}

function Matrix({ modules, values, nullable, onChange }: {
  modules: Array<[string, AccessWorkspace['modules']]>;
  values: Record<string, AccessGrant | NullableAccessGrant>;
  nullable: boolean;
  onChange: (moduleId: string, action: AccessAction, value: boolean | null) => void;
}) {
  return <div className="access-matrix-scroll"><table className="access-matrix-table"><thead><tr><th>Модуль</th>{ACTIONS.map((action) => <th key={action.id}>{action.label}</th>)}</tr></thead><tbody>{modules.map(([category, items]) => [<tr className="access-category" key={`${category}-head`}><td colSpan={7}>{category}</td></tr>, ...items.map((module) => <tr key={module.id}><td><strong>{module.navigation_label || module.name}</strong><span>{module.description}</span></td>{ACTIONS.map((action) => {
    const supported = module.metadata?.access_actions?.includes(action.id) ?? true;
    const value = values[module.id]?.[action.id];
    return <td key={action.id}>{supported ? nullable ? <select value={value === null ? 'inherit' : value ? 'allow' : 'deny'} onChange={(event) => onChange(module.id, action.id, event.target.value === 'inherit' ? null : event.target.value === 'allow')}><option value="inherit">Наследовать</option><option value="allow">Разрешить</option><option value="deny">Запретить</option></select> : <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(module.id, action.id, event.target.checked)}/> : <span className="access-na">—</span>}</td>;
  })}</tr>)]).flat()}</tbody></table></div>;
}
