import { useEffect, useMemo, useState } from 'react';
import { KeyRound, LoaderCircle, LogOut, Pencil, ShieldCheck, Trash2, UserPlus, UserRound, UsersRound, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import AccessMatrixPanel from './AccessMatrixPanel';
import { DISPLAY_CURRENCIES, readDisplayCurrency, saveDisplayCurrency, type DisplayCurrency } from '../currency';
import { createManagedUser, fetchManagedUsers, removeManagedUser, updateManagedUser, type ManagedUser, type ManagedUserRole, type ManagedUserStatus } from '../services/userAdmin';
import '../user-workspace.css';

type Tab = 'profile' | 'security' | 'access' | 'users' | 'matrix';
type UserDraft = { id?: string; name: string; email: string; role: ManagedUserRole; status: ManagedUserStatus };
interface Props { mode: 'profile' | 'settings'; onClose: () => void }

const roleLabels: Record<ManagedUserRole, string> = { administrator: 'Администратор', marketer: 'Маркетолог', analyst: 'Аналитик', viewer: 'Наблюдатель' };
const statusLabels: Record<ManagedUserStatus, string> = { active: 'Активен', invited: 'Приглашён', blocked: 'Заблокирован' };
const emptyDraft: UserDraft = { name: '', email: '', role: 'viewer', status: 'active' };

export default function UserWorkspaceModal({ mode, onClose }: Props) {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>(mode === 'settings' ? 'users' : 'profile');
  const [currency, setCurrency] = useState<DisplayCurrency>(() => readDisplayCurrency());
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const initials = useMemo(() => (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), [user]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound; admin?: boolean }> = [
    { id: 'profile', label: 'Профиль', icon: UserRound },
    { id: 'security', label: 'Безопасность', icon: ShieldCheck },
    { id: 'access', label: 'Мой доступ', icon: KeyRound },
    { id: 'users', label: 'Пользователи', icon: UsersRound, admin: true },
    { id: 'matrix', label: 'Матрица прав', icon: ShieldCheck, admin: true },
  ];

  const loadUsers = async () => {
    setLoading(true); setError('');
    try { setUsers(await fetchManagedUsers()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if ((tab === 'users' || tab === 'matrix') && user.role === 'administrator') void loadUsers(); }, [tab, user.role]);

  const submitUser = async () => {
    if (!draft) return;
    setSaving(true); setError('');
    try {
      const saved = draft.id
        ? await updateManagedUser(draft.id, { name: draft.name, role: draft.role, status: draft.status })
        : await createManagedUser({ name: draft.name, email: draft.email, role: draft.role, status: draft.status });
      setUsers((current) => draft.id ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пользователя'); }
    finally { setSaving(false); }
  };

  const deleteUser = async (item: ManagedUser) => {
    if (!window.confirm(`Удалить доступ пользователя ${item.name}?`)) return;
    try { await removeManagedUser(item.id); setUsers((current) => current.filter((candidate) => candidate.id !== item.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить пользователя'); }
  };

  const effectivePermissions = user.permissions || {};
  const accessRows = Object.entries(effectivePermissions).filter(([, grant]) => grant.view || grant.manage);

  return <div className="user-workspace-layer" role="dialog" aria-modal="true">
    <button className="user-workspace-overlay" type="button" aria-label="Закрыть" onClick={onClose}/>
    <section className={`user-workspace user-workspace--${mode} ${tab === 'matrix' ? 'user-workspace--matrix' : ''}`}>
      <header><div className="user-workspace-avatar">{initials}</div><div><h2>{mode === 'settings' ? 'Настройки' : user.name}</h2><span>{user.jobTitle || (user.role === 'administrator' ? 'Администратор системы' : user.role)}</span></div><button type="button" onClick={onClose}><X size={20}/></button></header>
      <div className="user-workspace-body">
        <aside><nav>{tabs.filter((item) => !item.admin || user.role === 'administrator').map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16}/><span>{label}</span></button>)}</nav><button className="user-workspace-signout" type="button" onClick={() => void signOut()}><LogOut size={16}/>Выйти</button></aside>
        <main>
          {tab === 'profile' && <section><h3>Личные данные</h3><p>Профиль и рабочая должность.</p><div className="profile-card"><div className="user-workspace-avatar user-workspace-avatar--large">{initials}</div><div><strong>{user.name}</strong><span>{user.jobTitle || roleLabels[user.role as ManagedUserRole] || user.role}</span></div></div><div className="profile-grid"><label><span>Имя</span><input value={user.name || ''} readOnly/></label><label><span>Должность</span><input value={user.jobTitle || roleLabels[user.role as ManagedUserRole] || user.role} readOnly/></label><label className="profile-grid-full"><span>Email</span><input value={user.email || ''} readOnly/></label><label className="profile-grid-full"><span>Валюта</span><select value={currency} onChange={(event) => { const next = event.target.value as DisplayCurrency; setCurrency(next); saveDisplayCurrency(next); }}>{DISPLAY_CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></label></div></section>}
          {tab === 'security' && <section><h3>Безопасность</h3><p>Вход выполняется через защищённый Google OAuth. Пароли в IMDS не хранятся.</p><div className="workspace-card"><h4>Активная сессия</h4><div className="session-row"><div><strong>Текущая сессия</strong><span>Google OAuth · защищённый токен</span></div><em>Активна</em></div></div></section>}
          {tab === 'access' && <section><h3>Мой доступ</h3><p>Эффективные права с учётом должности и персональных исключений.</p><div className="access-list">{accessRows.length ? accessRows.map(([moduleId, grant]) => <div key={moduleId}><span>{moduleId}</span><em>{grant.manage ? 'Полное управление' : Object.entries(grant).filter(([, value]) => value).map(([key]) => key).join(', ')}</em></div>) : <div><span>Нет назначенных модулей</span><em>Ограничено</em></div>}</div></section>}
          {tab === 'users' && <section><div className="users-head"><div><h3>Пользователи системы</h3><p>Аккаунты, базовые роли, должности и статусы.</p></div><button type="button" onClick={() => setDraft(emptyDraft)}><UserPlus size={15}/>Добавить</button></div>{error && <div className="users-error">{error}</div>}{loading ? <div className="users-loading"><LoaderCircle className="spin"/>Загрузка…</div> : <div className="users-list">{users.map((item) => <article key={item.id}><div className="user-row-avatar">{item.name[0]?.toUpperCase()}</div><div><strong>{item.name}</strong><span>{item.email}</span><small>{item.jobTitle || 'Должность не назначена'}</small></div><b>{roleLabels[item.role]}</b><em className={`user-status user-status--${item.status}`}>{statusLabels[item.status]}</em><div className="user-row-actions"><button type="button" onClick={() => setDraft({ id:item.id,name:item.name,email:item.email,role:item.role,status:item.status })}><Pencil size={15}/></button><button type="button" onClick={() => void deleteUser(item)}><Trash2 size={15}/></button></div></article>)}</div>}</section>}
          {tab === 'matrix' && <AccessMatrixPanel users={users}/>} 
        </main>
      </div>
    </section>
    {draft && <div className="user-editor-layer" role="dialog" aria-modal="true"><button className="user-editor-overlay" type="button" onClick={() => setDraft(null)}/><form className="user-editor" onSubmit={(event) => { event.preventDefault(); void submitUser(); }}><header><div><h3>{draft.id ? 'Редактирование пользователя' : 'Добавление пользователя'}</h3><p>Точные права задаются в матрице доступа.</p></div><button type="button" onClick={() => setDraft(null)}><X size={18}/></button></header><label><span>Имя</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name:event.target.value })} required/></label><label><span>Email Google</span><input type="email" value={draft.email} readOnly={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, email:event.target.value })} required/></label><div className="user-editor-grid"><label><span>Базовая роль</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role:event.target.value as ManagedUserRole })}>{Object.entries(roleLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Статус</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status:event.target.value as ManagedUserStatus })}>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><footer><button type="button" onClick={() => setDraft(null)}>Отмена</button><button className="workspace-primary" type="submit" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button></footer></form></div>}
  </div>;
}
