import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BarChart3,
  Eye,
  EyeOff,
  LayoutGrid,
  Pencil,
  Plus,
  Save,
  Settings2,
  Table2,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthGate';
import { marketingApi } from '../services/api';
import {
  workspaceApi,
  type WorkspaceBlock,
  type WorkspaceBlockInput,
  type WorkspaceBlockKind,
} from '../services/workspace';
import './workspace-builder.css';

type SourceKey = 'dashboard' | 'leads' | 'calls' | 'ads' | 'sources';
type ChartType = 'pie' | 'donut' | 'bar' | 'line' | 'area' | 'stacked';
type Row = Record<string, unknown>;
type FieldSpec = { key: string; label: string; numeric?: boolean; temporal?: boolean };
type SystemTarget = {
  key: string;
  title: string;
  element: HTMLElement;
  table?: HTMLTableElement;
  columns: string[];
};

type EditingState =
  | { type: 'system'; target: SystemTarget; block?: WorkspaceBlock }
  | { type: 'custom'; block?: WorkspaceBlock };

const SOURCE_FIELDS: Record<SourceKey, FieldSpec[]> = {
  dashboard: [
    { key: 'date', label: 'Дата', temporal: true },
    { key: 'leads', label: 'Лиды', numeric: true },
    { key: 'target_leads', label: 'Целевые лиды', numeric: true },
    { key: 'arrived', label: 'Пришли', numeric: true },
    { key: 'sales', label: 'Продажи', numeric: true },
    { key: 'spend', label: 'Расход', numeric: true },
    { key: 'revenue', label: 'Выручка', numeric: true },
  ],
  leads: [
    { key: 'name', label: 'Клиент' },
    { key: 'source', label: 'Источник' },
    { key: 'platform', label: 'Платформа' },
    { key: 'campaign', label: 'Кампания' },
    { key: 'stage', label: 'Стадия' },
    { key: 'manager', label: 'Ответственный' },
    { key: 'city', label: 'Город' },
    { key: 'sale_amount', label: 'Сумма продажи', numeric: true },
    { key: 'lead_created_at', label: 'Создан', temporal: true },
  ],
  calls: [
    { key: 'operator_name', label: 'Оператор' },
    { key: 'source', label: 'Источник' },
    { key: 'channel', label: 'Канал' },
    { key: 'call_status', label: 'Статус' },
    { key: 'call_result', label: 'Результат' },
    { key: 'duration_seconds', label: 'Длительность', numeric: true },
    { key: 'quality_score', label: 'Оценка', numeric: true },
    { key: 'started_at', label: 'Начало', temporal: true },
  ],
  ads: [
    { key: 'platform', label: 'Платформа' },
    { key: 'account_name', label: 'Кабинет' },
    { key: 'campaign_name', label: 'Кампания' },
    { key: 'adset_name', label: 'Группа' },
    { key: 'creative_name', label: 'Объявление' },
    { key: 'status', label: 'Статус' },
    { key: 'impressions', label: 'Показы', numeric: true },
    { key: 'clicks', label: 'Клики', numeric: true },
    { key: 'spend', label: 'Расход', numeric: true },
    { key: 'leads', label: 'Лиды', numeric: true },
    { key: 'target_leads', label: 'Целевые', numeric: true },
    { key: 'arrived', label: 'Пришли', numeric: true },
    { key: 'sales', label: 'Продажи', numeric: true },
    { key: 'revenue', label: 'Выручка', numeric: true },
  ],
  sources: [
    { key: 'source', label: 'Источник' },
    { key: 'platform', label: 'Платформа' },
    { key: 'leads', label: 'Лиды', numeric: true },
    { key: 'target_leads', label: 'Целевые', numeric: true },
    { key: 'arrived', label: 'Пришли', numeric: true },
    { key: 'sales', label: 'Продажи', numeric: true },
    { key: 'spend', label: 'Расход', numeric: true },
    { key: 'revenue', label: 'Выручка', numeric: true },
  ],
};

const SOURCE_LABEL: Record<SourceKey, string> = {
  dashboard: 'Dashboard Daily',
  leads: 'CRM Лиды',
  calls: 'Звонки',
  ads: 'Реклама',
  sources: 'Источники',
};

const CHART_LABEL: Record<ChartType, string> = {
  pie: 'Круговая',
  donut: 'Donut',
  bar: 'Столбчатая',
  line: 'Линейная',
  area: 'Динамика Area',
  stacked: 'Stacked',
};

