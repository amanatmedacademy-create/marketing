import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

type FeedbackTone = 'success' | 'error' | 'info' | 'warning';
type FeedbackItem = { id: number; tone: FeedbackTone; title: string; message?: string };
type ConfirmOptions = { title: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };
type ConfirmState = ConfirmOptions & { resolve: (value: boolean) => void };

type ActionFeedbackValue = {
  notify: (tone: FeedbackTone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ActionFeedbackContext = createContext<ActionFeedbackValue | null>(null);

export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [confirmation, setConfirmation] = useState<ConfirmState | null>(null);
  const idRef = useRef(0);

  const notify = useCallback((tone: FeedbackTone, title: string, message?: string) => {
    const id = ++idRef.current;
    setItems(current => [...current.slice(-3), { id, tone, title, message }]);
    window.setTimeout(() => setItems(current => current.filter(item => item.id !== id)), tone === 'error' ? 7000 : 4200);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setConfirmation({ ...options, resolve });
  }), []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => notify('error', 'Ошибка интерфейса', event.message || 'Произошла непредвиденная ошибка.');
    const onRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Неизвестная ошибка');
      notify('error', 'Операция не выполнена', message);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [notify]);

  const value = useMemo<ActionFeedbackValue>(() => ({
    notify,
    success: (title, message) => notify('success', title, message),
    error: (title, message) => notify('error', title, message),
    info: (title, message) => notify('info', title, message),
    confirm,
  }), [confirm, notify]);

  const finishConfirmation = (result: boolean) => {
    confirmation?.resolve(result);
    setConfirmation(null);
  };

  return <ActionFeedbackContext.Provider value={value}>
    {children}
    <div className="action-feedback-stack" aria-live="polite">{items.map(item => {
      const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? XCircle : item.tone === 'warning' ? AlertCircle : Info;
      return <article key={item.id} className={`action-feedback ${item.tone}`}>
        <Icon size={18} />
        <div><strong>{item.title}</strong>{item.message && <span>{item.message}</span>}</div>
        <button type="button" aria-label="Закрыть" onClick={() => setItems(current => current.filter(entry => entry.id !== item.id))}><X size={15} /></button>
      </article>;
    })}</div>
    {confirmation && <div className="action-confirm-backdrop" onMouseDown={() => finishConfirmation(false)}>
      <section className="action-confirm" role="alertdialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <header><AlertCircle size={22} /><div><h2>{confirmation.title}</h2><p>{confirmation.message}</p></div></header>
        <footer><button type="button" onClick={() => finishConfirmation(false)}>{confirmation.cancelLabel ?? 'Отмена'}</button><button type="button" className={confirmation.destructive ? 'destructive' : 'primary'} onClick={() => finishConfirmation(true)}>{confirmation.confirmLabel ?? 'Подтвердить'}</button></footer>
      </section>
    </div>}
  </ActionFeedbackContext.Provider>;
}

export function useActionFeedback() {
  const context = useContext(ActionFeedbackContext);
  if (!context) throw new Error('useActionFeedback должен использоваться внутри ActionFeedbackProvider.');
  return context;
}
