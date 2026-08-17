import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, ChevronRight, CircleAlert, CircleCheck, CircleDashed, HeartPulse, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { loadNotifications, loadSystemHealth, readAllNotifications, readNotification, type AppNotification, type HealthItem } from '../services/notificationCenter';
import './notification-center.css';

type View = 'notifications' | 'health';

const relative = (value: string) => {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.max(1, Math.floor(diff / 60000));
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(value));
};
const HealthIcon = ({ status }: { status: HealthItem['status'] }) => status === 'connected' ? <CircleCheck size={16}/> : status === 'error' ? <CircleAlert size={16}/> : status === 'warning' ? <TriangleAlert size={16}/> : <CircleDashed size={16}/>;

export default function NotificationCenter() {
  const root = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('notifications');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [health, setHealth] = useState<HealthItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const [notifications, system] = await Promise.all([loadNotifications(), loadSystemHealth()]);
      setItems(notifications.items); setUnread(notifications.unreadCount); setHealth(system.items); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось обновить уведомления'); }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);

  const healthIssues = health.filter((item) => item.status === 'error' || item.status === 'warning').length;
  const markAll = async () => { setBusy(true); try { await readAllNotifications(); await refresh(); } finally { setBusy(false); } };
  const openNotification = async (item: AppNotification) => {
    if (!item.read_at) { await readNotification(item.id).catch(() => undefined); setUnread((value) => Math.max(0, value - 1)); setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row)); }
    if (item.action_url) { setOpen(false); window.location.assign(item.action_url); }
  };

  return <div className="notification-center" ref={root}>
    <button className="notification-center__trigger" type="button" aria-label="Уведомления" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void refresh(); }}><Bell size={17}/>{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}{healthIssues > 0 && unread === 0 && <i/>}</button>
    {open && <section className="notification-center__popover">
      <header><div><strong>Центр событий</strong><span>{unread ? `${unread} непрочитанных` : 'Всё просмотрено'}</span></div><button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={16}/></button></header>
      <div className="notification-center__tabs"><button className={view === 'notifications' ? 'active' : ''} onClick={() => setView('notifications')}><Bell size={14}/>Уведомления{unread > 0 && <b>{unread}</b>}</button><button className={view === 'health' ? 'active' : ''} onClick={() => setView('health')}><HeartPulse size={14}/>System Health{healthIssues > 0 && <b>{healthIssues}</b>}</button></div>
      {error && <div className="notification-center__error">{error}</div>}
      {view === 'notifications' ? <>
        <div className="notification-center__toolbar"><span>Последние события</span>{unread > 0 && <button type="button" disabled={busy} onClick={() => void markAll()}>{busy ? <LoaderCircle size={13} className="spin"/> : <CheckCheck size={13}/>}Прочитать все</button>}</div>
        <div className="notification-center__list">{items.length ? items.map((item) => <button key={item.id} className={!item.read_at ? 'unread' : ''} type="button" onClick={() => void openNotification(item)}><span className={`notification-center__severity ${item.severity}`}><Bell size={14}/></span><div><strong>{item.title}</strong>{item.body && <p>{item.body}</p>}<small>{relative(item.created_at)}</small></div>{item.action_url && <ChevronRight size={15}/>}</button>) : <div className="notification-center__empty"><CheckCheck size={22}/><strong>Новых событий нет</strong><span>Важные события клиники появятся здесь.</span></div>}</div>
      </> : <div className="notification-center__health">{health.map((item) => <div key={item.provider} className={`health-row health-row--${item.status}`}><span><HealthIcon status={item.status}/></span><div><strong>{item.label}</strong><small>{item.status === 'connected' ? 'Подключено' : item.status === 'not_configured' ? 'Не настроено' : item.lastError || (item.status === 'warning' ? 'Требует внимания' : 'Ошибка')}</small></div><em>{item.lastVerifiedAt ? relative(item.lastVerifiedAt) : '—'}</em></div>)}</div>}
    </section>}
  </div>;
}
