import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';
import { marketingApi, type MarketingLead } from '../services/api';
import type { WhatsAppTemplate } from '../services/callCenterChat';
import '../marketing-suite.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));

function State({ text }: { text: string }) {
  return <div className="suite-state">{text}</div>;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = '\ufeff' + rows.map((row) => row.map(csvEscape).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function getTemplates(): Promise<WhatsAppTemplate[]> {
  const response = await fetch('/api/integrations/waba/templates', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as { templates?: WhatsAppTemplate[]; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Не удалось загрузить WhatsApp-шаблоны: HTTP ${response.status}`);
  return payload?.templates || [];
}

export function SafeWhatsAppTemplatesPage() {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clinicStatus, setClinicStatus] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [list, clinic] = await Promise.all([
        getTemplates(),
        fetch('/api/integrations/waba/flows/clinic/template', { cache: 'no-store' }).then(async (response) => ({
          ok: response.ok,
          body: await response.json().catch(() => ({})) as { status?: string; error?: string },
        })),
      ]);
      setTemplates(list);
      setClinicStatus(clinic.body.status || (clinic.ok ? 'NOT_CREATED' : null));
      if (!clinic.ok && clinic.body.error) setMessage(clinic.body.error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить шаблоны');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createClinicTemplate = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/waba/flows/clinic/template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await response.json().catch(() => ({})) as { status?: string; error?: string };
      if (!response.ok) throw new Error(body.error || 'Не удалось создать шаблон');
      setMessage(`Шаблон записи отправлен в Meta. Статус: ${body.status || 'PENDING'}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать шаблон');
    } finally {
      setBusy(false);
    }
  };

  const canCreate = !loading && !busy && !['PENDING', 'APPROVED'].includes(String(clinicStatus || '').toUpperCase());

  return <div className="stack suite-page">
    <div className="suite-page-head">
      <div>
        <span>WABA Template Library</span>
        <h1>WhatsApp-шаблоны</h1>
        <p>Библиотека шаблонов текущего WhatsApp Business Account. Повторная отправка шаблона записи блокируется, пока он уже PENDING или APPROVED.</p>
      </div>
      <button className="button" disabled={loading || busy} onClick={() => void load()}>
        <RefreshCw size={16}/>{loading ? 'Обновление…' : 'Обновить'}
      </button>
    </div>
    {message && <div className="alert">{message}</div>}
    <div className="suite-kpis">
      <article><FileText/><span>Доступно</span><strong>{loading ? '—' : number(templates.length)}</strong></article>
      <article><CheckCircle2/><span>Flow «Запись»</span><strong>{clinicStatus || '—'}</strong></article>
    </div>
    <section className="panel">
      <div className="suite-section-title">
        <div><h2>Шаблоны Meta</h2><p>Статус берётся из WABA/Meta API.</p></div>
        <button className="button" disabled={!canCreate} onClick={() => void createClinicTemplate()}>
          {busy ? 'Создание…' : clinicStatus && ['PENDING', 'APPROVED'].includes(clinicStatus.toUpperCase()) ? 'Шаблон уже создан' : 'Создать шаблон записи'}
        </button>
      </div>
      {loading ? <State text="Загружаем шаблоны…"/> : <div className="suite-template-grid">
        {templates.map((template) => <article key={`${template.name}-${template.language}`}>
          <header><span>{template.category || 'TEMPLATE'}</span><b>{template.status}</b></header>
          <h3>{template.name}</h3>
          <p>{template.body}</p>
          <footer><span>{template.language}</span><span>{template.parameterCount} параметров</span></footer>
        </article>)}
        {!templates.length && <State text="Одобренных шаблонов пока нет."/>}
      </div>}
    </section>
  </div>;
}

function normalizedPhone(value?: string | null) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

type QualityIssue = {
  lead: MarketingLead;
  problems: string[];
};

const issueFilters = [
  'Все проблемы',
  'Нет менеджера',
  'Нет источника',
  'Нет кампании/UTM',
  'Нет телефона',
  'Дубликат телефона',
] as const;

type IssueFilter = typeof issueFilters[number];

export function SafeDataQualityPage() {
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('Все проблемы');

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      setLeads(await marketingApi.listLeads({ limit: 1000 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось проверить качество данных');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const analysis = useMemo(() => {
    const phoneGroups = new Map<string, MarketingLead[]>();
    for (const lead of leads) {
      const phone = normalizedPhone(lead.phone);
      if (phone) phoneGroups.set(phone, [...(phoneGroups.get(phone) || []), lead]);
    }

    const duplicateGroups = [...phoneGroups.values()].filter((group) => group.length > 1);
    const duplicateIds = new Set(duplicateGroups.flatMap((group) => group.map((lead) => lead.id)));

    const issues: QualityIssue[] = leads
      .map((lead) => ({
        lead,
        problems: [
          !lead.manager ? 'Нет менеджера' : '',
          !lead.source && !lead.utm_source ? 'Нет источника' : '',
          !lead.utm_campaign && !lead.campaign ? 'Нет кампании/UTM' : '',
          !normalizedPhone(lead.phone) ? 'Нет телефона' : '',
          duplicateIds.has(lead.id) ? 'Дубликат телефона' : '',
        ].filter(Boolean),
      }))
      .filter((item) => item.problems.length);

    const issueCounts = Object.fromEntries(
      issueFilters.slice(1).map((filter) => [filter, issues.filter((item) => item.problems.includes(filter)).length]),
    ) as Record<Exclude<IssueFilter, 'Все проблемы'>, number>;

    const cleanRecords = Math.max(0, leads.length - issues.length);
    const healthScore = leads.length ? Math.round((cleanRecords / leads.length) * 100) : 100;

    return {
      issues,
      issueCounts,
      healthScore,
      cleanRecords,
      duplicateGroups: duplicateGroups.length,
      duplicateRecords: duplicateIds.size,
      missingUtm: leads.filter((lead) => !lead.utm_source && !lead.utm_campaign && !lead.utm_medium).length,
      unassigned: leads.filter((lead) => !lead.manager).length,
    };
  }, [leads]);

  const filteredIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return analysis.issues.filter((item) => {
      if (issueFilter !== 'Все проблемы' && !item.problems.includes(issueFilter)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        item.lead.name,
        item.lead.phone,
        item.lead.email,
        item.lead.manager,
        item.lead.source,
        item.lead.platform,
        item.lead.stage,
        ...item.problems,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [analysis.issues, issueFilter, query]);

  const exportIssues = () => downloadCsv(
    `imds-data-quality-${new Date().toISOString().slice(0, 10)}.csv`,
    [
      ['ID', 'Клиент', 'Телефон', 'Стадия', 'Менеджер', 'Источник', 'Проблемы'],
      ...filteredIssues.map((item) => [
        item.lead.id,
        item.lead.name,
        item.lead.phone,
        item.lead.stage,
        item.lead.manager,
        item.lead.source || item.lead.utm_source,
        item.problems.join(', '),
      ]),
    ],
  );

  return <div className="stack suite-page quality-page">
    <div className="suite-page-head">
      <div>
        <span>Data Governance</span>
        <h1>Качество данных</h1>
        <p>Контроль CRM-данных перед аналитикой, рекламной атрибуцией и автоматизациями. Проверяем до 1000 последних лидов и показываем конкретные записи, которые требуют исправления.</p>
      </div>
      <button className="button" disabled={loading} onClick={() => void load()}>
        <RefreshCw size={16}/>{loading ? 'Проверка…' : 'Проверить данные'}
      </button>
    </div>

    {message && <div className="alert">{message}</div>}

    <div className="suite-kpis suite-kpis--quality">
      <article className="quality-health-card">
        <ShieldCheck/>
        <span>Индекс качества</span>
        <strong>{loading ? '—' : `${analysis.healthScore}%`}</strong>
        <small>{loading ? '' : `${number(analysis.cleanRecords)} чистых записей`}</small>
      </article>
      <article>
        <AlertTriangle/>
        <span>Проблемные записи</span>
        <strong>{loading ? '—' : number(analysis.issues.length)}</strong>
        <small>{loading ? '' : `из ${number(leads.length)} проверенных`}</small>
      </article>
      <article>
        <Database/>
        <span>Без UTM</span>
        <strong>{loading ? '—' : number(analysis.missingUtm)}</strong>
        <small>{loading ? '' : 'нет utm_source / campaign / medium'}</small>
      </article>
      <article>
        <UsersRound/>
        <span>Без менеджера</span>
        <strong>{loading ? '—' : number(analysis.unassigned)}</strong>
        <small>{loading ? '' : 'требуют назначения'}</small>
      </article>
      <article>
        <AlertTriangle/>
        <span>Дубли телефонов</span>
        <strong>{loading ? '—' : number(analysis.duplicateGroups)}</strong>
        <small>{loading ? '' : `${number(analysis.duplicateRecords)} записей`}</small>
      </article>
    </div>

    <section className="panel quality-panel">
      <div className="suite-section-title quality-section-title">
        <div>
          <h2>Найденные проблемы</h2>
          <p>Телефоны нормализуются перед проверкой: +7/8 и форматирование не создают ложные дубликаты.</p>
        </div>
        <div className="quality-result-count">
          <span>Показано</span>
          <strong>{loading ? '—' : number(filteredIssues.length)}</strong>
        </div>
      </div>

      <div className="quality-toolbar">
        <label className="quality-search">
          <Search size={16}/>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Клиент, телефон, менеджер, источник…"
          />
        </label>
        <button className="button" onClick={exportIssues} disabled={loading || !filteredIssues.length}>
          <Download size={16}/>Экспорт CSV
        </button>
      </div>

      <div className="quality-filterbar" aria-label="Фильтр проблем">
        <span className="quality-filter-label"><SlidersHorizontal size={14}/>Фильтр</span>
        {issueFilters.map((filter) => {
          const count = filter === 'Все проблемы'
            ? analysis.issues.length
            : analysis.issueCounts[filter as Exclude<IssueFilter, 'Все проблемы'>];
          return <button
            type="button"
            key={filter}
            className={issueFilter === filter ? 'is-active' : ''}
            onClick={() => setIssueFilter(filter)}
            disabled={loading}
          >
            <span>{filter}</span><b>{loading ? '—' : number(count || 0)}</b>
          </button>;
        })}
      </div>

      {loading ? <State text="Проверяем данные…"/> : filteredIssues.length ? <div className="table-wrap quality-table-wrap">
        <table className="quality-table">
          <thead>
            <tr><th>Клиент</th><th>Телефон</th><th>Менеджер</th><th>Стадия</th><th>Проблемы</th></tr>
          </thead>
          <tbody>
            {filteredIssues.slice(0, 300).map(({ lead, problems }) => <tr key={lead.id}>
              <td><b>{lead.name || 'Без имени'}</b><small>{lead.source || lead.platform || lead.utm_source || 'Источник не указан'}</small></td>
              <td>{lead.phone || '—'}</td>
              <td>{lead.manager || <span className="quality-empty-value">Не назначен</span>}</td>
              <td><span className="quality-stage">{lead.stage || '—'}</span></td>
              <td><div className="suite-issue-tags">{problems.map((problem) => <span key={problem}>{problem}</span>)}</div></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <State text={analysis.issues.length ? 'По выбранному фильтру проблем нет.' : 'Проблем не найдено. Данные выглядят чистыми.'}/>} 
    </section>
  </div>;
}
