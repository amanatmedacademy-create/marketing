import { CreditCard, LockKeyhole, TimerReset } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthGate';
import { loadPlatformEntitlements, type PlatformEntitlements } from '../services/platformEntitlements';

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function trialRemaining(value: string | null) {
  if (!value) return null;
  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return null;
  const remaining = Math.max(0, end - Date.now());
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours <= 24) return `${hours} ч`;
  return `${Math.ceil(hours / 24)} дн`;
}

export default function SubscriptionStatusLayer({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<PlatformEntitlements | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const next = await loadPlatformEntitlements();
        if (active) setState(next);
      } catch {
        // AuthGate may still be attaching the authenticated fetch wrapper on the
        // first paint. The next poll resolves the state without blocking login.
      }
    };
    timer = window.setTimeout(() => void refresh(), 250);
    const interval = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user.companyId]);

  const billing = state?.billing ?? null;
  const blocked = useMemo(() => {
    if (!billing) return false;
    const accessEnd = billing.accessEndsAt ? new Date(billing.accessEndsAt).getTime() : NaN;
    const expiredByDate = Number.isFinite(accessEnd) && accessEnd <= Date.now();
    return ['expired', 'past_due', 'cancelled', 'suspended'].includes(billing.subscriptionStatus || '') || expiredByDate;
  }, [billing]);

  if (blocked && billing) {
    return <div className="module-access-denied" style={{ minHeight: '100vh', padding: 32 }}>
      <LockKeyhole size={38}/>
      <h2>{billing.subscriptionStatus === 'suspended' ? 'Подписка приостановлена' : 'Срок подписки закончился'}</h2>
      <p>{billing.subscriptionStatus === 'trial' || !state?.managed
        ? 'Трёхдневный пробный период завершён. Для продолжения работы продлите IMDS Marketing.'
        : 'Для продолжения работы необходимо продлить подписку IMDS Marketing.'}</p>
      {billing.accessEndsAt && <p><strong>Доступ был активен до:</strong> {formatDate(billing.accessEndsAt)}</p>}
      {billing.paymentMethods.length > 0 ? <div style={{ width: 'min(680px, 100%)', display: 'grid', gap: 10, marginTop: 12 }}>
        <strong style={{ textAlign: 'left' }}>Доступные способы оплаты</strong>
        {billing.paymentMethods.map((method) => <div key={method.method} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, border: '1px solid var(--border)', borderRadius: 14, textAlign: 'left' }}>
          <CreditCard size={19}/><div><strong>{method.displayName}{method.isDefault ? ' · основной' : ''}</strong>{method.instructions && <div style={{ marginTop: 4, opacity: .72 }}>{method.instructions}</div>}</div>
        </div>)}
      </div> : <p>Для продления обратитесь к администратору IMDS.</p>}
    </div>;
  }

  const statusText = billing?.subscriptionStatus === 'trial'
    ? `Trial · осталось ${trialRemaining(billing.trialEndsAt) || '—'}`
    : billing?.subscriptionStatus === 'active'
      ? `Подписка · до ${formatDate(billing.accessEndsAt ?? billing.periodEndsAt) || 'без даты'}`
      : billing?.subscriptionStatus === 'grace_period'
        ? `Grace · до ${formatDate(billing.accessEndsAt) || '—'}`
        : null;

  return <>
    {children}
    {statusText && <div title="Статус подписки IMDS Marketing" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 80, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface, rgba(6,28,38,.92))', boxShadow: '0 8px 28px rgba(0,0,0,.16)', fontSize: 12, fontWeight: 700 }}>
      <TimerReset size={15}/><span>{statusText}</span>
    </div>}
  </>;
}
