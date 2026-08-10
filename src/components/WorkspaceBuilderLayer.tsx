import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, LayoutGrid, Pencil, Plus, Save, Settings2, Table2, Trash2, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthGate';
import { marketingApi } from '../services/api';
import { workspaceApi, type WorkspaceBlock, type WorkspaceBlockInput } from '../services/workspace';
import './workspace-builder.css';

type SystemTarget = {
  key: string;
  title: string;
  kind: 'system';
  element: HTMLElement;
  table?: HTMLTableElement;
  columns: string[];
};

type SourceKey = 'dashboard' | 'leads' | 'calls' | 'ads' | 'sources';
type Row = Record<string, unknown>;

type FieldSpec = { key: string; label: string; numeric?: boolean };

const SOURCE_FIELDS: Record<SourceKey, FieldSpec[]> = {
  dashboard: [
    { key: 'date', label: 'Дата' }, { key: 'leads', label: 'Лиды', numeric: true }, { key: 'target_leads', label: 'Целевые лиды', numeric: true },
    { key: 'arrived', label: 'Пришли', numeric: true }, { key: 'sales', label: 'Продажи', numeric: true }, { key: 'spend', label: 'Расход', numeric: true }, { key: 'revenue', label: 'Выручка', numeric: true },
  ],
  leads: [
    { key: 'name', label: 'Клиент' }, { key: 'phone', label: 'Телефон' }, { key: 'email', label: 'Email' }, { key: 'source', label: 'Источник' },
    { key: 'platform', label: 'Платформа' }, { key: 'campaign', label: 'Кампания' }, { key: 'stage', label: 'Стадия' }, { key: 'manager', label: 'Ответственный' },
    { key: 'is_target', label: 'Целевой' }, { key: 'sale_amount', label: 'Сумма продажи', numeric: true }, { key: 'lead_created_at', label: 'Создан' },
    { key: 'appointment_at', label: 'Запись' }, { key: 'arrived_at', label: 'Приход' }, { key: 'sold_at', label: 'Продажа' },
  ],
  calls: [
    { key: 'client_name', label: 'Клиент' }, { key: 'client_phone', label: 'Телефон' }, { key: 'operator_name', label: 'Оператор' }, { key: 'source', label: 'Источник' },
    { key: 'call_status', label: 'Статус' }, { key: 'duration_seconds', label: 'Длительность', numeric: true }, { key: 'quality_score', label: 'Оценка', numeric: true },
    { key: 'appointment_created', label: 'Запись создана' }, { key: 'next_action', label: 'Следующее действие' }, { key: 'started_at', label: 'Начало' },
  ],
  ads: [
    { key: 'platform', label: 'Платформа' }, { key: 'account_name', label: 'Кабинет' }, { key: 'campaign_name', label: 'Кампания' }, { key: 'adset_name', label: 'Группа' },
    { key: 'creative_name', label: 'Объявление' }, { key: 'status', label: 'Статус' }, { key: 'impressions', label: 'Показы', numeric: true }, { key: 'clicks', label: 'Клики', numeric: true },
    { key: 'spend', label: 'Расход', numeric: true }, { key: 'leads', label: 'Лиды', numeric: true }, { key: 'target_leads', label: 'Целевые', numeric: true },
    { key: 'arrived', label: 'Пришли', numeric: true }, { key: 'sales', label: 'Продажи', numeric: true }, { key: 'revenue', label: 'Выручка', numeric: true },
  ],
  sources: [
    { key: 'source', label: 'Источник' }, { key: 'platform', label: 'Платформа' }, { key: 'leads', label: 'Лиды', numeric: true }, { key: 'target_leads', label: 'Целевые', numeric: true },
    { key: 'arrived', label: 'Пришли', numeric: true }, { key: 'sales', label: 'Продажи', numeric: true }, { key: 'spend', label: 'Расход', numeric: true }, { key: 'revenue', label: 'Выручка', numeric: true },
  ],
};

const SOURCE_LABEL: Record<SourceKey, string> = { dashboard: 'Dashboard Daily', leads: 'CRM Лиды', calls: 'Звонки', ads: 'Реклама', sources: 'Источники' };

