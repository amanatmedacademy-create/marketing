import { useMemo, useState } from 'react';
import {
  Bell,
  Eye,
  KeyRound,
  LogOut,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from './AuthGate';
import '../user-workspace.css';

type Tab = 'profile' | 'security' | 'notifications' | 'access' | 'users';

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

export default function UserWorkspaceModal({ mode, onClose }: Props) {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>(mode === 'settings' ? 'users' : 'profile');
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('imds-marketing-notifications') || '{}'); } catch { return {}; }
  });
  const initials = useMemo(() => (user.name || user.email || 'IM').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), [user]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound; settingsOnly?: boolean }> = [
    { id: 'profile', label: 'Профиль', icon: UserRound },
    { id: 'security', label: 'Безопасность', icon: ShieldCheck },
    { id: 'notifications', label: 'Уведомления', icon: Bell },
    { id: 'access', label: 'Мой доступ', icon: KeyRound },
    { id: 'users', label: 'Пользователи', icon: UsersRound, settingsOnly: true },
  ];

  const saveNotifications = () => {
    localStorage.setItem('imds-marketing-notifications', JSON.stringify(notifications));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
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
          {tab === 'profile' && <section><h3>Личные данные</h3><p>Информация, отображаемая в IMDS Marketing.</p><div className="profile-card"><div className="user-workspace-avatar user-workspace-avatar--large">{initials}</div><div><strong>{user.name || 'Администратор'}</strong><span>{user.role === 'administrator' ? 'Полный доступ' : user.role}</span></div></div><div className="profile-grid"><label><span>Имя</span><input value={user.name || ''} readOnly/></label><label><span>Должность</span><input value={user.role === 'administrator' ? 'Администратор' : user.role} readOnly/></label><label className="profile-grid-full"><span>Email</span><input value={user.email || ''} readOnly/></label></div></section>}
          {tab === 'security' && <section><h3>Безопасность</h3><p>Управление паролем и активными сессиями.</p><div className="workspace-card"><h4>Смена пароля</h4><label><span>Текущий пароль</span><div className="password-field"><input type="password" placeholder="••••••••"/><Eye size={15}/></div></label><label><span>Новый пароль</span><div className="password-field"><input type="password" placeholder="••••••••"/><Eye size={15}/></div></label><label><span>Повтор нового пароля</span><div className="password-field"><input type="password" placeholder="••••••••"/><Eye size={15}/></div></label><button type="button" disabled>Смена пароля через Google</button></div><div className="workspace-card"><h4>Активные сессии</h4><div className="session-row"><div><strong>Текущая сессия</strong><span>Chrome · защищённый вход Google</span></div><em>Текущая</em></div></div></section>}
          {tab === 'notifications' && <section><h3>Уведомления</h3><p>Настройте события, о которых должна сообщать система.</p><div className="notification-list">{notificationItems.map(([id, title, text]) => <label key={id}><div><strong>{title}</strong><span>{text}</span></div><input type="checkbox" checked={notifications[id] ?? id !== 'lead'} onChange={(event) => setNotifications((previous) => ({ ...previous, [id]: event.target.checked }))}/><i/></label>)}</div><button className="workspace-primary" type="button" onClick={saveNotifications}>{saved ? 'Сохранено' : 'Сохранить настройки'}</button></section>}
          {tab === 'access' && <section><h3>Мой доступ</h3><p>Разрешения текущей роли.</p><div className="access-list">{['Аналитика и Dashboard', 'Рекламные кабинеты', 'Лиды и воронка', 'Настройки интеграций', 'Журнал и аудит', 'Управление пользователями'].map((item) => <div key={item}><span>{item}</span><em>✓ Разрешено</em></div>)}</div></section>}
          {tab === 'users' && <section><div className="users-head"><div><h3>Пользователи системы</h3><p>Роли, доступ и статус приглашений.</p></div><button type="button">+ Добавить</button></div><div className="users-list">{[
            ['Администратор', user.email || 'admin@imds.kz', 'Администратор', 'Активен'],
            ['Маркетолог', 'marketing@imds.kz', 'Маркетолог', 'Активен'],
            ['Аналитик', 'analyst@imds.kz', 'Аналитик', 'Приглашён'],
          ].map(([name,email,role,status]) => <article key={email}><div className="user-row-avatar">{name[0]}</div><div><strong>{name}</strong><span>{email}</span></div><b>{role}</b><em>{status}</em><button type="button" aria-label="Настройки пользователя"><Settings size={15}/></button></article>)}</div></section>}
        </main>
      </div>
    </section>
  </div>;
}
