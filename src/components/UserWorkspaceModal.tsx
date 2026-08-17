import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, CreditCard, KeyRound, Laptop, LoaderCircle, LockKeyhole, LogOut, Pencil, Save, ShieldCheck, Trash2, UserPlus, UserRound, UsersRound, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import AccessMatrixPanel from './AccessMatrixPanel';
import { DISPLAY_CURRENCIES, readDisplayCurrency, saveDisplayCurrency, type DisplayCurrency } from '../currency';
import { changeAccountPassword, loadAccountProfile, loadAccountSessions, revokeAccountSession, revokeOtherAccountSessions, saveAccountProfile, type AccountProfile, type AccountSession } from '../services/account';
import { loadPlatformEntitlements, type PlatformEntitlements } from '../services/platformEntitlements';
import { createManagedUser, fetchManagedUsers, removeManagedUser, updateManagedUser, type ManagedUser, type ManagedUserRole, type ManagedUserStatus } from '../services/userAdmin';
import '../user-workspace.css';

type PersonalTab = 'profile' | 'clinics' | 'security' | 'preferences' | 'access';
type OrgTab = 'clinic' | 'users' | 'matrix' | 'subscription';
type Tab = PersonalTab | OrgTab;
type UserDraft = { id?: string; name: string; email: string; role: ManagedUserRole; status: ManagedUserStatus };
interface Props { mode: 'profile' | 'settings'; onClose: () => void }