const PALETTE = ['#2563eb', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444'];

function normalize(value: string) {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'block';
}

function fieldLabel(source: SourceKey, key: string) {
  return SOURCE_FIELDS[source].find((field) => field.key === key)?.label || key;
}

function numericFields(source: SourceKey) {
  return SOURCE_FIELDS[source].filter((field) => field.numeric);
}

function dimensionFields(source: SourceKey) {
  return SOURCE_FIELDS[source].filter((field) => !field.numeric);
}

function directTitle(element: HTMLElement): string {
  const stored = element.dataset.workspaceOriginalTitle;
  if (stored) return stored;
  const node = element.matches('table')
    ? element.closest('article,section,.panel')?.querySelector<HTMLElement>('h1,h2,h3,header strong')
    : element.querySelector<HTMLElement>(':scope > span:first-child, :scope > header h2, :scope > header h3, :scope > h2, :scope > h3');
  const title = node?.textContent?.replace(/\s+/g, ' ').trim() || (element.matches('table') ? 'Таблица' : 'Виджет');
  element.dataset.workspaceOriginalTitle = title;
  return title;
}

function titleNode(element: HTMLElement): HTMLElement | null {
  return element.matches('table')
    ? element.closest('article,section,.panel')?.querySelector<HTMLElement>('h1,h2,h3,header strong') || null
    : element.querySelector<HTMLElement>(':scope > span:first-child, :scope > header h2, :scope > header h3, :scope > h2, :scope > h3');
}

function scanTargets(root: HTMLElement): SystemTarget[] {
  const selector = [
    '.marketing-kpis article',
    '.dashboard-v36-kpis article',
    '.v36-kpi',
    '.metric',
    '.dashboard-chart-card',
    '.lead-table-panel',
    '.inbox-header-stats > span',
    '.panel',
    'table',
  ].join(',');
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector))
    .filter((node) => !node.closest('.workspace-builder-drawer,.workspace-custom-blocks,.data-inspector__panel'));
  const counts = new Map<string, number>();
  return nodes.map((element) => {
    const title = directTitle(element);
    const base = `${element.matches('table') ? 'table' : 'widget'}:${normalize(title)}`;
    const occurrence = (counts.get(base) || 0) + 1;
    counts.set(base, occurrence);
    const table = element.matches('table') ? element as HTMLTableElement : undefined;
    const columns = table
      ? Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean)
      : [];
    return { key: `system:${base}:${occurrence}`, title, element, table, columns };
  });
}

function applyTableColumns(table: HTMLTableElement, hiddenColumns: string[]) {
  Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th')).forEach((header, index) => {
    const name = header.textContent?.replace(/\s+/g, ' ').trim() || '';
    const hidden = hiddenColumns.includes(name);
    header.style.display = hidden ? 'none' : '';
    table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
      const cell = row.children[index] as HTMLElement | undefined;
      if (cell) cell.style.display = hidden ? 'none' : '';
    });
  });
}

