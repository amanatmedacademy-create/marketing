import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CreditCard, FileText, LoaderCircle, PackagePlus, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { loadBillingCenter, openBillingPortal, refreshBilling, startCheckout, type BillingCenterState, type BillingInvoice } from '../services/billing';
import './billing-center.css';

const money = (value: number | null | undefined, currency = 'KZT') => new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(parsed);
};
const statusLabels: Record<string, string> = { trial: 'Trial', active: 'Активна', past_due: 'Просрочена', grace_period: 'Льготный период', suspended: 'Приостановлена', expired: 'Истекла', cancelled: 'Отменена' };
const invoiceStatus: Record<string, string> = { paid: 'Оплачен', open: 'Ожидает оплаты', overdue: 'Просрочен', void: 'Аннулирован', draft: 'Черновик' };

export default function BillingCenterPanel() {
  const [state, setState] = useState<BillingCenterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setState(await loadBillingCenter()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const billing = state?.billing || null;
  const currentPlan = state?.plan || state?.plans?.find((plan) => plan.current) || null;
  const overdue = ['past_due', 'grace_period'].includes(billing?.subscriptionStatus || '');
  const locked = ['expired', 'suspended', 'cancelled'].includes(billing?.subscriptionStatus || '');
  const sortedInvoices = useMemo(() => [...(state?.invoices || [])].sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))), [state?.invoices]);

  const action = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await fn(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  if (loading) return <section className="billing-center billing-center--loading"><LoaderCircle className="spin" size={18}/>Загрузка Billing Center…</section>;
  if (!state) return <section className="billing-center"><div className="billing-alert billing-alert--error"><TriangleAlert size={17}/><span>{error || 'Billing Center недоступен'}</span></div></section>;

  return <section className="billing-center">
    <div className="billing-center__head"><div><h3>Billing Center</h3><p>Подписка, счета, способы оплаты и дополнительные квоты BELES.</p></div><button type="button" className="billing-icon-button" title="Обновить" onClick={() => void action('refresh', async () => { if (state.configured) await refreshBilling(); await load(); })} disabled={Boolean(busy)}><RefreshCw className={busy === 'refresh' ? 'spin' : ''} size={16}/></button></div>
    {error && <div className="billing-alert billing-alert--error"><TriangleAlert size={17}/><span>{error}</span></div>}
    {!state.configured && <div className="billing-alert"><ShieldCheck size={17}/><span>Control Plane billing ещё не подключён. Текущий статус и квоты доступны, но checkout и платёжный портал отключены.</span></div>}
    {overdue && <div className="billing-alert billing-alert--warning"><TriangleAlert size={17}/><span>Есть задолженность. Оплатите счёт до {date(billing?.graceEndsAt || billing?.accessEndsAt)}, чтобы избежать режима только для чтения.</span></div>}
    {locked && <div className="billing-alert billing-alert--error"><TriangleAlert size={17}/><span>Подписка неактивна. Данные сохранены; изменения заблокированы до возобновления доступа.</span></div>}

    <div className="billing-summary-grid">
      <article><span>Статус</span><strong>{statusLabels[billing?.subscriptionStatus || ''] || billing?.subscriptionStatus || '—'}</strong><small>{billing?.renewalMode === 'auto' ? 'Автопродление' : 'Ручное продление'}</small></article>
      <article><span>Текущий тариф</span><strong>{currentPlan?.name || 'BELES'}</strong><small>{currentPlan?.amount != null ? `${money(currentPlan.amount, currentPlan.currency || billing?.currency || 'KZT')} / ${currentPlan.interval || 'период'}` : 'Определяется Control Plane'}</small></article>
      <article><span>Следующая дата</span><strong>{date(billing?.periodEndsAt || billing?.accessEndsAt)}</strong><small>{billing?.trialEndsAt ? `Trial до ${date(billing.trialEndsAt)}` : billing?.graceEndsAt ? `Grace до ${date(billing.graceEndsAt)}` : 'Период подписки'}</small></article>
      <article><span>Оплата</span><strong>{billing?.paymentMethods?.find((item) => item.isDefault)?.displayName || billing?.paymentMethods?.[0]?.displayName || 'Не настроена'}</strong><small>{billing?.currency || 'KZT'}</small></article>
    </div>

    {state.permissions.canManage && <div className="billing-actions">
      {state.capabilities.portal && <button type="button" onClick={() => void action('portal', openBillingPortal)} disabled={Boolean(busy)}><CreditCard size={15}/>Способы оплаты и подписка<ArrowUpRight size={14}/></button>}
      {state.capabilities.checkout && billing?.subscriptionStatus !== 'active' && state.plans[0] && <button className="primary" type="button" onClick={() => void action(`plan:${state.plans[0].code}`, () => startCheckout({ kind: 'subscription', planCode: state.plans[0].code }))} disabled={Boolean(busy)}><CreditCard size={15}/>Продлить / активировать</button>}
    </div>}

    {state.plans.length > 0 && <div className="billing-section"><div className="billing-section__title"><h4>Тарифы</h4><span>Источник: IMDS Control Plane</span></div><div className="billing-plan-grid">{state.plans.map((plan) => <article className={plan.current ? 'current' : ''} key={plan.code}><div><strong>{plan.name}</strong>{plan.recommended && <em>Рекомендуем</em>}</div><p>{plan.description || 'Набор модулей и лимитов управляется платформой.'}</p><b>{plan.amount != null ? money(plan.amount, plan.currency || billing?.currency || 'KZT') : 'По запросу'}</b><small>{plan.interval || 'период'}</small>{state.permissions.canManage && state.capabilities.checkout && !plan.current && <button type="button" onClick={() => void action(`plan:${plan.code}`, () => startCheckout({ kind: 'subscription', planCode: plan.code }))} disabled={Boolean(busy)}>Выбрать тариф</button>}</article>)}</div></div>}

    {state.addOns.length > 0 && <div className="billing-section"><div className="billing-section__title"><h4>Add-ons и дополнительные квоты</h4><span>Применяются после подтверждённой оплаты</span></div><div className="billing-addon-list">{state.addOns.map((addon) => <div key={addon.code}><PackagePlus size={17}/><span><strong>{addon.name}</strong><small>{addon.description || addon.unit || 'Дополнительная квота'}</small></span><b>{addon.amount != null ? money(addon.amount, addon.currency || billing?.currency || 'KZT') : '—'}</b>{state.permissions.canManage && state.capabilities.addOns && <button type="button" onClick={() => void action(`addon:${addon.code}`, () => startCheckout({ kind: 'addon', addonCode: addon.code, quantity: 1 }))} disabled={Boolean(busy)}>Добавить</button>}</div>)}</div></div>}

    <div className="billing-section"><div className="billing-section__title"><h4>Счета</h4><span>{sortedInvoices.length ? `Последние: ${sortedInvoices.length}` : 'Счетов пока нет'}</span></div>{sortedInvoices.length ? <div className="billing-invoices">{sortedInvoices.map((invoice: BillingInvoice) => <div key={invoice.id}><FileText size={17}/><span><strong>{invoice.number || invoice.id}</strong><small>{date(invoice.issuedAt)} · {invoiceStatus[invoice.status || ''] || invoice.status || '—'}</small></span><b>{money(invoice.amount, invoice.currency || billing?.currency || 'KZT')}</b>{invoice.url && <a href={invoice.url} target="_blank" rel="noreferrer">Открыть<ArrowUpRight size={13}/></a>}</div>)}</div> : <div className="workspace-note">История счетов появится после подключения billing provider в IMDS Control Plane.</div>}</div>

    <div className="billing-security-note"><ShieldCheck size={16}/><span>BELES не хранит номера карт, CVV/CVC и другие платёжные реквизиты. Оплата выполняется на защищённой стороне платёжного провайдера через IMDS Control Plane.</span></div>
  </section>;
}
