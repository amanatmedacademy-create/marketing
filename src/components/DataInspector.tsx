import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Clock3, Database, Info, Route, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { resolveInspectorKnowledge } from './dataInspectorCatalog';
import './data-inspector.css';

export type DataQuality = 'fresh' | 'delayed' | 'partial' | 'error' | 'unknown';

export type DataBreakdownItem = {
  label: string;
  value: string;
  detail?: string;
};

export type DataInspectorProps = {
  title: string;
  description: string;
  sources?: string[];
  fields?: string[];
  formula?: string;
  example?: string[];
  filters?: string[];
  updatedAt?: string | null;
  quality?: DataQuality;
  qualityNote?: string;
  technical?: string[];
  why?: string[];
  breakdown?: DataBreakdownItem[];
  lineage?: string[];
  compact?: boolean;
  className?: string;
};

type PanelPosition = { top: number; left: number; width: number; maxHeight: number };

const QUALITY_COPY: Record<DataQuality, { label: string; icon: typeof CheckCircle2 }> = {
  fresh: { label: 'Актуальные данные', icon: CheckCircle2 },
  delayed: { label: 'Есть задержка', icon: Clock3 },
  partial: { label: 'Частичные данные', icon: TriangleAlert },
  error: { label: 'Ошибка источника', icon: TriangleAlert },
  unknown: { label: 'Статус не определён', icon: Database },
};