function normalize(value: string) { return value.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'block'; }
function directTitle(element: HTMLElement): string {
  const stored = element.dataset.workspaceOriginalTitle;
  if (stored) return stored;
  const titleNode = element.matches('table')
    ? element.closest('article,section,.panel')?.querySelector<HTMLElement>('h1,h2,h3,header strong')
    : element.querySelector<HTMLElement>(':scope > span:first-child, :scope > header h2, :scope > header h3, :scope > h2, :scope > h3');
  const title = titleNode?.textContent?.replace(/\s+/g, ' ').trim() || (element.matches('table') ? 'Таблица' : 'Виджет');
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
    '.marketing-kpis article', '.dashboard-v36-kpis article', '.v36-kpi', '.metric', '.dashboard-chart-card',
    '.lead-table-panel', '.inbox-header-stats > span', '.panel', 'table',
  ].join(',');
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((node) => !node.closest('.workspace-builder-drawer,.workspace-custom-blocks,.data-inspector__panel'));
  const counts = new Map<string, number>();
  return nodes.map((element) => {
    const title = directTitle(element);
    const kindName = element.matches('table') ? 'table' : 'widget';
    const base = `${kindName}:${normalize(title)}`;
    const occurrence = (counts.get(base) || 0) + 1;
    counts.set(base, occurrence);
    const table = element.matches('table') ? element as HTMLTableElement : undefined;
    const columns = table ? Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean) : [];
    return { key: `system:${base}:${occurrence}`, title, kind: 'system' as const, element, table, columns };
  });
}
function applyTableColumns(table: HTMLTableElement, hiddenColumns: string[]) {
  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'));
  headers.forEach((header, index) => {
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
  if (target.table) applyTableColumns(target.table, Array.isArray(block?.config.hiddenColumns) ? block!.config.hiddenColumns.filter((value): value is string => typeof value === 'string') : []);
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

function CustomBlock({ block, editable, onEdit }: { block: WorkspaceBlock; editable: boolean; onEdit: (block: WorkspaceBlock) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const source = (block.dataSource || 'leads') as SourceKey;
  useEffect(() => { let active = true; loadSource(source).then((data) => active && setRows(data)).catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason))); return () => { active = false; }; }, [source]);
  const config = block.config;
  if (!block.isVisible) return null;
  if (block.kind === 'metric') {
    const field = typeof config.field === 'string' ? config.field : '__count__';
    const aggregate = typeof config.aggregate === 'string' ? config.aggregate : 'count';
    let value = 0;
    if (aggregate === 'count' || field === '__count__') value = rows.length;
    else {
      const values = rows.map((row) => Number(row[field] || 0)).filter(Number.isFinite);
      value = aggregate === 'avg' ? (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0) : values.reduce((a, b) => a + b, 0);
    }
    return <article className="workspace-custom-metric data-inspector-anchor">
      {editable && <button className="workspace-block-edit" onClick={() => onEdit(block)} title="Изменить"><Pencil size={13}/></button>}
      <span>{block.title}</span><strong>{valueLabel(value)}</strong><small>{SOURCE_LABEL[source]} · {aggregate}</small>
    </article>;
  }
  const columns = Array.isArray(config.columns) ? config.columns.filter((value): value is string => typeof value === 'string') : SOURCE_FIELDS[source].slice(0, 5).map((item) => item.key);
  const limit = Math.min(Math.max(Number(config.limit || 20), 1), 100);
  const fieldMap = new Map(SOURCE_FIELDS[source].map((field) => [field.key, field.label]));
  return <article className="panel workspace-custom-table">
    <header><div><h2>{block.title}</h2><p>{SOURCE_LABEL[source]}</p></div>{editable && <button className="workspace-block-edit workspace-block-edit--inline" onClick={() => onEdit(block)}><Pencil size={13}/> Изменить</button>}</header>
    {error ? <p className="note">{error}</p> : <div className="workspace-table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{fieldMap.get(column) || column}</th>)}</tr></thead><tbody>{rows.slice(0, limit).map((row, index) => <tr key={String(row.id || row.row_key || index)}>{columns.map((column) => <td key={column}>{valueLabel(row[column])}</td>)}</tr>)}</tbody></table></div>}
  </article>;
}

export default function WorkspaceBuilderLayer() {
  const { user } = useAuth();
  const location = useLocation();
  const [blocks, setBlocks] = useState<WorkspaceBlock[]>([]);
  const [targets, setTargets] = useState<SystemTarget[]>([]);
  const [editable, setEditable] = useState(user.role === 'administrator');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ type: 'system'; target: SystemTarget; block?: WorkspaceBlock } | { type: 'custom'; block?: WorkspaceBlock } | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await workspaceApi.list(location.pathname);
      setBlocks(result.blocks);
      setEditable(result.editable);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, [location.pathname]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.marketing-content');
    rootRef.current = root;
    if (!root) return;
    let frame = 0;
    const scan = () => { const next = scanTargets(root); setTargets(next); };
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
    setDraft({ title: block?.title || target.title, isVisible: block?.isVisible ?? true, hiddenColumns: Array.isArray(block?.config.hiddenColumns) ? block?.config.hiddenColumns : [] });
    setEditing({ type: 'system', target, block });
  };
  const editCustom = (block?: WorkspaceBlock, kind: 'metric' | 'table' = 'metric') => {
    const source = (block?.dataSource || 'leads') as SourceKey;
    setDraft({
      title: block?.title || (kind === 'metric' ? 'Новый показатель' : 'Новая таблица'), kind: block?.kind || kind, dataSource: source,
      field: block?.config.field || '__count__', aggregate: block?.config.aggregate || 'count', columns: block?.config.columns || SOURCE_FIELDS[source].slice(0, 5).map((field) => field.key), limit: block?.config.limit || 20,
      isVisible: block?.isVisible ?? true,
    });
    setEditing({ type: 'custom', block });
  };

  const saveEditing = async () => {
    if (!editing) return;
    setSaving(true); setMessage(null);
    try {
      if (editing.type === 'system') {
        const hiddenColumns = Array.isArray(draft.hiddenColumns) ? draft.hiddenColumns : [];
        const input: WorkspaceBlockInput = {
          route: location.pathname, blockKey: editing.target.key, kind: 'system', title: String(draft.title || editing.target.title), dataSource: null,
          config: { hiddenColumns }, layout: {}, isVisible: draft.isVisible !== false, isSystem: true,
        };
        if (editing.block?.id) await workspaceApi.patch(editing.block.id, { title: input.title, config: input.config, isVisible: input.isVisible }); else await workspaceApi.save(input);
      } else {
        const kind = draft.kind === 'table' ? 'table' : 'metric';
        const source = (String(draft.dataSource || 'leads')) as SourceKey;
        const config = kind === 'metric'
          ? { field: String(draft.field || '__count__'), aggregate: String(draft.aggregate || 'count') }
          : { columns: Array.isArray(draft.columns) ? draft.columns : [], limit: Math.min(Math.max(Number(draft.limit || 20), 1), 100) };
        const input: WorkspaceBlockInput = {
          route: location.pathname, blockKey: editing.block?.blockKey || `custom:${kind}:${crypto.randomUUID()}`, kind, title: String(draft.title || 'Блок'), dataSource: source,
          config, layout: {}, isVisible: draft.isVisible !== false, isSystem: false,
        };
        if (editing.block?.id) await workspaceApi.patch(editing.block.id, { title: input.title, dataSource: input.dataSource, config: input.config, isVisible: input.isVisible }); else await workspaceApi.save(input);
      }
      setEditing(null); await reload(); setMessage('Изменения сохранены');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  const removeCustom = async (block: WorkspaceBlock) => {
    if (!confirm(`Удалить блок «${block.title}»?`)) return;
    try { await workspaceApi.remove(block.id); setEditing(null); await reload(); setMessage('Блок удалён'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  if (!editable && customBlocks.length === 0 && blocks.length === 0) return null;

  const drawer = editable && open ? <div className="workspace-builder-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
    <aside className="workspace-builder-drawer">
      <header><div><span>IMDS WORKSPACE BUILDER</span><h2>Настройка экрана</h2><p>{location.pathname}</p></div><button onClick={() => setOpen(false)}><X size={18}/></button></header>
      <div className="workspace-builder-actions"><button onClick={() => editCustom(undefined, 'metric')}><Plus size={15}/> KPI</button><button onClick={() => editCustom(undefined, 'table')}><Table2 size={15}/> Таблицу</button></div>
      {message && <div className="workspace-builder-message">{message}</div>}
      <section><h3>Текущие виджеты и таблицы</h3><div className="workspace-builder-list">{targets.map((target) => {
        const block = blockByKey.get(target.key); const visible = block?.isVisible ?? true;
        return <button key={target.key} className="workspace-builder-row" onClick={() => editSystem(target)}><span>{target.table ? <Table2 size={15}/> : <LayoutGrid size={15}/>}<b>{block?.title || target.title}</b><small>{target.table ? `${target.columns.length} колонок` : 'Системный виджет'}</small></span>{visible ? <Eye size={15}/> : <EyeOff size={15}/>}</button>;
      })}</div></section>
      <section><h3>Созданные блоки</h3>{customBlocks.length ? <div className="workspace-builder-list">{customBlocks.map((block) => <button key={block.id} className="workspace-builder-row" onClick={() => editCustom(block, block.kind === 'table' ? 'table' : 'metric')}><span>{block.kind === 'table' ? <Table2 size={15}/> : <LayoutGrid size={15}/>}<b>{block.title}</b><small>{block.dataSource ? SOURCE_LABEL[block.dataSource as SourceKey] : 'Источник'}</small></span>{block.isVisible ? <Eye size={15}/> : <EyeOff size={15}/>}</button>)}</div> : <p className="note">Пока нет пользовательских блоков.</p>}</section>
    </aside>
  </div> : null;

  const editor = editing ? <div className="workspace-builder-editor-backdrop"><div className="workspace-builder-editor">
    <header><div><span>{editing.type === 'system' ? 'СИСТЕМНЫЙ БЛОК' : 'ПОЛЬЗОВАТЕЛЬСКИЙ БЛОК'}</span><h3>{editing.type === 'system' ? editing.target.title : editing.block?.title || 'Новый блок'}</h3></div><button onClick={() => setEditing(null)}><X size={17}/></button></header>
    <label>Название<input value={String(draft.title || '')} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}/></label>
    <label className="workspace-builder-switch"><input type="checkbox" checked={draft.isVisible !== false} onChange={(event) => setDraft((value) => ({ ...value, isVisible: event.target.checked }))}/><span>Показывать блок</span></label>
    {editing.type === 'system' && editing.target.table && editing.target.columns.length > 0 && <fieldset><legend>Колонки таблицы</legend>{editing.target.columns.map((column) => {
      const hidden = Array.isArray(draft.hiddenColumns) && draft.hiddenColumns.includes(column);
      return <label className="workspace-builder-switch" key={column}><input type="checkbox" checked={!hidden} onChange={(event) => setDraft((value) => {
        const current = Array.isArray(value.hiddenColumns) ? value.hiddenColumns.filter((item): item is string => typeof item === 'string') : [];
        return { ...value, hiddenColumns: event.target.checked ? current.filter((item) => item !== column) : [...current, column] };
      })}/><span>{column}</span></label>;
    })}</fieldset>}
    {editing.type === 'custom' && <>
      <label>Тип<select value={String(draft.kind || 'metric')} onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value }))}><option value="metric">KPI / число</option><option value="table">Таблица</option></select></label>
      <label>Источник<select value={String(draft.dataSource || 'leads')} onChange={(event) => { const source = event.target.value as SourceKey; setDraft((value) => ({ ...value, dataSource: source, field: '__count__', columns: SOURCE_FIELDS[source].slice(0, 5).map((field) => field.key) })); }}>{Object.entries(SOURCE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {draft.kind !== 'table' ? <>
        <label>Поле<select value={String(draft.field || '__count__')} onChange={(event) => setDraft((value) => ({ ...value, field: event.target.value }))}><option value="__count__">Количество записей</option>{SOURCE_FIELDS[(draft.dataSource || 'leads') as SourceKey].filter((field) => field.numeric).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
        <label>Расчёт<select value={String(draft.aggregate || 'count')} onChange={(event) => setDraft((value) => ({ ...value, aggregate: event.target.value }))}><option value="count">COUNT</option><option value="sum">SUM</option><option value="avg">AVG</option></select></label>
      </> : <>
        <fieldset><legend>Колонки</legend>{SOURCE_FIELDS[(draft.dataSource || 'leads') as SourceKey].map((field) => {
          const selected = Array.isArray(draft.columns) && draft.columns.includes(field.key);
          return <label className="workspace-builder-switch" key={field.key}><input type="checkbox" checked={selected} onChange={(event) => setDraft((value) => { const current = Array.isArray(value.columns) ? value.columns.filter((item): item is string => typeof item === 'string') : []; return { ...value, columns: event.target.checked ? [...current, field.key] : current.filter((item) => item !== field.key) }; })}/><span>{field.label}</span></label>;
        })}</fieldset>
        <label>Строк на экране<input type="number" min="1" max="100" value={Number(draft.limit || 20)} onChange={(event) => setDraft((value) => ({ ...value, limit: Number(event.target.value) }))}/></label>
      </>}
    </>}
    <footer>{editing.type === 'custom' && editing.block && <button className="danger" onClick={() => void removeCustom(editing.block!)}><Trash2 size={15}/> Удалить</button>}<span/><button onClick={() => setEditing(null)}>Отмена</button><button className="primary" disabled={saving} onClick={() => void saveEditing()}><Save size={15}/>{saving ? 'Сохраняем…' : 'Сохранить'}</button></footer>
  </div></div> : null;

  return <>
    {editable && <button className="workspace-builder-launch" onClick={() => setOpen(true)}><Settings2 size={15}/> Настроить экран</button>}
    {customBlocks.length > 0 && <section className="workspace-custom-blocks">{customBlocks.map((block) => <CustomBlock key={block.id} block={block} editable={editable} onEdit={(item) => editCustom(item, item.kind === 'table' ? 'table' : 'metric')}/>)}</section>}
    {typeof document !== 'undefined' && drawer ? createPortal(drawer, document.body) : null}
    {typeof document !== 'undefined' && editor ? createPortal(editor, document.body) : null}
  </>;
}
