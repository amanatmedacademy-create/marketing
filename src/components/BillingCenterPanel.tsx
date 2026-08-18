import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CreditCard, FileText, LoaderCircle, PackagePlus, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { loadBillingCenter, openBillingPortal, refreshBilling, startCheckout, type BillingCenterState, type BillingInvoice, type BillingPlan } from '../services/billing';
import './billing-center.css';

const money = (value: number | null | undefined, currency = 'KZT') => new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(parsed);
};
const statusLabels: Record<string, string> = {
  trial: 'Trial', pending_payment: 'Ожидает оплаты', active: 'Активна', past_due: 'Просрочена', grace: 'Льготный период', grace_period: 'Льготный период',
  read_only: 'Только чтение', suspended: 'Приостановлена', expired: 'Истекла', canceled: 'Отменена', cancelled: 'Отменена', free: 'Бесплатно', beta: 'Beta',
};
const invoiceStatus: Record<string, string> = {
  paid: 'Оплачен', issued: 'Ожидает оплаты', open: 'Ожидает оплаты', partially_paid: 'Частично оплачен', overdue: 'Просрочен', void: 'Аннулирован', written_off: 'Списан', draft: 'Черновик',
};
const limitLabels: Record<string, string> = {
  users: 'Пользователи', branches: 'Филиалы', whatsapp_channels: 'WhatsApp-каналы', waba_accounts: 'WABA аккаунты', whatsapp_numbers: 'WhatsApp номера',
  telephony_channels: 'Телефонные каналы', call_minutes: 'Минуты звонков / мес.', transcription_minutes: 'Транскрибация / мес.', call_recording_days: 'Хранение записей, дней',
  ai_requests: 'AI-запросы / мес.', automation_runs: 'Автоматизации / мес.', storage_gb: 'Хранилище, GB', meta_ad_accounts: 'Meta Ad Accounts', meta_pages: 'Meta Pages', meta_datasets: 'Meta Pixel / Dataset',
};
const periods = [1, 3, 6, 12] as const;

function planAmount(plan: BillingPlan, months: number) {
  const periodPrice = plan.prices?.[String(months)];
  return periodPrice == null ? plan.amount : Number(periodPrice);
}

