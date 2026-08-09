import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, Database, Info, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import './data-inspector.css';

export type DataQuality = 'fresh' | 'delayed' | 'partial' | 'error' | 'unknown';

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
  compact?: boolean;
  className?: string;
};

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
  compact = false,
  className = '',
}: DataInspectorProps) {
  const [open, setOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const qualityCopy = QUALITY_COPY[quality];
  const QualityIcon = qualityCopy.icon;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <span ref={rootRef} className={`data-inspector ${compact ? 'data-inspector--compact' : ''} ${className}`.trim()}>
    <button
      type="button"
      className="data-inspector__trigger"
      aria-label={`Информация о данных: ${title}`}
      aria-expanded={open}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      title={`Как формируется показатель «${title}»`}
    >
      <Info size={compact ? 13 : 14}/>
    </button>

    {open && <span className="data-inspector__panel" role="dialog" aria-label={`Информация о показателе ${title}`} onClick={(event) => event.stopPropagation()}>
      <span className="data-inspector__header">
        <span>
          <small>IMDS DATA INSPECTOR</small>
          <strong>{title}</strong>
        </span>
        <button type="button" className="data-inspector__close" onClick={() => setOpen(false)} aria-label="Закрыть"><X size={15}/></button>
      </span>

      <span className={`data-inspector__quality data-inspector__quality--${quality}`}>
        <QualityIcon size={14}/>
        <span><b>{qualityCopy.label}</b>{qualityNote && <small>{qualityNote}</small>}</span>
      </span>

      <span className="data-inspector__section">
        <b>Что показывает</b>
        <span>{description}</span>
      </span>

      {sources.length > 0 && <span className="data-inspector__section">
        <b>Источники</b>
        <span className="data-inspector__chips">{sources.map((source) => <em key={source}>{source}</em>)}</span>
      </span>}

      {fields.length > 0 && <span className="data-inspector__section">
        <b>Какие данные получает IMDS</b>
        <span className="data-inspector__fields">{fields.map((field) => <code key={field}>{field}</code>)}</span>
      </span>}

      {formula && <span className="data-inspector__section">
        <b>Как рассчитывается</b>
        <code className="data-inspector__formula">{formula}</code>
      </span>}

      {filters.length > 0 && <span className="data-inspector__section">
        <b>Фильтры</b>
        <span>{filters.join(' · ')}</span>
      </span>}

      {example.length > 0 && <span className="data-inspector__section data-inspector__example">
        <b>Пример</b>
        {example.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
      </span>}

      <span className="data-inspector__updated"><Clock3 size={13}/> Обновлено: {friendlyUpdatedAt(updatedAt)}</span>

      {technical.length > 0 && <span className="data-inspector__technical">
        <button type="button" onClick={() => setTechnicalOpen((value) => !value)}>
          <ShieldCheck size={14}/> Технические данные {technicalOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
        </button>
        {technicalOpen && <span>{technical.map((line) => <code key={line}>{line}</code>)}</span>}
      </span>}
    </span>}
  </span>;
}
