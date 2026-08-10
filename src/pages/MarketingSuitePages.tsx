import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Database, Download, FileText, RefreshCw, Send, UsersRound } from 'lucide-react';
import { fetchChatWorkspace, sendWhatsAppTemplate, type ChatThread, type WhatsAppTemplate } from '../services/callCenterChat';
import { marketingApi, type DashboardDailyRow, type MarketingLead, type SourceSummaryRow } from '../services/api';
import '../marketing-suite.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));

function PageHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="suite-page-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function State({ text }: { text: string }) { return <div className="suite-state">{text}</div>; }

async function getGlobalWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
  const response = await fetch('/api/integrations/waba/templates', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as { templates?: WhatsAppTemplate[]; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Не удалось загрузить WhatsApp-шаблоны: HTTP ${response.status}`);
  return payload?.templates || [];
}

function threadMatchesSegment(thread: ChatThread, segment: string): boolean {
  const stage = `${thread.contact?.stage || ''} ${thread.funnelLead?.stage || ''}`.toLowerCase();
  if (segment === 'new') return stage.includes('нов');
  if (segment === 'appointment') return stage.includes('запис') || stage.includes('appointment');
  if (segment === 'buyers') return stage.includes('продаж') || stage.includes('успеш') || Number(thread.funnelLead?.amount || 0) > 0;
  if (segment === 'unassigned') return !thread.assignedUserId;
  return true;
}

export function WhatsAppCampaignsPage() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [segment, setSegment] = useState('all');
  const [parameterText, setParameterText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [workspace, wabaTemplates] = await Promise.all([fetchChatWorkspace(), getGlobalWhatsAppTemplates()]);
      setThreads(workspace.threads.filter(item => item.channel.toUpperCase() === 'WHATSAPP' && Boolean(item.phone || item.contact?.phone)));
      setTemplates(wabaTemplates);
      if (!templateKey && wabaTemplates[0]) setTemplateKey(`${wabaTemplates[0].name}::${wabaTemplates[0].language}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить WhatsApp-данные');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const recipients = useMemo(() => threads.filter(thread => threadMatchesSegment(thread, segment)), [threads, segment]);
  const selectedTemplate = templates.find(item => `${item.name}::${item.language}` === templateKey);
  const parameters = parameterText.split('|').map(item => item.trim()).filter(Boolean);
  const parameterCountOk = Boolean(selectedTemplate) && parameters.length === Number(selectedTemplate?.parameterCount || 0);

  const sendCampaign = async () => {
    if (!selectedTemplate || !confirmed || !parameterCountOk || recipients.length === 0) return;
    setSending(true); setMessage(null); setProgress({ sent: 0, failed: 0, total: recipients.length });
    let sent = 0; let failed = 0;
    for (const thread of recipients) {
      try { await sendWhatsAppTemplate(thread.id, selectedTemplate, parameters, 'IMDS Marketing'); sent += 1; }
      catch { failed += 1; }
      setProgress({ sent, failed, total: recipients.length });
    }
    setSending(false); setConfirmed(false);
    setMessage(`Рассылка завершена. Отправлено: ${sent}, ошибок: ${failed}.`);
  };

  return <div className="stack suite-page">
    <PageHeader eyebrow="WhatsApp Business API" title="WhatsApp-рассылки" text="Массовая отправка только по существующим WhatsApp-диалогам и только одобренными Meta шаблонами." action={<button className="button" onClick={() => void load()} disabled={loading || sending}><RefreshCw size={16}/>Обновить</button>} />
    {message && <div className="alert">{message}</div>}
    <div className="suite-kpis"><article><UsersRound/><span>WhatsApp-контакты</span><strong>{number(threads.length)}</strong></article><article><FileText/><span>Одобренные шаблоны</span><strong>{number(templates.length)}</strong></article><article><Send/><span>Получатели сегмента</span><strong>{number(recipients.length)}</strong></article></div>
    {loading ? <State text="Загружаем WABA, шаблоны и диалоги…"/> : <div className="suite-two-col">
      <section className="panel suite-form"><h2>Настройка кампании</h2>
        <label>Сегмент<select value={segment} onChange={event => setSegment(event.target.value)}><option value="all">Все WhatsApp-контакты</option><option value="new">Новые лиды</option><option value="appointment">Записанные</option><option value="buyers">Покупатели</option><option value="unassigned">Без ответственного</option></select></label>
        <label>Шаблон<select value={templateKey} onChange={event => { setTemplateKey(event.target.value); setParameterText(''); setConfirmed(false); }}>{templates.map(template => <option key={`${template.name}-${template.language}`} value={`${template.name}::${template.language}`}>{template.name} · {template.language}</option>)}</select></label>
        {selectedTemplate && <div className="suite-template-preview"><span>{selectedTemplate.category || 'TEMPLATE'}</span><b>{selectedTemplate.name}</b><p>{selectedTemplate.body}</p><small>Параметров: {selectedTemplate.parameterCount}</small></div>}
        {Number(selectedTemplate?.parameterCount || 0) > 0 && <label>Параметры шаблона <small>Разделитель — символ |. Значения применяются одинаково ко всем получателям.</small><input value={parameterText} onChange={event => setParameterText(event.target.value)} placeholder="Значение 1 | Значение 2"/></label>}
        <label className="suite-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>Подтверждаю массовую отправку {recipients.length} получателям</span></label>
        <button className="button button--primary" disabled={sending || !confirmed || !parameterCountOk || recipients.length === 0} onClick={() => void sendCampaign()}><Send size={16}/>{sending ? `Отправка ${progress.sent + progress.failed}/${progress.total}` : `Отправить ${recipients.length} сообщений`}</button>
      </section>
      <section className="panel"><h2>Получатели</h2><div className="suite-recipient-list">{recipients.slice(0,100).map(thread => <div key={thread.id}><b>{thread.contact?.fullName || thread.title || thread.phone || 'WhatsApp'}</b><span>{thread.phone || thread.contact?.phone}</span><small>{thread.contact?.stage || thread.funnelLead?.stage || 'Стадия не указана'}</small></div>)}</div>{recipients.length > 100 && <p className="muted">Показаны первые 100 из {recipients.length}.</p>}</section>
    </div>}
  </div>;
}

export function WhatsAppTemplatesPage() {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [clinicStatus, setClinicStatus] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [list, clinic] = await Promise.all([
        getGlobalWhatsAppTemplates(),
        fetch('/api/integrations/waba/flows/clinic/template', { cache: 'no-store' }).then(async response => ({ ok: response.ok, body: await response.json().catch(() => ({})) as { status?: string; error?: string } })),
      ]);
      setTemplates(list); setClinicStatus(clinic.body.status || (clinic.ok ? 'NOT_CREATED' : null));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить шаблоны'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const createClinicTemplate = async () => {
    setMessage(null);
    const response = await fetch('/api/integrations/waba/flows/clinic/template', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await response.json().catch(() => ({})) as { status?: string; error?: string };
    if (!response.ok) { setMessage(body.error || 'Не удалось создать шаблон'); return; }
    setMessage(`Шаблон записи создан. Статус Meta: ${body.status || 'PENDING'}.`); await load();
  };
  return <div className="stack suite-page"><PageHeader eyebrow="WABA Template Library" title="WhatsApp-шаблоны" text="Библиотека approved-шаблонов из текущего WhatsApp Business Account." action={<button className="button" onClick={() => void load()}><RefreshCw size={16}/>Обновить</button>}/>{message && <div className="alert">{message}</div>}
    <div className="suite-kpis"><article><FileText/><span>Доступно</span><strong>{number(templates.length)}</strong></article><article><CheckCircle2/><span>Flow «Запись»</span><strong>{clinicStatus || '—'}</strong></article></div>
    <section className="panel"><div className="suite-section-title"><div><h2>Шаблоны Meta</h2><p>API возвращает только одобренные и поддерживаемые шаблоны.</p></div><button className="button" onClick={() => void createClinicTemplate()}>Создать шаблон записи</button></div>{loading?<State text="Загружаем шаблоны…"/>:<div className="suite-template-grid">{templates.map(template => <article key={`${template.name}-${template.language}`}><header><span>{template.category || 'TEMPLATE'}</span><b>{template.status}</b></header><h3>{template.name}</h3><p>{template.body}</p><footer><span>{template.language}</span><span>{template.parameterCount} параметров</span></footer></article>)}</div>}</section>
  </div>;
}

function csvEscape(value: unknown): string { const text = String(value ?? ''); return `"${text.replace(/"/g,'""')}"`; }
function downloadCsv(filename: string, rows: unknown[][]) { const csv='\ufeff'+rows.map(row=>row.map(csvEscape).join(';')).join('\n'); const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const anchor=document.createElement('a'); anchor.href=url; anchor.download=filename; anchor.click(); URL.revokeObjectURL(url); }

export function ReportsPage() {
  const [daily,setDaily]=useState<DashboardDailyRow[]>([]); const [sources,setSources]=useState<SourceSummaryRow[]>([]); const [loading,setLoading]=useState(true); const [message,setMessage]=useState<string|null>(null);
  const load=async()=>{setLoading(true);try{const [a,b]=await Promise.all([marketingApi.dashboard(),marketingApi.sources()]);setDaily(a);setSources(b);}catch(error){setMessage(error instanceof Error?error.message:'Не удалось загрузить отчёт');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const totals=useMemo(()=>daily.reduce((a,r)=>({leads:a.leads+r.leads,sales:a.sales+r.sales,spend:a.spend+r.spend,revenue:a.revenue+r.revenue}),{leads:0,sales:0,spend:0,revenue:0}),[daily]);
  const exportSources=()=>downloadCsv(`imds-marketing-sources-${new Date().toISOString().slice(0,10)}.csv`,[['Источник','Платформа','Лиды','Продажи','Расход','Выручка','ROAS'],...sources.map(r=>[r.source,r.platform,r.leads,r.sales,r.spend,r.revenue,r.spend?r.revenue/r.spend:''])]);
  return <div className="stack suite-page"><PageHeader eyebrow="Reporting" title="Отчёты" text="Управленческий отчёт на фактических marketing dashboard и source данных с экспортом CSV." action={<button className="button" onClick={exportSources} disabled={!sources.length}><Download size={16}/>CSV</button>}/>{message&&<div className="alert">{message}</div>}<div className="suite-kpis"><article><UsersRound/><span>Лиды</span><strong>{loading?'—':number(totals.leads)}</strong></article><article><CheckCircle2/><span>Продажи</span><strong>{loading?'—':number(totals.sales)}</strong></article><article><BarChart3/><span>Расход</span><strong>{loading?'—':money(totals.spend)}</strong></article><article><BarChart3/><span>Выручка</span><strong>{loading?'—':money(totals.revenue)}</strong></article></div><section className="panel"><h2>Каналы</h2>{loading?<State text="Формируем отчёт…"/>:<div className="table-wrap"><table><thead><tr><th>Источник</th><th>Платформа</th><th>Лиды</th><th>Продажи</th><th>Расход</th><th>Выручка</th><th>ROAS</th></tr></thead><tbody>{sources.map(row=><tr key={`${row.source}-${row.platform}`}><td><b>{row.source}</b></td><td>{row.platform}</td><td>{number(row.leads)}</td><td>{number(row.sales)}</td><td>{money(row.spend)}</td><td>{money(row.revenue)}</td><td>{row.spend?(row.revenue/row.spend).toFixed(2)+'x':'—'}</td></tr>)}</tbody></table></div>}</section></div>;
}

export function DataQualityPage() {
  const [leads,setLeads]=useState<MarketingLead[]>([]); const [loading,setLoading]=useState(true); const [message,setMessage]=useState<string|null>(null);
  const load=async()=>{setLoading(true);try{setLeads(await marketingApi.listLeads({limit:1000}));}catch(error){setMessage(error instanceof Error?error.message:'Не удалось проверить качество данных');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const issues=useMemo(()=>{const phoneCounts=new Map<string,number>();leads.forEach(l=>{const p=(l.phone||'').replace(/\D/g,'');if(p)phoneCounts.set(p,(phoneCounts.get(p)||0)+1);});return leads.map(lead=>({lead,problems:[!lead.manager?'Нет менеджера':'',!lead.source&&!lead.utm_source?'Нет источника':'',!lead.utm_campaign&&!lead.campaign?'Нет кампании/UTM':'',!lead.phone?'Нет телефона':'',((phoneCounts.get((lead.phone||'').replace(/\D/g,''))||0)>1)?'Дубликат телефона':''].filter(Boolean)})).filter(item=>item.problems.length);},[leads]);
  const missingUtm=leads.filter(l=>!l.utm_source&&!l.utm_campaign&&!l.utm_medium).length; const unassigned=leads.filter(l=>!l.manager).length; const duplicates=issues.filter(i=>i.problems.includes('Дубликат телефона')).length;
  const exportIssues=()=>downloadCsv(`imds-data-quality-${new Date().toISOString().slice(0,10)}.csv`,[['ID','Клиент','Телефон','Стадия','Проблемы'],...issues.map(i=>[i.lead.id,i.lead.name,i.lead.phone,i.lead.stage,i.problems.join(', ')])]);
  return <div className="stack suite-page"><PageHeader eyebrow="Data governance" title="Качество данных" text="Автоматическая проверка CRM-лидов на UTM, назначение менеджера, источник и потенциальные дубликаты." action={<button className="button" onClick={()=>void load()}><RefreshCw size={16}/>Проверить</button>}/>{message&&<div className="alert">{message}</div>}<div className="suite-kpis"><article><AlertTriangle/><span>Проблемные записи</span><strong>{loading?'—':number(issues.length)}</strong></article><article><Database/><span>Без UTM</span><strong>{loading?'—':number(missingUtm)}</strong></article><article><UsersRound/><span>Без менеджера</span><strong>{loading?'—':number(unassigned)}</strong></article><article><AlertTriangle/><span>Дубли телефонов</span><strong>{loading?'—':number(duplicates)}</strong></article></div><section className="panel"><div className="suite-section-title"><div><h2>Найденные проблемы</h2><p>Проверяются первые 1000 лидов текущего API.</p></div><button className="button" onClick={exportIssues} disabled={!issues.length}><Download size={16}/>Экспорт</button></div>{loading?<State text="Проверяем данные…"/>:<div className="table-wrap"><table><thead><tr><th>Клиент</th><th>Телефон</th><th>Стадия</th><th>Проблемы</th></tr></thead><tbody>{issues.slice(0,300).map(({lead,problems})=><tr key={lead.id}><td><b>{lead.name}</b><small>{lead.source||lead.platform||'Источник не указан'}</small></td><td>{lead.phone||'—'}</td><td>{lead.stage}</td><td><div className="suite-issue-tags">{problems.map(problem=><span key={problem}>{problem}</span>)}</div></td></tr>)}</tbody></table></div>}</section></div>;
}