export default function BillingCenterPanel() {
  const [state, setState] = useState<BillingCenterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [billingMonths, setBillingMonths] = useState(1);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const next = await loadBillingCenter();
      setState(next);
      const months = Number(next.billing?.billingPeriodMonths || 1);
      if (periods.includes(months as (typeof periods)[number])) setBillingMonths(months);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const billing = state?.billing || null;
  const currentPlan = state?.plan || state?.plans?.find((plan) => plan.current) || null;
  const overdue = ['past_due', 'grace', 'grace_period'].includes(billing?.subscriptionStatus || '');
  const readOnly = billing?.subscriptionStatus === 'read_only';
  const locked = ['expired', 'suspended', 'canceled', 'cancelled'].includes(billing?.subscriptionStatus || '');
  const sortedInvoices = useMemo(() => [...(state?.invoices || [])].sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))), [state?.invoices]);
  const limits = Object.entries(currentPlan?.limits || {}).filter(([, value]) => Number.isFinite(Number(value)));

  const action = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key); setError(''); setNotice('');
    try { await fn(); if (success) setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const requestPlanInvoice = async (plan: BillingPlan) => {
    await action(`plan:${plan.code}`, async () => {
      const result = await startCheckout({ kind: 'subscription', planCode: plan.code, billingPeriodMonths: billingMonths });
      await load();
      return result;
    }, 'Счёт выставлен. Новый тариф применится автоматически после полной оплаты.');
  };

  if (loading) return <section className="billing-center billing-center--loading"><LoaderCircle className="spin" size={18}/>Загрузка тарифа и оплаты…</section>;
  if (!state) return <section className="billing-center"><div className="billing-alert billing-alert--error"><TriangleAlert size={17}/><span>{error || 'Тариф и оплата недоступны'}</span></div></section>;

  return <section className="billing-center">
    <div className="billing-center__head"><div><h3>Тариф и оплата</h3><p>Текущий тариф IMDS Marketing, лимиты, счета и способы оплаты.</p></div><button type="button" className="billing-icon-button" title="Обновить" onClick={() => void action('refresh', async () => { if (state.configured) await refreshBilling(); await load(); })} disabled={Boolean(busy)}><RefreshCw className={busy === 'refresh' ? 'spin' : ''} size={16}/></button></div>
    {error && <div className="billing-alert billing-alert--error"><TriangleAlert size={17}/><span>{error}</span></div>}
    {notice && <div className="billing-alert"><ShieldCheck size={17}/><span>{notice}</span></div>}
    {!state.configured && <div className="billing-alert"><ShieldCheck size={17}/><span>Связь с IMDS Control Center недоступна. Текущий статус отображается из локального entitlement snapshot.</span></div>}
    {overdue && <div className="billing-alert billing-alert--warning"><TriangleAlert size={17}/><span>Есть задолженность. Оплатите счёт до {date(billing?.graceEndsAt || billing?.accessEndsAt)}, чтобы избежать режима только для чтения.</span></div>}
    {readOnly && <div className="billing-alert billing-alert--warning"><TriangleAlert size={17}/><span>Подписка в режиме только для чтения. Данные доступны, но изменения заблокированы до оплаты.</span></div>}
    {locked && <div className="billing-alert billing-alert--error"><TriangleAlert size={17}/><span>Подписка приостановлена. Данные сохранены. Раздел «Тариф и оплата» остаётся доступным для восстановления подписки.</span></div>}

    <div className="billing-summary-grid">
      <article><span>Статус</span><strong>{statusLabels[billing?.subscriptionStatus || ''] || billing?.subscriptionStatus || '—'}</strong><small>{billing?.renewalMode === 'auto' ? 'Автопродление' : 'Ручное продление'}</small></article>
      <article><span>Текущий тариф</span><strong>{currentPlan?.name || 'Без тарифа'}</strong><small>{currentPlan?.amount != null ? `${money(currentPlan.amount, currentPlan.currency || billing?.currency || 'KZT')} / ${currentPlan.interval || 'период'}` : 'Управляется IMDS Control Center'}</small></article>
      <article><span>Следующая дата</span><strong>{date(billing?.periodEndsAt || billing?.accessEndsAt)}</strong><small>{billing?.trialEndsAt ? `Trial до ${date(billing.trialEndsAt)}` : billing?.graceEndsAt ? `Grace до ${date(billing.graceEndsAt)}` : 'Период подписки'}</small></article>
      <article><span>Оплата</span><strong>{billing?.paymentMethods?.find((item) => item.isDefault)?.displayName || billing?.paymentMethods?.[0]?.displayName || 'Не настроена'}</strong><small>{billing?.currency || 'KZT'}</small></article>
    </div>

    {state.permissions.canManage && <div className="billing-actions">
      {state.capabilities.portal && <button type="button" onClick={() => void action('portal', openBillingPortal)} disabled={Boolean(busy)}><CreditCard size={15}/>Способы оплаты и подписка<ArrowUpRight size={14}/></button>}
      <label className="billing-period-control"><span>Период оплаты</span><select value={billingMonths} onChange={(event) => setBillingMonths(Number(event.target.value))}>{periods.map((months) => <option key={months} value={months}>{months} мес.</option>)}</select></label>
    </div>}

    {limits.length > 0 && <div className="billing-section"><div className="billing-section__title"><h4>Лимиты текущего тарифа</h4><span>Применяются из IMDS Control Center</span></div><div className="billing-limit-grid">{limits.map(([key, value]) => <article key={key}><span>{limitLabels[key] || key}</span><strong>{Number(value).toLocaleString('ru-RU')}</strong></article>)}</div></div>}

    {state.plans.length > 0 && <div className="billing-section"><div className="billing-section__title"><h4>Тарифы</h4><span>Новый тариф включится только после полной оплаты счёта</span></div><div className="billing-plan-grid">{state.plans.map((plan) => {
      const amount = planAmount(plan, billingMonths);
      return <article className={plan.current ? 'current' : ''} key={plan.code}><div><strong>{plan.name}</strong>{plan.recommended && <em>Рекомендуем</em>}</div><p>{plan.description || 'Набор модулей и лимитов управляется платформой.'}</p><b>{amount != null ? money(amount, plan.currency || billing?.currency || 'KZT') : 'По запросу'}</b><small>{billingMonths} мес.</small>{state.permissions.canManage && state.capabilities.checkout && plan.pricingMode !== 'request' && <button type="button" onClick={() => void requestPlanInvoice(plan)} disabled={Boolean(busy)}>{plan.current ? 'Выставить счёт на продление' : 'Выбрать и выставить счёт'}</button>}</article>;
    })}</div></div>}

    {state.addOns.length > 0 && <div className="billing-section"><div className="billing-section__title"><h4>Add-ons</h4><span>Цены каталога продукта</span></div><div className="billing-addon-list">{state.addOns.map((addon) => <div key={addon.code}><PackagePlus size={17}/><span><strong>{addon.name}</strong><small>{addon.description || addon.unit || 'Дополнительный модуль'}</small></span><b>{addon.prices?.[String(billingMonths)] != null ? money(addon.prices[String(billingMonths)], addon.currency || billing?.currency || 'KZT') : addon.amount != null ? money(addon.amount, addon.currency || billing?.currency || 'KZT') : '—'}</b>{state.permissions.canManage && state.capabilities.addOns && <button type="button" onClick={() => void action(`addon:${addon.code}`, async () => { await startCheckout({ kind: 'addon', addonCode: addon.code, quantity: 1, billingPeriodMonths: billingMonths }); await load(); })} disabled={Boolean(busy)}>Добавить</button>}</div>)}</div></div>}

    <div className="billing-section"><div className="billing-section__title"><h4>Счета</h4><span>{sortedInvoices.length ? `Последние: ${sortedInvoices.length}` : 'Счетов пока нет'}</span></div>{sortedInvoices.length ? <div className="billing-invoices">{sortedInvoices.map((invoice: BillingInvoice) => <div key={invoice.id}><FileText size={17}/><span><strong>{invoice.number || invoice.id}</strong><small>{date(invoice.issuedAt)} · {invoiceStatus[invoice.status || ''] || invoice.status || '—'}{invoice.dueAt ? ` · до ${date(invoice.dueAt)}` : ''}</small></span><b>{money(invoice.amount, invoice.currency || billing?.currency || 'KZT')}</b>{invoice.url && <a href={invoice.url} target="_blank" rel="noreferrer">Открыть<ArrowUpRight size={13}/></a>}</div>)}</div> : <div className="workspace-note">Счета появятся после выбора тарифа или выставления счёта администратором.</div>}</div>

    {billing?.paymentMethods?.length > 0 && <div className="billing-section"><div className="billing-section__title"><h4>Способы оплаты</h4><span>Настраиваются в IMDS Control Center</span></div><div className="billing-addon-list">{billing.paymentMethods.map((method) => <div key={method.method}><CreditCard size={17}/><span><strong>{method.displayName}</strong><small>{method.instructions || (method.isDefault ? 'Основной способ оплаты' : 'Доступен для оплаты')}</small></span>{method.isDefault && <b>По умолчанию</b>}</div>)}</div></div>}

    <div className="billing-security-note"><ShieldCheck size={16}/><span>IMDS Marketing не хранит номера карт, CVV/CVC и другие платёжные реквизиты. Коммерческие условия, счета и статус подписки контролируются IMDS Control Center.</span></div>
  </section>;
}
