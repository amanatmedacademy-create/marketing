import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, CreditCard, KeyRound, Laptop, LoaderCircle, LockKeyhole, LogOut, Pencil, Save, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import AccessMatrixPanel from './AccessMatrixPanel';
import TeamAdministrationPanel from './TeamAdministrationPanel';
import BillingCenterPanel from './BillingCenterPanel';
import AccountSecurityPanel from './AccountSecurityPanel';
import ClinicSettingsPanel from './ClinicSettingsPanel';
import { DISPLAY_CURRENCIES, readDisplayCurrency, saveDisplayCurrency, type DisplayCurrency } from '../currency';
import { changeAccountPassword, loadAccountProfile, loadAccountSessions, revokeAccountSession, revokeOtherAccountSessions, saveAccountProfile, type AccountProfile, type AccountSession } from '../services/account';
import { fetchManagedUsers, type ManagedUser } from '../services/userAdmin';
import '../user-workspace.css';

type PersonalTab = 'profile' | 'clinics' | 'security' | 'preferences' | 'access';
type OrgTab = 'clinic' | 'users' | 'matrix' | 'subscription';
type Tab = PersonalTab | OrgTab;
interface Props { mode: 'profile' | 'settings'; onClose: () => void }

const roleLabels: Record<string, string> = { owner: 'Владелец', administrator: 'Администратор', manager: 'Менеджер', marketer: 'Маркетолог', operator: 'Оператор', analyst: 'Аналитик', viewer: 'Наблюдатель', super_admin: 'Super Admin' };
const moduleLabels: Record<string, string> = { dashboard: 'Dashboard', 'work.tasks': 'Задачи', 'communications.chat': 'Входящие и WhatsApp', 'communications.calls': 'Телефония', 'crm.leads': 'CRM и лиды', 'crm.pipeline': 'Воронка продаж', advertising: 'Реклама', 'analytics.attribution': 'Атрибуция', 'analytics.reports': 'Аналитика', integrations: 'Интеграции', audit: 'Аудит', team: 'Пользователи и доступы' };

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
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
    { id: 'users', label: 'Команда', icon: UsersRound },
    { id: 'matrix', label: 'Матрица прав', icon: ShieldCheck },
    { id: 'subscription', label: 'Billing', icon: CreditCard },
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
  const loadSecurity = async () => {
    setLoading(true); setError('');
    try { setSessions(await loadAccountSessions()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сессии'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (mode === 'profile' && !profile) void loadProfile(); }, [mode]);
  useEffect(() => {
    if (tab === 'security') void loadSecurity();
    if (tab === 'matrix') void fetchManagedUsers().then(setUsers).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [tab, user.companyId]);

  const saveProfile = async () => {
    setSaving(true); setError(''); setNotice('');
    try { const next = await saveAccountProfile(profileDraft); setProfile(next); setNotice('Профиль сохранён.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить профиль'); }
    finally { setSaving(false); }
  };
  const submitPassword = async () => {
    if (passwords.next !== passwords.confirm) { setError('Новые пароли не совпадают'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await changeAccountPassword(passwords.current, passwords.next);
      setPasswords({ current: '', next: '', confirm: '' }); setNotice('Пароль изменён. Другие активные сессии завершены.'); await loadSecurity();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить пароль'); }
    finally { setSaving(false); }
  };

  const accessRows = Object.entries(user.permissions || {}).filter(([, grant]) => grant.view || grant.manage);
  const fullAccess = user.platformRole === 'super_admin' || ['owner', 'administrator'].includes(currentCompany?.role || '');

  return <div className="user-workspace-layer" role="dialog" aria-modal="true" aria-label={mode === 'settings' ? 'Настройки организации' : 'Личный кабинет'}>
    <button className="user-workspace-overlay" type="button" aria-label="Закрыть" onClick={onClose}/>
    <section className={`user-workspace user-workspace--${mode} ${tab === 'matrix' || tab === 'subscription' ? 'user-workspace--matrix' : ''}`}>
      <header><div className="user-workspace-avatar">{profile?.avatarUrl || user.avatarUrl ? <img src={profile?.avatarUrl || user.avatarUrl || ''} alt=""/> : initials}</div><div><h2>{mode === 'settings' ? 'Настройки организации' : profile?.name || user.name}</h2><span>{mode === 'settings' ? currentCompany?.name || 'Текущая клиника' : user.platformRole === 'super_admin' ? 'Super Admin' : user.jobTitle || roleLabels[currentCompany?.role || user.role] || user.role}</span></div><button type="button" aria-label="Закрыть" onClick={onClose}><X size={20}/></button></header>
      <div className="user-workspace-body">
        <aside><nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); setNotice(''); }}><Icon size={16}/><span>{label}</span></button>)}</nav><button className="user-workspace-signout" type="button" onClick={() => void signOut()}><LogOut size={16}/>Выйти</button></aside>
        <main>
          {error && <div className="workspace-message workspace-message--error">{error}</div>}
          {notice && <div className="workspace-message workspace-message--notice">{notice}</div>}
          {loading && <div className="users-loading"><LoaderCircle className="spin"/>Загрузка…</div>}

          {tab === 'profile' && !loading && <section><h3>Личные данные</h3><p>Данные вашего IMDS Account. Email меняется только через подтверждённый процесс.</p><div className="profile-card"><div className="user-workspace-avatar user-workspace-avatar--large">{profile?.avatarUrl || user.avatarUrl ? <img src={profile?.avatarUrl || user.avatarUrl || ''} alt=""/> : initials}</div><div><strong>{profile?.name || user.name}</strong><span>{profile?.providers?.length ? `Вход: ${profile.providers.join(' · ')}` : 'IMDS Account'}</span></div>{profile?.emailVerified && <em><CheckCircle2 size={14}/> Email подтверждён</em>}</div><div className="profile-grid"><label><span>Имя</span><input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label><span>Телефон</span><input value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} placeholder="+7 700 000 00 00"/></label><label className="profile-grid-full"><span>Email</span><input value={profile?.email || user.email || ''} readOnly/></label></div><div className="workspace-actions"><button className="workspace-primary" type="button" disabled={saving} onClick={() => void saveProfile()}><Save size={15}/>{saving ? 'Сохранение…' : 'Сохранить'}</button></div></section>}

          {tab === 'clinics' && <section><h3>Мои клиники</h3><p>Роль и права вычисляются отдельно для каждой клиники в одном IMDS Account.</p><div className="clinic-account-list">{(user.companies || []).map((company) => <button key={company.id} type="button" className={company.id === user.companyId ? 'active' : ''} onClick={() => void switchCompany(company.id)}><span><Building2 size={17}/></span><div><strong>{company.name}</strong><small>{roleLabels[company.role] || company.role}{company.accessSource === 'platform' ? ' · platform access' : ''}</small></div>{company.id === user.companyId && <CheckCircle2 size={17}/>}</button>)}</div><div className="workspace-note">Добавление новой клиники и присоединение по коду доступны в переключателе клиник в верхней панели.</div></section>}

          {tab === 'security' && !loading && <section><h3>Безопасность</h3><p>Email verification, MFA, пароль и активные устройства IMDS Account.</p><AccountSecurityPanel/><div className="workspace-card"><h4>Способы входа</h4><div className="provider-list">{(profile?.providers || []).map((provider) => <span key={provider}><ShieldCheck size={14}/>{provider === 'password' ? 'Email и пароль' : provider === 'google' ? 'Google' : provider}</span>)}</div></div>{profile?.providers?.includes('password') && <div className="workspace-card"><h4>Изменить пароль</h4><div className="password-grid"><input type="password" autoComplete="current-password" placeholder="Текущий пароль" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}/><input type="password" autoComplete="new-password" placeholder="Новый пароль · минимум 10 символов" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}/><input type="password" autoComplete="new-password" placeholder="Повторите новый пароль" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}/><button className="workspace-primary" type="button" disabled={saving || passwords.next.length < 10} onClick={() => void submitPassword()}><LockKeyhole size={15}/>Изменить пароль</button></div></div>}<div className="workspace-card"><div className="workspace-card-head"><h4>Активные сессии</h4><button type="button" onClick={() => void revokeOtherAccountSessions().then(async (count) => { setNotice(`Завершено сессий: ${count}`); await loadSecurity(); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>Завершить другие</button></div><div className="session-list">{sessions.map((session) => <div className="session-row" key={session.id}><Laptop size={17}/><div><strong>{session.current ? 'Текущее устройство' : session.userAgent}</strong><span>{session.current ? session.userAgent : `Последняя активность: ${formatDate(session.lastSeenAt)}`}</span><small>Действует до {formatDate(session.expiresAt)}</small></div>{session.current ? <em>Текущая</em> : <button type="button" aria-label="Завершить сессию" onClick={() => void revokeAccountSession(session.id).then(loadSecurity).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>Завершить</button>}</div>)}</div></div></section>}

          {tab === 'preferences' && <section><h3>Настройки аккаунта</h3><p>Персональные настройки интерфейса, не влияющие на других пользователей клиники.</p><div className="profile-grid"><label><span>Язык</span><select value={profileDraft.locale} onChange={(event) => setProfileDraft({ ...profileDraft, locale: event.target.value })}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label><label><span>Часовой пояс</span><select value={profileDraft.timezone} onChange={(event) => setProfileDraft({ ...profileDraft, timezone: event.target.value })}><option value="Asia/Almaty">Asia/Almaty</option><option value="Asia/Aqtobe">Asia/Aqtobe</option><option value="UTC">UTC</option></select></label><label className="profile-grid-full"><span>Валюта отображения</span><select value={currency} onChange={(event) => { const next = event.target.value as DisplayCurrency; setCurrency(next); saveDisplayCurrency(next); }}>{DISPLAY_CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}</select></label></div><div className="workspace-actions"><button className="workspace-primary" type="button" disabled={saving} onClick={() => void saveProfile()}><Save size={15}/>Сохранить настройки</button></div></section>}

          {tab === 'access' && <section><h3>Мой доступ</h3><p>Эффективные права в текущей клинике.</p>{fullAccess ? <div className="full-access-card"><ShieldCheck size={22}/><div><strong>Полный доступ</strong><span>{user.platformRole === 'super_admin' ? 'Доступ предоставлен ролью Super Admin платформы.' : `Доступ предоставлен ролью ${roleLabels[currentCompany?.role || user.role] || user.role}.`}</span></div></div> : <div className="access-list">{accessRows.length ? accessRows.map(([moduleId, grant]) => <div key={moduleId}><span>{moduleLabels[moduleId] || moduleId}</span><em>{grant.manage ? 'Полное управление' : Object.entries(grant).filter(([, value]) => value).map(([key]) => key).join(', ')}</em></div>) : <div><span>Нет назначенных модулей</span><em>Ограниченный доступ</em></div>}</div>}</section>}

          {tab === 'clinic' && <ClinicSettingsPanel/>}
          {tab === 'users' && <TeamAdministrationPanel/>}
          {tab === 'matrix' && <AccessMatrixPanel users={users}/>} 
          {tab === 'subscription' && <BillingCenterPanel/>}
        </main>
      </div>
    </section>
  </div>;
}
