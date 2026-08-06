import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Eye,
  KeyRound,
  LoaderCircle,
  LogOut,
  Pencil,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from './AuthGate';
import {
  DISPLAY_CURRENCIES,
  readDisplayCurrency,
  saveDisplayCurrency,
  type DisplayCurrency,
} from '../currency';
import {
  createManagedUser,
  fetchManagedUsers,
  removeManagedUser,
  updateManagedUser,
  type ManagedUser,
  type ManagedUserRole,
  type ManagedUserStatus,
} from '../services/userAdmin';
import '../user-workspace.css';

type Tab = 'profile' | 'security' | 'notifications' | 'access' | 'users';
type UserDraft = { id?: string; name: string; email: string; role: ManagedUserRole; status: ManagedUserStatus };

interface Props {
  mode: 'profile' | 'settings';
  onClose: () => void;
}

const notificationItems = [
  ['daily', 'Ежедневный отчёт', 'Сводка KPI каждое утро в 09:00'],
  ['budget', 'Перерасход бюджета', 'При превышении дневного лимита на 20%'],
  ['roas', 'ROAS ниже порога', 'Когда кампания падает ниже заданного значения'],
  ['lead', 'Новый лид', 'Мгновенное уведомление о каждом новом лиде'],
  ['digest', 'Еженедельный дайджест', 'Итоги недели по воскресеньям'],
  ['sync', 'Ошибка синхронизации', 'Сбой рекламного кабинета, CRM или webhook'],
] as const;

const roleLabels: Record<ManagedUserRole, string> = {
  administrator: 'Администратор',
  marketer: 'Маркетолог',
  analyst: 'Аналитик',
  viewer: 'Наблюдатель',
};

const statusLabels: Record<ManagedUserStatus, string> = {
  active: 'Активен',
  invited: 'Приглашён',
  blocked: 'Заблокирован',
};

const emptyDraft: UserDraft = { name: '', email: '', role: 'viewer', status: 'active' };