function applySystemConfig(target: SystemTarget, block?: WorkspaceBlock) {
  target.element.style.display = block && !block.isVisible ? 'none' : '';
  const node = titleNode(target.element);
  if (node) node.textContent = block?.title || target.title;
  const hiddenColumns = Array.isArray(block?.config.hiddenColumns)
    ? block!.config.hiddenColumns.filter((value): value is string => typeof value === 'string')
    : [];
  if (target.table) applyTableColumns(target.table, hiddenColumns);
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

async function loadSource(source: SourceKey): Promise<Row[]> {
  if (source === 'dashboard') return (await marketingApi.dashboard()) as unknown as Row[];
  if (source === 'leads') return (await marketingApi.listLeads({ limit: 500 })) as unknown as Row[];
  if (source === 'calls') return (await marketingApi.calls({ limit: 500 })) as unknown as Row[];
  if (source === 'ads') return (await marketingApi.ads()) as unknown as Row[];
  return (await marketingApi.sources()) as unknown as Row[];
}

function rowMetric(row: Row, field: string) {
  return field === '__count__' ? 1 : Number(row[field] || 0);
}

function groupData(rows: Row[], dimension: string, metrics: string[], aggregate: string) {
  const map = new Map<string, { name: string; values: Record<string, number>; counts: Record<string, number> }>();
  rows.forEach((row) => {
    const name = String(row[dimension] ?? 'Не определено').slice(0, 70);
    const item = map.get(name) || { name, values: {}, counts: {} };
    metrics.forEach((metric) => {
      item.values[metric] = (item.values[metric] || 0) + rowMetric(row, metric);
      item.counts[metric] = (item.counts[metric] || 0) + 1;
    });
    map.set(name, item);
  });
  return [...map.values()].map((item) => ({
    name: item.name,
    ...Object.fromEntries(metrics.map((metric) => [
      metric,
      aggregate === 'avg'
        ? (item.values[metric] || 0) / Math.max(item.counts[metric] || 1, 1)
        : item.values[metric] || 0,
    ])),
  })).slice(0, 30);
}

function funnelData(source: SourceKey, rows: Row[], fields: string[]) {
  if (source === 'leads' && fields.includes('__crm_funnel__')) {
    return [
      { name: 'Все лиды', value: rows.length },
      { name: 'Целевые', value: rows.filter((row) => row.is_target === true).length },
      { name: 'Записаны', value: rows.filter((row) => Boolean(row.appointment_at)).length },
      { name: 'Пришли', value: rows.filter((row) => Boolean(row.arrived_at)).length },
      { name: 'Продажи', value: rows.filter((row) => Boolean(row.sold_at)).length },
    ];
  }
  return fields.map((field) => ({
    name: fieldLabel(source, field),
    value: rows.reduce((sum, row) => sum + rowMetric(row, field), 0),
  }));
}

function EditButton({ editable, onClick }: { editable: boolean; onClick: () => void }) {
  if (!editable) return null;
  return <button className="workspace-block-edit workspace-block-edit--inline" onClick={onClick}><Pencil size={13}/> Изменить</button>;
}

function ChartCanvas({ block, rows, source }: { block: WorkspaceBlock; rows: Row[]; source: SourceKey }) {
  const config = block.config;
  if (block.kind === 'funnel') {
    const fields = Array.isArray(config.fields)
      ? config.fields.filter((value): value is string => typeof value === 'string')
      : source === 'leads' ? ['__crm_funnel__'] : numericFields(source).slice(0, 5).map((field) => field.key);
    const data = funnelData(source, rows, fields);
    return <ResponsiveContainer width="100%" height="100%">
      <FunnelChart>
        <Tooltip/>
        <Funnel dataKey="value" data={data} fill="#2563eb" isAnimationActive>
          <LabelList dataKey="name" position="right" fill="#cbd5e1"/>
          <LabelList dataKey="value" position="center" fill="#ffffff"/>
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>;
  }

  const chartType = (typeof config.chartType === 'string' ? config.chartType : 'bar') as ChartType;
  const dimension = typeof config.dimension === 'string' ? config.dimension : dimensionFields(source)[0]?.key || 'source';
  const metrics = Array.isArray(config.metrics)
    ? config.metrics.filter((value): value is string => typeof value === 'string')
    : [numericFields(source)[0]?.key || '__count__'];
  const safeMetrics = metrics.length ? metrics : [numericFields(source)[0]?.key || '__count__'];
  const aggregate = typeof config.aggregate === 'string' ? config.aggregate : 'sum';
  const data = groupData(rows, dimension, safeMetrics, aggregate);

  if (chartType === 'pie' || chartType === 'donut') {
    return <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip/>
        <Legend/>
        <Pie data={data} dataKey={safeMetrics[0]} nameKey="name" innerRadius={chartType === 'donut' ? 72 : 0} outerRadius={118}>
          {data.map((_, index) => <Cell key={index} fill={PALETTE[index % PALETTE.length]}/>) }
        </Pie>
      </PieChart>
    </ResponsiveContainer>;
  }

  if (chartType === 'line') {
    return <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="name" stroke="#64748b"/><YAxis stroke="#64748b"/><Tooltip/><Legend/>
        {safeMetrics.map((metric, index) => <Line key={metric} type="monotone" dataKey={metric} name={fieldLabel(source, metric)} stroke={PALETTE[index % PALETTE.length]} strokeWidth={2}/>) }
      </LineChart>
    </ResponsiveContainer>;
  }

  if (chartType === 'area') {
    return <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="name" stroke="#64748b"/><YAxis stroke="#64748b"/><Tooltip/><Legend/>
        {safeMetrics.map((metric, index) => <Area key={metric} type="monotone" dataKey={metric} name={fieldLabel(source, metric)} stroke={PALETTE[index % PALETTE.length]} fill={PALETTE[index % PALETTE.length]} fillOpacity={0.18}/>) }
      </AreaChart>
    </ResponsiveContainer>;
  }

  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data}>
      <CartesianGrid stroke="#1e2d4a" vertical={false}/><XAxis dataKey="name" stroke="#64748b"/><YAxis stroke="#64748b"/><Tooltip/><Legend/>
      {safeMetrics.map((metric, index) => <Bar key={metric} dataKey={metric} name={fieldLabel(source, metric)} stackId={chartType === 'stacked' ? 'stack' : undefined} fill={PALETTE[index % PALETTE.length]}/>) }
    </BarChart>
  </ResponsiveContainer>;
}