function friendlyUpdatedAt(value?: string | null): string {
  if (!value) return 'по текущей синхронизации';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function directText(parent: Element | null, selector: string): string {
  const node = parent?.querySelector(selector);
  return node?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function inferNearbyBreakdown(root: HTMLSpanElement | null): DataBreakdownItem[] {
  if (!root) return [];
  const kpiArticle = root.closest('.dashboard-v36-kpis article, .marketing-kpis article, .v36-kpi, .metric');
  if (kpiArticle) {
    const value = directText(kpiArticle, ':scope > strong');
    const detail = directText(kpiArticle, ':scope > small');
    if (value) return [{ label: 'Текущее значение', value, detail: detail || undefined }];
  }
  const stat = root.closest('.inbox-header-stats > span');
  if (stat) {
    const value = directText(stat, ':scope > b');
    const label = (stat.textContent || '').replace(value, '').replace(/\s+/g, ' ').trim();
    if (value) return [{ label: label || 'Текущее значение', value }];
  }
  return [];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function calculatePanelPosition(trigger: HTMLElement): PanelPosition {
  const rect = trigger.getBoundingClientRect();
  const content = document.querySelector<HTMLElement>('.marketing-content')?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const gutter = 14;
  const gap = 10;
  const width = Math.min(390, viewportWidth - gutter * 2);
  const minLeft = Math.max(gutter, (content?.left ?? 0) + gutter);
  const maxLeft = Math.max(minLeft, viewportWidth - width - gutter);

  let left = rect.right - width;
  if (left < minLeft) left = rect.right + gap;
  left = Math.min(maxLeft, Math.max(minLeft, left));

  const preferredTop = rect.bottom + 9;
  const minimumPanelRoom = Math.min(520, viewportHeight - gutter * 2);
  let top = preferredTop;
  if (viewportHeight - preferredTop - gutter < 280) {
    top = Math.max(gutter, rect.top - minimumPanelRoom - gap);
  }
  const maxHeight = Math.max(220, viewportHeight - top - gutter);
  return { top, left, width, maxHeight };
}

export default function DataInspector({
  title,
  description,
  sources = [],
  fields = [],
  formula,
  example = [],
  filters = [],
  updatedAt,
  quality = 'unknown',
  qualityNote,
  technical = [],
  why = [],
  breakdown = [],
  lineage = [],
  compact = false,
  className = '',
}: DataInspectorProps) {
  const [open, setOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [liveBreakdown, setLiveBreakdown] = useState<DataBreakdownItem[]>([]);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const qualityCopy = QUALITY_COPY[quality];
  const QualityIcon = qualityCopy.icon;
  const knowledge = useMemo(() => resolveInspectorKnowledge(typeof window === 'undefined' ? '' : window.location.pathname, title), [title]);
  const resolvedSources = useMemo(() => unique([...sources, ...(knowledge.sources || [])]), [knowledge.sources, sources]);
  const resolvedFields = useMemo(() => unique([...fields, ...(knowledge.fields || [])]), [fields, knowledge.fields]);
  const resolvedTechnical = useMemo(() => unique([...technical, ...(knowledge.technical || [])]), [knowledge.technical, technical]);

  useEffect(() => {
    if (!open || !rootRef.current) return;
    setLiveBreakdown(inferNearbyBreakdown(rootRef.current));

    const updatePosition = () => {
      if (rootRef.current) setPanelPosition(calculatePanelPosition(rootRef.current));
    };
    updatePosition();

    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const resolvedBreakdown = breakdown.length ? breakdown : liveBreakdown;
  const resolvedWhy = useMemo(() => {
    if (why.length) return why;
    const lines: string[] = [];
    if (resolvedBreakdown[0]?.value) lines.push(`Сейчас интерфейс показывает ${resolvedBreakdown[0].value}.`);
    if (formula) lines.push(`IMDS применяет формулу: ${formula}.`);
    else lines.push('IMDS берёт фактические записи источников, нормализует их и агрегирует для текущего виджета.');
    if (filters.length) lines.push(`Перед расчётом применяются фильтры: ${filters.join(' · ')}.`);
    if (resolvedSources.length) lines.push(`В расчёте участвуют данные: ${resolvedSources.join(', ')}.`);
    return lines;
  }, [filters, formula, resolvedBreakdown, resolvedSources, why]);

  const resolvedLineage = useMemo(() => {
    if (lineage.length) return lineage;
    if (knowledge.lineage?.length) return knowledge.lineage;
    const first = resolvedSources.length ? resolvedSources.slice(0, 3).join(' + ') : 'Источник данных';
    return [first, 'IMDS Data Layer', formula ? 'Расчёт / нормализация' : 'Валидация / фильтры', title];
  }, [formula, knowledge.lineage, lineage, resolvedSources, title]);

  const panel = open && panelPosition ? <span
    ref={panelRef}
    className="data-inspector__panel data-inspector__panel--viewport"
    role="dialog"
    aria-label={`Информация о показателе ${title}`}
    style={{ top: panelPosition.top, left: panelPosition.left, width: panelPosition.width, maxHeight: panelPosition.maxHeight }}
    onClick={(event) => event.stopPropagation()}
  >
    <span className="data-inspector__header">
      <span><small>IMDS DATA INSPECTOR</small><strong>{title}</strong></span>
      <button type="button" className="data-inspector__close" onClick={() => setOpen(false)} aria-label="Закрыть"><X size={15}/></button>
    </span>

    <span className={`data-inspector__quality data-inspector__quality--${quality}`}>
      <QualityIcon size={14}/><span><b>{qualityCopy.label}</b>{qualityNote && <small>{qualityNote}</small>}</span>
    </span>

    <span className="data-inspector__section"><b>Что показывает</b><span>{description}</span></span>

    {(resolvedWhy.length > 0 || resolvedBreakdown.length > 0) && <span className="data-inspector__explain">
      <button type="button" onClick={() => setWhyOpen((value) => !value)} aria-expanded={whyOpen}>
        <CircleHelp size={15}/><span>Почему это число?</span>{whyOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
      </button>
      {whyOpen && <span className="data-inspector__explain-body">
        {resolvedBreakdown.length > 0 && <span className="data-inspector__breakdown">
          {resolvedBreakdown.map((item, index) => <span className="data-inspector__breakdown-row" key={`${item.label}-${index}`}>
            <span><b>{item.label}</b>{item.detail && <small>{item.detail}</small>}</span><strong>{item.value}</strong>
          </span>)}
        </span>}
        {resolvedWhy.length > 0 && <span className="data-inspector__why-list">{resolvedWhy.map((line, index) => <span key={`${line}-${index}`}><i>{index + 1}</i><span>{line}</span></span>)}</span>}
      </span>}
    </span>}

    {resolvedSources.length > 0 && <span className="data-inspector__section"><b>Источники</b><span className="data-inspector__chips">{resolvedSources.map((source) => <em key={source}>{source}</em>)}</span></span>}

    {resolvedLineage.length > 1 && <span className="data-inspector__section">
      <b>Путь данных</b>
      <span className="data-inspector__lineage">
        <span className="data-inspector__lineage-title"><Route size={13}/> Data Lineage</span>
        <span className="data-inspector__lineage-flow">{resolvedLineage.map((step, index) => <span className="data-inspector__lineage-part" key={`${step}-${index}`}>
          <span className="data-inspector__lineage-node"><small>{index === 0 ? 'SOURCE' : index === resolvedLineage.length - 1 ? 'RESULT' : 'PROCESS'}</small><b>{step}</b></span>
          {index < resolvedLineage.length - 1 && <ArrowRight className="data-inspector__lineage-arrow" size={14}/>}
        </span>)}</span>
      </span>
    </span>}

    {resolvedFields.length > 0 && <span className="data-inspector__section"><b>Какие данные получает IMDS</b><span className="data-inspector__fields">{resolvedFields.map((field) => <code key={field}>{field}</code>)}</span></span>}
    {formula && <span className="data-inspector__section"><b>Как рассчитывается</b><code className="data-inspector__formula">{formula}</code></span>}
    {filters.length > 0 && <span className="data-inspector__section"><b>Фильтры</b><span>{filters.join(' · ')}</span></span>}
    {example.length > 0 && <span className="data-inspector__section data-inspector__example"><b>Пример</b>{example.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</span>}
    <span className="data-inspector__updated"><Clock3 size={13}/> Обновлено: {friendlyUpdatedAt(updatedAt)}</span>

    {resolvedTechnical.length > 0 && <span className="data-inspector__technical">
      <button type="button" onClick={() => setTechnicalOpen((value) => !value)}><ShieldCheck size={14}/> Технические данные {technicalOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
      {technicalOpen && <span>{resolvedTechnical.map((line) => <code key={line}>{line}</code>)}</span>}
    </span>}
  </span> : null;

  return <span ref={rootRef} className={`data-inspector ${compact ? 'data-inspector--compact' : ''} ${className}`.trim()}>
    <button type="button" className="data-inspector__trigger" aria-label={`Информация о данных: ${title}`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} title={`Как формируется показатель «${title}»`}>
      <Info size={compact ? 13 : 14}/>
    </button>
    {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
  </span>;
}