export default function UserWorkspaceModal({ mode, onClose }: Props) {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>(mode === 'settings' ? 'users' : 'profile');
  const [saved, setSaved] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => readDisplayCurrency());
  const [notifications, setNotifications] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('imds-marketing-notifications') || '{}'); } catch { return {}; }
  });
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const initials = useMemo(() => (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), [user]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound; settingsOnly?: boolean }> = [
    { id: 'profile', label: 'Профиль', icon: UserRound },
    { id: 'security', label: 'Безопасность', icon: ShieldCheck },
    { id: 'notifications', label: 'Уведомления', icon: Bell },
    { id: 'access', label: 'Мой доступ', icon: KeyRound },
    { id: 'users', label: 'Пользователи', icon: UsersRound, settingsOnly: true },
  ];

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError('');
    try { setUsers(await fetchManagedUsers()); }
    catch (error) { setUsersError(error instanceof Error ? error.message : 'Не удалось загрузить пользователей'); }
    finally { setUsersLoading(false); }
  };

  useEffect(() => {
    if (tab === 'users' && user.role === 'administrator') void loadUsers();
  }, [tab, user.role]);

  const saveNotifications = () => {
    localStorage.setItem('imds-marketing-notifications', JSON.stringify(notifications));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const changeCurrency = (currency: DisplayCurrency) => {
    setDisplayCurrency(currency);
    saveDisplayCurrency(currency);
  };

  const submitUser = async () => {
    if (!draft) return;
    setUserSaving(true);
    setUsersError('');
    try {
      const savedUser = draft.id
        ? await updateManagedUser(draft.id, { name: draft.name, role: draft.role, status: draft.status })
        : await createManagedUser({ name: draft.name, email: draft.email, role: draft.role, status: draft.status });
      setUsers((current) => draft.id
        ? current.map((item) => item.id === savedUser.id ? savedUser : item)
        : [...current, savedUser]);
      setDraft(null);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Не удалось сохранить пользователя');
    } finally {
      setUserSaving(false);
    }
  };

  const editUser = (item: ManagedUser) => setDraft({ id: item.id, name: item.name, email: item.email, role: item.role, status: item.status });

  const deleteUser = async (item: ManagedUser) => {
    if (!window.confirm(`Удалить доступ пользователя ${item.name}?`)) return;
    setUsersError('');
    try {
      await removeManagedUser(item.id);
      setUsers((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Не удалось удалить пользователя');
    }
  };

  return <div className="user-workspace-layer" role="dialog" aria-modal="true">
    <button className="user-workspace-overlay" type="button" aria-label="Закрыть" onClick={onClose}/>
    <section className={`user-workspace user-workspace--${mode}`}>
      <header>
        <div className="user-workspace-avatar">{initials}</div>
        <div><h2>{mode === 'settings' ? 'Настройки' : user.name || 'Администратор'}</h2><span>{user.role === 'administrator' ? 'Полный доступ' : user.role}</span></div>
        <button type="button" onClick={onClose}><X size={20}/></button>
      </header>
      <div className="user-workspace-body">
        <aside>
          <nav>{tabs.filter((item) => mode === 'settings' || !item.settingsOnly).map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16}/><span>{label}</span></button>)}</nav>
          <button className="user-workspace-signout" type="button" onClick={() => void signOut()}><LogOut size={16}/>Выйти из системы</button>
        </aside>
        <main>
          {tab === 'profile' && <section><h3>Личные данные</h3><p>Информация, отображаемая в IMDS Marketing.</p><div className="profile-card"><div className="user-workspace-avatar user-workspace-avatar--large">{initials}</div><div><strong>{user.name || 'Администратор'}</strong><span>{user.role === 'administrator' ? 'Полный доступ' : user.role}</span></div></div><div className="profile-grid"><label><span>Имя</span><input value={user.name || ''} readOnly/></label><label><span>Должность</span><input value={user.role === 'administrator' ? 'Администратор' : user.role} readOnly/></label><label className="profile-grid-full"><span>Email</span><input value={user.email || ''} readOnly/></label><label className="profile-grid-full"><span>Валюта отображения</span><select value={displayCurrency} onChange={(event) => changeCurrency(event.target.value as DisplayCurrency)}>{DISPLAY_CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label} ({item.region})</option>)}</select><small>Все финансовые показатели дашборда будут пересчитаны в выбранную валюту по актуальному курсу.</small></label></div></section>}
          {tab === 'security' && <section><h3>Безопасность</h3><p>Управление паролем и активными сессиями.</p><div className="workspace-card"><h4>Смена пароля</h4><label><span>Текущий пароль</span><div className="password-field"><input type="password" placeholder="••••••••"/><Eye size={15}/></div></label><label><span>Новый пароль</span><div className="password-field"><input type="password" placeholder="••••••••"/><Eye size={15}/></div></label><label><span>Повтор нового пароля</span><div className="password-field"><input type="password" placeholder="••••••••"/><Eye size={15}/></div></label><button type="button" disabled>Смена пароля через Google</button></div><div className="workspace-card"><h4>Активные сессии</h4><div className="session-row"><div><strong>Текущая сессия</strong><span>Chrome · защищённый вход Google</span></div><em>Текущая</em></div></div></section>}
          {tab === 'notifications' && <section><h3>Уведомления</h3><p>Настройте события, о которых должна сообщать система.</p><div className="notification-list">{notificationItems.map(([id, title, text]) => <label key={id}><div><strong>{title}</strong><span>{text}</span></div><input type="checkbox" checked={notifications[id] ?? id !== 'lead'} onChange={(event) => setNotifications((previous) => ({ ...previous, [id]: event.target.checked }))}/><i/></label>)}</div><button className="workspace-primary" type="button" onClick={saveNotifications}>{saved ? 'Сохранено' : 'Сохранить настройки'}</button></section>}
          {tab === 'access' && <section><h3>Мой доступ</h3><p>Разрешения текущей роли.</p><div className="access-list">{['Аналитика и Dashboard', 'Рекламные кабинеты', 'Лиды и воронка', 'Настройки интеграций', 'Журнал и аудит', 'Управление пользователями'].map((item) => <div key={item}><span>{item}</span><em>✓ Разрешено</em></div>)}</div></section>}
          {tab === 'users' && <section>
            <div className="users-head"><div><h3>Пользователи системы</h3><p>Добавление по email, роли и доступ к текущей компании.</p></div><button type="button" onClick={() => setDraft(emptyDraft)}><UserPlus size={15}/>Добавить</button></div>
            <div className="users-login-note">Пользователь входит через Google-аккаунт с указанным email. Пароль администратору не передаётся.</div>
            {usersError && <div className="users-error">{usersError}</div>}
            {usersLoading ? <div className="users-loading"><LoaderCircle className="spin"/>Загрузка пользователей…</div> : <div className="users-list">{users.map((item) => <article key={item.id}>
              <div className="user-row-avatar">{item.name[0]?.toUpperCase() || '?'}</div>
              <div><strong>{item.name}</strong><span>{item.email}</span><small>{item.connected ? `Вход выполнен${item.lastSeenAt ? ` · ${new Date(item.lastSeenAt).toLocaleDateString('ru-RU')}` : ''}` : 'Ожидает первого входа Google'}</small></div>
              <b>{roleLabels[item.role]}</b>
              <em className={`user-status user-status--${item.status}`}>{statusLabels[item.status]}</em>
              <div className="user-row-actions"><button type="button" aria-label="Изменить пользователя" onClick={() => editUser(item)}><Pencil size={15}/></button><button type="button" aria-label="Удалить пользователя" onClick={() => void deleteUser(item)}><Trash2 size={15}/></button></div>
            </article>)}</div>}
            {!usersLoading && users.length === 0 && <div className="users-empty">Пользователи компании не найдены.</div>}
          </section>}
        </main>
      </div>
    </section>
    {draft && <div className="user-editor-layer" role="dialog" aria-modal="true">
      <button className="user-editor-overlay" type="button" aria-label="Закрыть форму" onClick={() => setDraft(null)}/>
      <form className="user-editor" onSubmit={(event) => { event.preventDefault(); void submitUser(); }}>
        <header><div><h3>{draft.id ? 'Редактирование пользователя' : 'Добавление пользователя'}</h3><p>Доступ будет ограничен текущей компанией.</p></div><button type="button" onClick={() => setDraft(null)}><X size={18}/></button></header>
        <label><span>Имя</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required minLength={2}/></label>
        <label><span>Email Google</span><input type="email" value={draft.email} readOnly={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, email: event.target.value })} required/></label>
        <div className="user-editor-grid"><label><span>Роль</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as ManagedUserRole })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Статус</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ManagedUserStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <footer><button type="button" onClick={() => setDraft(null)}>Отмена</button><button className="workspace-primary" type="submit" disabled={userSaving}>{userSaving ? <LoaderCircle className="spin" size={16}/> : null}{draft.id ? 'Сохранить' : 'Добавить пользователя'}</button></footer>
      </form>
    </div>}
  </div>;
}