function CustomBlock({ block, editable, onEdit }: { block: WorkspaceBlock; editable: boolean; onEdit: (block: WorkspaceBlock) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const source = (block.dataSource || 'leads') as SourceKey;

  useEffect(() => {
    let active = true;
    loadSource(source)
      .then((data) => { if (active) { setRows(data); setError(null); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [source]);

  if (!block.isVisible) return null;
  const config = block.config;

  if (block.kind === 'metric') {
    const field = typeof config.field === 'string' ? config.field : '__count__';
    const aggregate = typeof config.aggregate === 'string' ? config.aggregate : 'count';
    const values = rows.map((row) => rowMetric(row, field)).filter(Number.isFinite);
    const value = aggregate === 'avg'
      ? (values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0)
      : aggregate === 'count' || field === '__count__'
        ? rows.length
        : values.reduce((sum, item) => sum + item, 0);
    return <article className="workspace-custom-metric data-inspector-anchor">
      {editable && <button className="workspace-block-edit" onClick={() => onEdit(block)}><Pencil size={13}/></button>}
      <span>{block.title}</span><strong>{valueLabel(value)}</strong><small>{SOURCE_LABEL[source]} · {aggregate}</small>
    </article>;
  }

  if (block.kind === 'table') {
    const columns = Array.isArray(config.columns)
      ? config.columns.filter((value): value is string => typeof value === 'string')
      : SOURCE_FIELDS[source].slice(0, 5).map((field) => field.key);
    const limit = Math.min(Math.max(Number(config.limit || 20), 1), 100);
    return <article className="panel workspace-custom-table">
      <header><div><h2>{block.title}</h2><p>{SOURCE_LABEL[source]}</p></div><EditButton editable={editable} onClick={() => onEdit(block)}/></header>
      {error ? <p className="note">{error}</p> : <div className="workspace-table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{fieldLabel(source, column)}</th>)}</tr></thead><tbody>{rows.slice(0, limit).map((row, index) => <tr key={String(row.id || row.row_key || index)}>{columns.map((column) => <td key={column}>{valueLabel(row[column])}</td>)}</tr>)}</tbody></table></div>}
    </article>;
  }

  return <article className="panel workspace-custom-chart">
    <header><div><h2>{block.title}</h2><p>{block.kind === 'funnel' ? 'Воронка' : CHART_LABEL[(typeof config.chartType === 'string' ? config.chartType : 'bar') as ChartType]} · {SOURCE_LABEL[source]}</p></div><EditButton editable={editable} onClick={() => onEdit(block)}/></header>
    {error ? <p className="note">{error}</p> : <div className="workspace-chart-canvas"><ChartCanvas block={block} rows={rows} source={source}/></div>}
  </article>;
}

function ToggleList({ values, options, onChange }: { values: string[]; options: FieldSpec[]; onChange: (values: string[]) => void }) {
  return <fieldset><legend>Показатели / поля</legend>{options.map((field) => {
    const checked = values.includes(field.key);
    return <label className="workspace-builder-switch" key={field.key}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked ? [...values, field.key] : values.filter((item) => item !== field.key))}/>
      <span>{field.label}</span>
    </label>;
  })}</fieldset>;
}

export default function WorkspaceBuilderLayer() {
  const { user } = useAuth();
  const location = useLocation();
  const [blocks, setBlocks] = useState<WorkspaceBlock[]>([]);
  const [targets, setTargets] = useState<SystemTarget[]>([]);
  const [editable, setEditable] = useState(user.role === 'administrator');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await workspaceApi.list(location.pathname);
      setBlocks(result.blocks);
      setEditable(result.editable);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [location.pathname]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.marketing-content');
    if (!root) return;
    let frame = 0;
    const scan = () => setTargets(scanTargets(root));
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scan); };
    scan();
    const observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => (mutation.target as Element)?.closest?.('.workspace-builder-drawer,.workspace-custom-blocks,.data-inspector'))) return;
      schedule();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [location.pathname]);

  const blockByKey = useMemo(() => new Map(blocks.filter((block) => block.isSystem).map((block) => [block.blockKey, block])), [blocks]);
  useEffect(() => { targets.forEach((target) => applySystemConfig(target, blockByKey.get(target.key))); }, [targets, blockByKey]);

  const customBlocks = blocks.filter((block) => !block.isSystem && block.kind !== 'system');

  const editSystem = (target: SystemTarget) => {
    const block = blockByKey.get(target.key);
    setDraft({
      title: block?.title || target.title,
      isVisible: block?.isVisible ?? true,
      hiddenColumns: Array.isArray(block?.config.hiddenColumns) ? block!.config.hiddenColumns : [],
    });
    setEditing({ type: 'system', target, block });
  };

  const editCustom = (block?: WorkspaceBlock, kind: WorkspaceBlockKind = 'metric') => {
    const source = (block?.dataSource || 'leads') as SourceKey;
    const actualKind = block?.kind || kind;
    setDraft({
      title: block?.title || (actualKind === 'metric' ? 'Новый показатель' : actualKind === 'table' ? 'Новая таблица' : actualKind === 'funnel' ? 'Новая воронка' : 'Новая диаграмма'),
      kind: actualKind,
      dataSource: source,
      field: block?.config.field || '__count__',
      aggregate: block?.config.aggregate || (actualKind === 'metric' ? 'count' : 'sum'),
      columns: block?.config.columns || SOURCE_FIELDS[source].slice(0, 5).map((field) => field.key),
      limit: block?.config.limit || 20,
      chartType: block?.config.chartType || 'bar',
      dimension: block?.config.dimension || dimensionFields(source)[0]?.key || '',
      metrics: block?.config.metrics || numericFields(source).slice(0, 2).map((field) => field.key),
      fields: block?.config.fields || (source === 'leads' ? ['__crm_funnel__'] : numericFields(source).slice(0, 5).map((field) => field.key)),
      isVisible: block?.isVisible ?? true,
    });
    setEditing({ type: 'custom', block });
  };

  const saveEditing = async () => {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      if (editing.type === 'system') {
        const input: WorkspaceBlockInput = {
          route: location.pathname,
          blockKey: editing.target.key,
          kind: 'system',
          title: String(draft.title || editing.target.title),
          dataSource: null,
          config: { hiddenColumns: Array.isArray(draft.hiddenColumns) ? draft.hiddenColumns : [] },
          layout: {},
          isVisible: draft.isVisible !== false,
          isSystem: true,
        };
        if (editing.block?.id) await workspaceApi.patch(editing.block.id, { title: input.title, config: input.config, isVisible: input.isVisible });
        else await workspaceApi.save(input);
      } else {
        const kind = String(draft.kind || 'metric') as WorkspaceBlockKind;
        const source = String(draft.dataSource || 'leads') as SourceKey;
        let config: Record<string, unknown> = {};
        if (kind === 'metric') config = { field: String(draft.field || '__count__'), aggregate: String(draft.aggregate || 'count') };
        if (kind === 'table') config = { columns: Array.isArray(draft.columns) ? draft.columns : [], limit: Math.min(Math.max(Number(draft.limit || 20), 1), 100) };
        if (kind === 'chart') config = { chartType: String(draft.chartType || 'bar'), dimension: String(draft.dimension || dimensionFields(source)[0]?.key || ''), metrics: Array.isArray(draft.metrics) ? draft.metrics : [], aggregate: String(draft.aggregate || 'sum') };
        if (kind === 'funnel') config = { fields: Array.isArray(draft.fields) ? draft.fields : [] };
        const input: WorkspaceBlockInput = {
          route: location.pathname,
          blockKey: editing.block?.blockKey || `custom:${kind}:${crypto.randomUUID()}`,
          kind,
          title: String(draft.title || 'Блок'),
          dataSource: source,
          config,
          layout: {},
          isVisible: draft.isVisible !== false,
          isSystem: false,
        };
        if (editing.block?.id) await workspaceApi.patch(editing.block.id, { title: input.title, dataSource: input.dataSource, config: input.config, isVisible: input.isVisible });
        else await workspaceApi.save(input);
      }
      setEditing(null);
      await reload();
      setMessage('Изменения сохранены');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const removeCustom = async (block: WorkspaceBlock) => {
    if (!confirm(`Удалить блок «${block.title}»?`)) return;
    try {
      await workspaceApi.remove(block.id);
      setEditing(null);
      await reload();
      setMessage('Блок удалён');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (!editable && customBlocks.length === 0 && blocks.length === 0) return null;

  const source = String(draft.dataSource || 'leads') as SourceKey;
  const kind = String(draft.kind || 'metric') as WorkspaceBlockKind;
  const selectedColumns = Array.isArray(draft.columns) ? draft.columns.filter((value): value is string => typeof value === 'string') : [];
  const selectedMetrics = Array.isArray(draft.metrics) ? draft.metrics.filter((value): value is string => typeof value === 'string') : [];
  const selectedFunnelFields = Array.isArray(draft.fields) ? draft.fields.filter((value): value is string => typeof value === 'string') : [];

  const drawer = editable && open ? <div className="workspace-builder-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
    <aside className="workspace-builder-drawer">
      <header><div><span>IMDS WORKSPACE BUILDER</span><h2>Настройка экрана</h2><p>{location.pathname}</p></div><button onClick={() => setOpen(false)}><X size={18}/></button></header>
      <div className="workspace-builder-actions workspace-builder-actions--four">
        <button onClick={() => editCustom(undefined, 'metric')}><Plus size={15}/> KPI</button>
        <button onClick={() => editCustom(undefined, 'table')}><Table2 size={15}/> Таблица</button>
        <button onClick={() => editCustom(undefined, 'chart')}><BarChart3 size={15}/> Диаграмма</button>
        <button onClick={() => editCustom(undefined, 'funnel')}><TrendingUp size={15}/> Воронка</button>
      </div>
      {message && <div className="workspace-builder-message">{message}</div>}
      <section><h3>Текущие виджеты и таблицы</h3><div className="workspace-builder-list">{targets.map((target) => {
        const block = blockByKey.get(target.key);
        return <button key={target.key} className="workspace-builder-row" onClick={() => editSystem(target)}>
          <span>{target.table ? <Table2 size={15}/> : <LayoutGrid size={15}/>}<b>{block?.title || target.title}</b><small>{target.table ? `${target.columns.length} колонок` : 'Системный виджет'}</small></span>
          {(block?.isVisible ?? true) ? <Eye size={15}/> : <EyeOff size={15}/>} 
        </button>;
      })}</div></section>
      <section><h3>Созданные блоки</h3>{customBlocks.length ? <div className="workspace-builder-list">{customBlocks.map((block) => <button key={block.id} className="workspace-builder-row" onClick={() => editCustom(block, block.kind)}>
        <span>{block.kind === 'table' ? <Table2 size={15}/> : block.kind === 'chart' ? <BarChart3 size={15}/> : block.kind === 'funnel' ? <TrendingUp size={15}/> : <LayoutGrid size={15}/>}<b>{block.title}</b><small>{block.dataSource ? SOURCE_LABEL[block.dataSource as SourceKey] : 'Источник'} · {block.kind}</small></span>
        {block.isVisible ? <Eye size={15}/> : <EyeOff size={15}/>} 
      </button>)}</div> : <p className="note">Пока нет пользовательских блоков.</p>}</section>
    </aside>
  </div> : null;

  const editor = editing ? <div className="workspace-builder-editor-backdrop"><div className="workspace-builder-editor">
    <header><div><span>{editing.type === 'system' ? 'СИСТЕМНЫЙ БЛОК' : 'ПОЛЬЗОВАТЕЛЬСКИЙ БЛОК'}</span><h3>{editing.type === 'system' ? editing.target.title : editing.block?.title || 'Новый блок'}</h3></div><button onClick={() => setEditing(null)}><X size={17}/></button></header>
    <label>Название<input value={String(draft.title || '')} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}/></label>
    <label className="workspace-builder-switch"><input type="checkbox" checked={draft.isVisible !== false} onChange={(event) => setDraft((value) => ({ ...value, isVisible: event.target.checked }))}/><span>Показывать блок</span></label>

    {editing.type === 'system' && editing.target.table && <ToggleList
      values={Array.isArray(draft.hiddenColumns) ? editing.target.columns.filter((column) => !draft.hiddenColumns?.includes?.(column)) : editing.target.columns}
      options={editing.target.columns.map((column) => ({ key: column, label: column }))}
      onChange={(visible) => setDraft((value) => ({ ...value, hiddenColumns: editing.target.columns.filter((column) => !visible.includes(column)) }))}
    />}

    {editing.type === 'custom' && <>
      <label>Тип<select value={kind} onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value }))}>
        <option value="metric">KPI / число</option><option value="table">Таблица</option><option value="chart">Диаграмма</option><option value="funnel">Воронка</option>
      </select></label>
      <label>Источник<select value={source} onChange={(event) => {
        const next = event.target.value as SourceKey;
        setDraft((value) => ({ ...value, dataSource: next, dimension: dimensionFields(next)[0]?.key || '', metrics: numericFields(next).slice(0, 2).map((field) => field.key), fields: next === 'leads' ? ['__crm_funnel__'] : numericFields(next).slice(0, 5).map((field) => field.key), columns: SOURCE_FIELDS[next].slice(0, 5).map((field) => field.key) }));
      }}>{Object.entries(SOURCE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>

      {kind === 'metric' && <>
        <label>Поле<select value={String(draft.field || '__count__')} onChange={(event) => setDraft((value) => ({ ...value, field: event.target.value }))}><option value="__count__">Количество записей</option>{numericFields(source).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
        <label>Расчёт<select value={String(draft.aggregate || 'count')} onChange={(event) => setDraft((value) => ({ ...value, aggregate: event.target.value }))}><option value="count">COUNT</option><option value="sum">SUM</option><option value="avg">AVG</option></select></label>
      </>}

      {kind === 'table' && <>
        <ToggleList values={selectedColumns} options={SOURCE_FIELDS[source]} onChange={(columns) => setDraft((value) => ({ ...value, columns }))}/>
        <label>Строк на экране<input type="number" min="1" max="100" value={Number(draft.limit || 20)} onChange={(event) => setDraft((value) => ({ ...value, limit: Number(event.target.value) }))}/></label>
      </>}

      {kind === 'chart' && <>
        <label>Вид диаграммы<select value={String(draft.chartType || 'bar')} onChange={(event) => setDraft((value) => ({ ...value, chartType: event.target.value }))}>{Object.entries(CHART_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Группировать по<select value={String(draft.dimension || '')} onChange={(event) => setDraft((value) => ({ ...value, dimension: event.target.value }))}>{dimensionFields(source).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
        <ToggleList values={selectedMetrics} options={numericFields(source)} onChange={(metrics) => setDraft((value) => ({ ...value, metrics: metrics.slice(0, 5) }))}/>
        <label>Агрегация<select value={String(draft.aggregate || 'sum')} onChange={(event) => setDraft((value) => ({ ...value, aggregate: event.target.value }))}><option value="sum">SUM</option><option value="avg">AVG</option></select></label>
      </>}

      {kind === 'funnel' && (source === 'leads' ? <fieldset><legend>Этапы воронки</legend><label className="workspace-builder-switch"><input type="checkbox" checked={selectedFunnelFields.includes('__crm_funnel__')} onChange={(event) => setDraft((value) => ({ ...value, fields: event.target.checked ? ['__crm_funnel__'] : [] }))}/><span>Лиды → Целевые → Записаны → Пришли → Продажи</span></label></fieldset> : <ToggleList values={selectedFunnelFields} options={numericFields(source)} onChange={(fields) => setDraft((value) => ({ ...value, fields }))}/>) }
    </>}

    <footer>
      {editing.type === 'custom' && editing.block ? <button className="danger" onClick={() => void removeCustom(editing.block!)}><Trash2 size={15}/> Удалить</button> : <span/>}
      <span/>
      <button onClick={() => setEditing(null)}>Отмена</button>
      <button className="primary" disabled={saving} onClick={() => void saveEditing()}><Save size={15}/>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
    </footer>
  </div></div> : null;

  return <>
    {editable && <button className="workspace-builder-launch" onClick={() => setOpen(true)}><Settings2 size={15}/> Настроить экран</button>}
    {customBlocks.length > 0 && <section className="workspace-custom-blocks">{customBlocks.map((block) => <CustomBlock key={block.id} block={block} editable={editable} onEdit={(item) => editCustom(item, item.kind)}/>)}</section>}
    {typeof document !== 'undefined' && drawer ? createPortal(drawer, document.body) : null}
    {typeof document !== 'undefined' && editor ? createPortal(editor, document.body) : null}
  </>;
}