const roleLabels: Record<string, string> = { owner: 'Владелец', administrator: 'Администратор', manager: 'Менеджер', marketer: 'Маркетолог', operator: 'Оператор', analyst: 'Аналитик', viewer: 'Наблюдатель', super_admin: 'Super Admin' };
const managedRoleLabels: Record<ManagedUserRole, string> = { administrator: 'Администратор', marketer: 'Маркетолог', analyst: 'Аналитик', viewer: 'Наблюдатель' };
const statusLabels: Record<ManagedUserStatus, string> = { active: 'Активен', invited: 'Приглашён', blocked: 'Заблокирован' };
const moduleLabels: Record<string, string> = { dashboard: 'Dashboard', 'work.tasks': 'Задачи', 'communications.chat': 'Входящие и WhatsApp', 'communications.calls': 'Телефония', 'crm.leads': 'CRM и лиды', 'crm.pipeline': 'Воронка продаж', advertising: 'Реклама', 'analytics.attribution': 'Атрибуция', 'analytics.reports': 'Аналитика', integrations: 'Интеграции', audit: 'Аудит', team: 'Пользователи и доступы' };
const emptyDraft: UserDraft = { name: '', email: '', role: 'viewer', status: 'active' };

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export default function UserWorkspaceModal({ mode, onClose }: Props) {
  const { user, signOut, switchCompany } = useAuth();
  const [tab, setTab] = useState<Tab>(mode === 'settings' ? 'clinic' : 'profile');
  const [currency, setCurrency] = useState<DisplayCurrency>(() => readDisplayCurrency());
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState({ name: user.name || '', phone: '', locale: 'ru', timezone: 'Asia/Almaty' });
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [platform, setPlatform] = useState<PlatformEntitlements | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const initials = useMemo(() => (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), [user]);
  const currentCompany = user.companies?.find((company) => company.id === user.companyId) || user.companies?.[0];

  const personalTabs: Array<{ id: PersonalTab; label: string; icon: typeof UserRound }> = [
    { id: 'profile', label: 'Профиль', icon: UserRound },
    { id: 'clinics', label: 'Мои клиники', icon: Building2 },
    { id: 'security', label: 'Безопасность', icon: ShieldCheck },
    { id: 'preferences', label: 'Настройки', icon: Pencil },
    { id: 'access', label: 'Мой доступ', icon: KeyRound },
  ];
  const orgTabs: Array<{ id: OrgTab; label: string; icon: typeof Building2 }> = [
    { id: 'clinic', label: 'Клиника', icon: Building2 },
    { id: 'users', label: 'Пользователи', icon: UsersRound },
    { id: 'matrix', label: 'Матрица прав', icon: ShieldCheck },
    { id: 'subscription', label: 'Подписка', icon: CreditCard },
  ];
  const tabs = mode === 'settings' ? orgTabs : personalTabs;

  const loadProfile = async () => {
    setLoading(true); setError('');
    try {
      const next = await loadAccountProfile();
      setProfile(next);
      setProfileDraft({ name: next.name, phone: next.phone || '', locale: next.locale || 'ru', timezone: next.timezone || 'Asia/Almaty' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить профиль'); }
    finally { setLoading(false); }
  };
  const loadUsers = async () => {
    setLoading(true); setError('');
    try { setUsers(await fetchManagedUsers()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей'); }
    finally { setLoading(false); }
  };
  const loadSecurity = async () => {
    setLoading(true); setError('');
    try { setSessions(await loadAccountSessions()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сессии'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (mode === 'profile' && !profile) void loadProfile();
  }, [mode]);
  useEffect(() => {
    if (tab === 'security') void loadSecurity();
    if ((tab === 'users' || tab === 'matrix') && user.role === 'administrator') void loadUsers();
    if (tab === 'subscription') void loadPlatformEntitlements().then(setPlatform).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [tab, user.role]);

  const saveProfile = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const next = await saveAccountProfile(profileDraft);
      setProfile(next); setNotice('Профиль сохранён.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить профиль'); }
    finally { setSaving(false); }
  };
  const submitPassword = async () => {
    if (passwords.next !== passwords.confirm) { setError('Новые пароли не совпадают'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await changeAccountPassword(passwords.current, passwords.next);
      setPasswords({ current: '', next: '', confirm: '' });
      setNotice('Пароль изменён. Другие активные сессии завершены.');
      await loadSecurity();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить пароль'); }
    finally { setSaving(false); }
  };
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

  const accessRows = Object.entries(user.permissions || {}).filter(([, grant]) => grant.view || grant.manage);
  const fullAccess = user.platformRole === 'super_admin' || user.role === 'administrator' || ['owner', 'administrator'].includes(currentCompany?.role || '');

  return <div className="user-workspace-layer" role="dialog" aria-modal="true" aria-label={mode === 'settings' ? 'Настройки организации' : 'Личный кабинет'}>
    <button className="user-workspace-overlay" type="button" aria-label="Закрыть" onClick={onClose}/>
    <section className={`user-workspace user-workspace--${mode} ${tab === 'matrix' ? 'user-workspace--matrix' : ''}`}>
      <header><div className="user-workspace-avatar">{profile?.avatarUrl || user.avatarUrl ? <img src={profile?.avatarUrl || user.avatarUrl || ''} alt=""/> : initials}</div><div><h2>{mode === 'settings' ? 'Настройки организации' : profile?.name || user.name}</h2><span>{mode === 'settings' ? currentCompany?.name || 'Текущая клиника' : user.platformRole === 'super_admin' ? 'Super Admin' : user.jobTitle || roleLabels[currentCompany?.role || user.role] || user.role}</span></div><button type="button" aria-label="Закрыть" onClick={onClose}><X size={20}/></button></header>
      <div className="user-workspace-body">
        <aside><nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); setNotice(''); }}><Icon size={16}/><span>{label}</span></button>)}</nav><button className="user-workspace-signout" type="button" onClick={() => void signOut()}><LogOut size={16}/>Выйти</button></aside>
        <main>
          {error && <div className="workspace-message workspace-message--error">{error}</div>}
          {notice && <div className="workspace-message workspace-message--notice">{notice}</div>}
          {loading && <div className="users-loading"><LoaderCircle className="spin"/>Загрузка…</div>}

          {tab === 'profile' && !loading && <section><h3>Личные данные</h3><p>Данные вашего IMDS Account. Email меняется только через подтверждённый процесс.</p><div className="profile-card"><div className="user-workspace-avatar user-workspace-avatar--large">{profile?.avatarUrl || user.avatarUrl ? <img src={profile?.avatarUrl || user.avatarUrl || ''} alt=""/> : initials}</div><div><strong>{profile?.name || user.name}</strong><span>{profile?.providers?.length ? `Вход: ${profile.providers.join(' · ')}` : 'IMDS Account'}</span></div>{profile?.emailVerified && <em><CheckCircle2 size={14}/> Email подтверждён</em>}</div><div className="profile-grid"><label><span>Имя</span><input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label><span>Телефон</span><input value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} placeholder="+7 700 000 00 00"/></label><label className="profile-grid-full"><span>Email</span><input value={profile?.email || user.email || ''} readOnly/></label></div><div className="workspace-actions"><button className="workspace-primary" type="button" disabled={saving} onClick={() => void saveProfile()}><Save size={15}/>{saving ? 'Сохранение…' : 'Сохранить'}</button></div></section>}

          {tab === 'clinics' && <section><h3>Мои клиники</h3><p>Переключение происходит в одном IMDS Account. Новая регистрация не требуется.</p><div className="clinic-account-list">{(user.companies || []).map((company) => <button key={company.id} type="button" className={company.id === user.companyId ? 'active' : ''} onClick={() => void switchCompany(company.id)}><span><Building2 size={17}/></span><div><strong>{company.name}</strong><small>{roleLabels[company.role] || company.role}{company.accessSource === 'platform' ? ' · platform access' : ''}</small></div>{company.id === user.companyId && <CheckCircle2 size={17}/>}</button>)}</div><div className="workspace-note">Добавление новой клиники и присоединение по коду доступны прямо в переключателе клиник в верхней панели.</div></section>}

          {tab === 'security' && !loading && <section><h3>Безопасность</h3><p>Способы входа, пароль и активные устройства IMDS Account.</p><div className="workspace-card"><h4>Способы входа</h4><div className="provider-list">{(profile?.providers || []).map((provider) => <span key={provider}><ShieldCheck size={14}/>{provider === 'password' ? 'Email и пароль' : provider === 'google' ? 'Google' : provider}</span>)}</div></div>{profile?.providers?.includes('password') && <div className="workspace-card"><h4>Изменить пароль</h4><div className="password-grid"><input type="password" autoComplete="current-password" placeholder="Текущий пароль" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}/><input type="password" autoComplete="new-password" placeholder="Новый пароль · минимум 10 символов" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}/><input type="password" autoComplete="new-password" placeholder="Повторите новый пароль" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}/><button className="workspace-primary" type="button" disabled={saving || passwords.next.length < 10} onClick={() => void submitPassword()}><LockKeyhole size={15}/>Изменить пароль</button></div></div>}<div className="workspace-card"><div className="workspace-card-head"><h4>Активные сессии</h4><button type="button" onClick={() => void revokeOtherAccountSessions().then(async (count) => { setNotice(`Завершено сессий: ${count}`); await loadSecurity(); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>Завершить другие</button></div><div className="session-list">{sessions.map((session) => <div className="session-row" key={session.id}><Laptop size={17}/><div><strong>{session.current ? 'Текущее устройство' : session.userAgent}</strong><span>{session.current ? session.userAgent : `Последняя активность: ${formatDate(session.lastSeenAt)}`}</span><small>Действует до {formatDate(session.expiresAt)}</small></div>{session.current ? <em>Текущая</em> : <button type="button" aria-label="Завершить сессию" onClick={() => void revokeAccountSession(session.id).then(loadSecurity).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}><Trash2 size={15}/></button>}</div>)}</div></div></section>}

          {tab === 'preferences' && <section><h3>Настройки аккаунта</h3><p>Персональные настройки интерфейса, не влияющие на других пользователей клиники.</p><div className="profile-grid"><label><span>Язык</span><select value={profileDraft.locale} onChange={(event) => setProfileDraft({ ...profileDraft, locale: event.target.value })}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label><label><span>Часовой пояс</span><select value={profileDraft.timezone} onChange={(event) => setProfileDraft({ ...profileDraft, timezone: event.target.value })}><option value="Asia/Almaty">Asia/Almaty</option><option value="Asia/Aqtobe">Asia/Aqtobe</option><option value="UTC">UTC</option></select></label><label className="profile-grid-full"><span>Валюта отображения</span><select value={currency} onChange={(event) => { const next = event.target.value as DisplayCurrency; setCurrency(next); saveDisplayCurrency(next); }}>{DISPLAY_CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></label></div><div className="workspace-actions"><button className="workspace-primary" type="button" disabled={saving} onClick={() => void saveProfile()}><Save size={15}/>Сохранить настройки</button></div></section>}

          {tab === 'access' && <section><h3>Мой доступ</h3><p>Эффективные права в текущей клинике.</p>{fullAccess ? <div className="full-access-card"><ShieldCheck size={22}/><div><strong>Полный доступ</strong><span>{user.platformRole === 'super_admin' ? 'Доступ предоставлен ролью Super Admin платформы.' : `Доступ предоставлен ролью ${roleLabels[currentCompany?.role || user.role] || user.role}.`}</span></div></div> : <div className="access-list">{accessRows.length ? accessRows.map(([moduleId, grant]) => <div key={moduleId}><span>{moduleLabels[moduleId] || moduleId}</span><em>{grant.manage ? 'Полное управление' : Object.entries(grant).filter(([, value]) => value).map(([key]) => key).join(', ')}</em></div>) : <div><span>Нет назначенных модулей</span><em>Ограниченный доступ</em></div>}</div>}</section>}

          {tab === 'clinic' && <section><h3>Текущая клиника</h3><p>Администрирование tenant-контекста. Личные настройки пользователя находятся в отдельном личном кабинете.</p><div className="organization-summary"><span><Building2 size={21}/></span><div><strong>{currentCompany?.name || 'Клиника не выбрана'}</strong><small>{roleLabels[currentCompany?.role || ''] || currentCompany?.role}</small></div></div>{currentCompany && <div className="access-list"><div><span>Tenant ID</span><em>{currentCompany.id}</em></div><div><span>Адрес</span><em>{currentCompany.slug || '—'}</em></div><div><span>Статус</span><em>{currentCompany.status}</em></div></div>}</section>}

          {tab === 'users' && <section><div className="users-head"><div><h3>Пользователи клиники</h3><p>Аккаунты и базовые роли текущей клиники.</p></div><button type="button" onClick={() => setDraft(emptyDraft)}><UserPlus size={15}/>Добавить</button></div>{!loading && <div className="users-list">{users.map((item) => <article key={item.id}><div className="user-row-avatar">{item.name[0]?.toUpperCase()}</div><div><strong>{item.name}</strong><span>{item.email}</span><small>{item.jobTitle || 'Должность не назначена'}</small></div><b>{managedRoleLabels[item.role]}</b><em className={`user-status user-status--${item.status}`}>{statusLabels[item.status]}</em><div className="user-row-actions"><button type="button" onClick={() => setDraft({ id:item.id,name:item.name,email:item.email,role:item.role,status:item.status })}><Pencil size={15}/></button><button type="button" onClick={() => void deleteUser(item)}><Trash2 size={15}/></button></div></article>)}</div>}</section>}
          {tab === 'matrix' && <AccessMatrixPanel users={users}/>} 
          {tab === 'subscription' && <section><h3>Подписка и оплата</h3><p>Marketing получает доступы от IMDS Platform через entitlements; тарифные проверки не зашиты в модули.</p><div className="subscription-card"><div><CreditCard size={22}/><span><strong>BELES</strong><small>{platform?.managed ? 'Управляется IMDS Platform' : 'Локальный trial / fallback'}</small></span></div><b>{platform?.billing?.subscriptionStatus || '—'}</b></div><div className="access-list"><div><span>Период до</span><em>{formatDate(platform?.billing?.periodEndsAt || platform?.billing?.accessEndsAt)}</em></div><div><span>Trial до</span><em>{formatDate(platform?.billing?.trialEndsAt)}</em></div><div><span>Валюта</span><em>{platform?.billing?.currency || 'KZT'}</em></div><div><span>Продление</span><em>{platform?.billing?.renewalMode || 'manual'}</em></div></div>{platform?.billing?.paymentMethods?.length ? <div className="payment-method-list">{platform.billing.paymentMethods.map((method) => <div key={method.method}><CreditCard size={16}/><span><strong>{method.displayName}</strong><small>{method.instructions || (method.isDefault ? 'Основной способ оплаты' : '')}</small></span></div>)}</div> : <div className="workspace-note">Платёжный провайдер не привязан к Marketing. Способы оплаты поступают из IMDS Platform/Control Plane.</div>}</section>}
        </main>
      </div>
    </section>
    {draft && <div className="user-editor-layer" role="dialog" aria-modal="true"><button className="user-editor-overlay" type="button" onClick={() => setDraft(null)}/><form className="user-editor" onSubmit={(event) => { event.preventDefault(); void submitUser(); }}><header><div><h3>{draft.id ? 'Редактирование пользователя' : 'Добавление пользователя'}</h3><p>Точные права задаются в матрице доступа.</p></div><button type="button" onClick={() => setDraft(null)}><X size={18}/></button></header><label><span>Имя</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name:event.target.value })} required/></label><label><span>Email</span><input type="email" value={draft.email} readOnly={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, email:event.target.value })} required/></label><div className="user-editor-grid"><label><span>Базовая роль</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role:event.target.value as ManagedUserRole })}>{Object.entries(managedRoleLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Статус</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status:event.target.value as ManagedUserStatus })}>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><footer><button type="button" onClick={() => setDraft(null)}>Отмена</button><button className="workspace-primary" type="submit" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button></footer></form></div>}
  </div>;
}
