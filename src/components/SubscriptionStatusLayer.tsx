import { CreditCard, LockKeyhole, TimerReset, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthGate';
import { loadPlatformEntitlements, type PlatformEntitlements } from '../services/platformEntitlements';
import './subscription-status.css';

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
        // AuthGate may still be attaching the authenticated fetch wrapper on first paint.
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
  const readOnly = useMemo(() => {
    if (!billing) return false;
    const accessEnd = billing.accessEndsAt ? new Date(billing.accessEndsAt).getTime() : NaN;
    const expiredByDate = Number.isFinite(accessEnd) && accessEnd <= Date.now();
    return ['expired', 'cancelled', 'suspended'].includes(billing.subscriptionStatus || '') || expiredByDate;
  }, [billing]);
  const paymentWarning = billing?.subscriptionStatus === 'past_due';

  const statusText = billing?.subscriptionStatus === 'trial'
    ? `Trial · осталось ${trialRemaining(billing.trialEndsAt) || '—'}`
    : billing?.subscriptionStatus === 'active'
      ? `Подписка · до ${formatDate(billing.accessEndsAt ?? billing.periodEndsAt) || 'без даты'}`
      : billing?.subscriptionStatus === 'grace_period'
        ? `Grace · до ${formatDate(billing.graceEndsAt ?? billing.accessEndsAt) || '—'}`
        : null;

  return <>
    {children}
    {readOnly && billing && <div className="subscription-state-banner subscription-state-banner--locked" role="status">
      <LockKeyhole size={17}/><div><strong>Режим только для чтения</strong><span>{billing.subscriptionStatus === 'suspended' ? 'Подписка приостановлена.' : 'Срок доступа закончился.'} Данные сохранены; просмотр остаётся доступным, изменения будут недоступны до продления.</span></div>
      {billing.paymentMethods.length > 0 && <span className="subscription-state-banner__payment"><CreditCard size={14}/>{billing.paymentMethods[0].displayName}</span>}
    </div>}
    {paymentWarning && billing && <div className="subscription-state-banner subscription-state-banner--warning" role="status"><TriangleAlert size={17}/><div><strong>Требуется оплата</strong><span>Есть задолженность по подписке. Проверьте Billing Center до окончания льготного периода.</span></div></div>}
    {statusText && !readOnly && !paymentWarning && <div title="Статус подписки IMDS Marketing" className="subscription-status-pill"><TimerReset size={15}/><span>{statusText}</span></div>}
  </>;
}
