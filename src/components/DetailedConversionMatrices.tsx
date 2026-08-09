import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import DataInspector from './DataInspector';
import '../conversion-matrix.css';

type Bucket = { leads: number; appointments: number; rate: number };
type MatrixRow = {
  id: string;
  label: string;
  platform: string;
  level: 'total' | 'platform' | 'source';
  hours: Bucket[];
  weekdays: Bucket[];
  delays: Bucket[];
};
type MatrixResponse = { period: { from: string; to: string; days: number }; rows: MatrixRow[] };

const week = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const platformTone = (platform: string) => {
  const value = platform.toLowerCase();
  if (value.includes('meta')) return 'meta';
  if (value.includes('tiktok')) return 'tiktok';
  if (value.includes('яндекс') || value.includes('yandex')) return 'yandex';
  if (value.includes('вконтакте') || value.includes('vk')) return 'vk';
  if (value.includes('google')) return 'google';
  if (value.includes('органик')) return 'organic';
  return 'other';
};
const heat = (rate: number) => rate >= 60 ? 'matrix-heat-excellent' : rate >= 35 ? 'matrix-heat-good' : rate >= 15 ? 'matrix-heat-warning' : rate > 0 ? 'matrix-heat-danger' : 'matrix-heat-empty';

function MatrixTable({ title, subtitle, headers, field, rows, period }: {
  title: string;
  subtitle: string;
  headers: string[];
  field: 'hours' | 'weekdays' | 'delays';
  rows: MatrixRow[];
  period: MatrixResponse['period'];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const total = rows.find((row) => row.level === 'total');
  const platforms = rows.filter((row) => row.level === 'platform');
  const sourcesByPlatform = useMemo(() => new Map(platforms.map((platform) => [platform.platform, rows.filter((row) => row.level === 'source' && row.platform === platform.platform)])), [platforms, rows]);
  const dimension = field === 'hours' ? 'час создания лида' : field === 'weekdays' ? 'день недели создания лида' : 'задержка до записи';

  const renderRow = (row: MatrixRow) => <tr key={row.id} className={`matrix-row matrix-row--${row.level} matrix-platform-${platformTone(row.platform)}`}>
    <td>
      {row.level === 'platform' ? <button type="button" onClick={() => setExpanded((current) => ({ ...current, [row.id]: !current[row.id] }))}>{expanded[row.id] ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<strong>{row.label}</strong><span>{sourcesByPlatform.get(row.platform)?.length || 0}</span></button> : <div className="matrix-row-label"><strong>{row.label}</strong>{row.level === 'total' && <span>avg</span>}</div>}
    </td>
    {row[field].map((bucket, index) => <td key={index} className={heat(bucket.rate)} title={`${bucket.leads} лидов · ${bucket.appointments} записей`}><b>{bucket.rate ? `${Math.round(bucket.rate)}%` : '—'}</b>{bucket.leads > 0 && <small>{bucket.appointments}/{bucket.leads}</small>}</td>)}
  </tr>;

  return <section className="conversion-matrix-panel">
    <header><div><h2 className="data-inspector-card-title">{title}<DataInspector
      compact
      title={title}
      description={`Показывает фактическую конверсию лидов в запись в разрезе: ${dimension}.`}
      sources={['IMDS CRM', 'Источники лидов']}
      fields={['lead_created_at', 'appointment_at', 'platform', 'source', 'lead_id']}
      formula="Конверсия = количество записанных лидов / количество созданных лидов × 100%"
      filters={['Текущая клиника', `${period.from} — ${period.to}`, `${period.days} дней`]}
      example={['20 лидов в сегменте', '7 записей', 'Конверсия = 35%']}
      quality="fresh"
      technical={['Endpoint: /api/analytics/conversion-matrix', `Dimension: ${field}`, 'Tenant: current company']}
    /></h2><p>{subtitle}</p></div><div className="matrix-actions"><button type="button" onClick={() => setExpanded(Object.fromEntries(platforms.map((row) => [row.id, true])))}>Все</button><button type="button" onClick={() => setExpanded({})}>Свернуть</button></div></header>
    <div className="conversion-matrix-scroll"><table><thead><tr><th><span className="data-inspector-row-title">Источник<DataInspector compact title="Источник" description="Группировка лидов по рекламной платформе и исходному источнику обращения." sources={['UTM/атрибуция', 'CRM']} fields={['platform', 'source', 'utm_source']} filters={['Текущая клиника']} quality="fresh" technical={['Group levels: total → platform → source']}/></span></th>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{total && renderRow(total)}{platforms.map((platform) => <Fragment key={platform.id}>{renderRow(platform)}{expanded[platform.id] && (sourcesByPlatform.get(platform.platform) || []).map(renderRow)}</Fragment>)}</tbody></table></div>
  </section>;
}

export default function DetailedConversionMatrices({ days = 7 }: { days?: number }) {
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/analytics/conversion-matrix?days=${days}`);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `HTTP ${response.status}`);
      setData(JSON.parse(body));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [days]);

  if (loading) return <section className="conversion-matrix-state"><LoaderCircle className="spin" size={20}/>Загрузка детальных матриц…</section>;
  if (error) return <section className="conversion-matrix-state conversion-matrix-state--error"><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={15}/>Повторить</button></section>;
  if (!data) return null;

  return <div className="conversion-matrix-stack">
    <MatrixTable title="Конверсия в запись по часам создания лида" subtitle="Источник × час создания — фактический процент лидов, записанных на приём" headers={Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)} field="hours" rows={data.rows} period={data.period}/>
    <MatrixTable title="Конверсия в запись по дням недели и дням с момента создания" subtitle="Слева — день создания лида, справа — через сколько дней состоялась запись" headers={[...week, ...Array.from({ length: 7 }, (_, index) => `ДЕНЬ ${index + 1}`)]} field="weekdays" rows={data.rows.map((row) => ({ ...row, weekdays: [...row.weekdays, ...row.delays] }))} period={data.period}/>
  </div>;
}