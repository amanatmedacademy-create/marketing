import { useMemo, useState } from 'react';
import { ChevronDown, Columns3, Download, Filter, Search, SlidersHorizontal } from 'lucide-react';

type ChannelRow = {
  id: string;
  label: string;
  leads: number;
  sales: number;
  revenue: number;
};

type ViewId = 'overview' | 'traffic' | 'messages' | 'instagram' | 'video' | 'crm' | 'all';
type ColumnKey =
  | 'channel' | 'status' | 'objective' | 'budget' | 'spend' | 'reach' | 'impressions' | 'frequency' | 'cpm'
  | 'clicks' | 'linkClicks' | 'ctr' | 'cpc' | 'landingViews' | 'landingRate' | 'results' | 'costPerResult'
  | 'conversations' | 'replies' | 'costPerConversation' | 'profileVisits' | 'followers' | 'comments' | 'shares' | 'saves'
  | 'video3s' | 'videoAvg' | 'video25' | 'video50' | 'video75' | 'video95'
  | 'crmLeads' | 'sales' | 'conversion' | 'revenue' | 'cpl' | 'cac' | 'roas' | 'romi';

type Column = { key: ColumnKey; label: string; group: string; className?: string };

const allColumns: Column[] = [
  { key: 'channel', label: 'Канал / кабинет', group: 'Структура', className: 'sticky-column' },
  { key: 'status', label: 'Статус', group: 'Структура' },
  { key: 'objective', label: 'Цель', group: 'Структура' },
  { key: 'budget', label: 'Бюджет', group: 'Бюджет' },
  { key: 'spend', label: 'Расход', group: 'Бюджет' },
  { key: 'reach', label: 'Охват', group: 'Охват' },
  { key: 'impressions', label: 'Показы', group: 'Охват' },
  { key: 'frequency', label: 'Частота', group: 'Охват' },
  { key: 'cpm', label: 'CPM', group: 'Охват' },
  { key: 'clicks', label: 'Клики (все)', group: 'Трафик' },
  { key: 'linkClicks', label: 'Клики по ссылке', group: 'Трафик' },
  { key: 'ctr', label: 'CTR', group: 'Трафик' },
  { key: 'cpc', label: 'CPC', group: 'Трафик' },
  { key: 'landingViews', label: 'Просмотры страницы', group: 'Трафик' },
  { key: 'landingRate', label: 'Просмотр / клик', group: 'Трафик' },
  { key: 'results', label: 'Результаты кабинета', group: 'Результаты' },
  { key: 'costPerResult', label: 'Цена результата', group: 'Результаты' },
  { key: 'conversations', label: 'Начаты переписки', group: 'Сообщения' },
  { key: 'replies', label: 'Ответы', group: 'Сообщения' },
  { key: 'costPerConversation', label: 'Цена переписки', group: 'Сообщения' },
  { key: 'profileVisits', label: 'Посещения профиля', group: 'Instagram' },
  { key: 'followers', label: 'Подписки', group: 'Instagram' },
  { key: 'comments', label: 'Комментарии', group: 'Instagram' },
  { key: 'shares', label: 'Репосты', group: 'Instagram' },
  { key: 'saves', label: 'Сохранения', group: 'Instagram' },
  { key: 'video3s', label: 'Просмотры 3 сек.', group: 'Видео' },
  { key: 'videoAvg', label: 'Среднее время', group: 'Видео' },
  { key: 'video25', label: 'Видео 25%', group: 'Видео' },
  { key: 'video50', label: 'Видео 50%', group: 'Видео' },
  { key: 'video75', label: 'Видео 75%', group: 'Видео' },
  { key: 'video95', label: 'Видео 95%', group: 'Видео' },
  { key: 'crmLeads', label: 'Лиды CRM', group: 'CRM' },
  { key: 'sales', label: 'Продажи', group: 'CRM' },
  { key: 'conversion', label: 'Лид → продажа', group: 'CRM' },
  { key: 'revenue', label: 'Выручка', group: 'CRM' },
  { key: 'cpl', label: 'CPL', group: 'Экономика' },
  { key: 'cac', label: 'CAC', group: 'Экономика' },
  { key: 'roas', label: 'ROAS', group: 'Экономика' },
  { key: 'romi', label: 'ROMI', group: 'Экономика' },
];

const views: Array<{ id: ViewId; label: string; keys: ColumnKey[] }> = [
  { id: 'overview', label: 'Обзор', keys: ['channel','status','spend','reach','impressions','clicks','ctr','results','crmLeads','sales','revenue','romi'] },
  { id: 'traffic', label: 'Трафик', keys: ['channel','spend','reach','impressions','frequency','cpm','clicks','linkClicks','ctr','cpc','landingViews','landingRate'] },
  { id: 'messages', label: 'Сообщения', keys: ['channel','spend','results','costPerResult','conversations','replies','costPerConversation','crmLeads','sales','conversion'] },
  { id: 'instagram', label: 'Instagram', keys: ['channel','spend','reach','impressions','profileVisits','followers','comments','shares','saves','crmLeads'] },
  { id: 'video', label: 'Видео', keys: ['channel','spend','impressions','video3s','videoAvg','video25','video50','video75','video95','crmLeads'] },
  { id: 'crm', label: 'CRM и продажи', keys: ['channel','crmLeads','sales','conversion','revenue','cpl','cac','roas','romi'] },
  { id: 'all', label: 'Все показатели', keys: allColumns.map(column => column.key) },
];

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

function renderValue(row: ChannelRow, key: ColumnKey) {
  if (key === 'channel') return <div className="ads-entity-cell"><span>{row.label.slice(0, 1)}</span><div><strong>{row.label}</strong><small>Рекламный канал</small></div></div>;
  if (key === 'status') return <span className="ads-status-badge pending">API не подключён</span>;
  if (key === 'objective') return '—';
  if (key === 'crmLeads') return row.leads;
  if (key === 'sales') return row.sales;
  if (key === 'conversion') return `${row.leads ? Math.round(row.sales / row.leads * 100) : 0}%`;
  if (key === 'revenue') return money.format(row.revenue);
  return '—';
}

export function AdsPerformanceTable({ rows }: { rows: ChannelRow[] }) {
  const [view, setView] = useState<ViewId>('overview');
  const [query, setQuery] = useState('');
  const activeView = views.find(item => item.id === view) ?? views[0];
  const columns = useMemo(() => activeView.keys.map(key => allColumns.find(column => column.key === key)!).filter(Boolean), [activeView]);
  const filteredRows = rows.filter(row => row.label.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = columns.reduce<Array<{ name: string; span: number }>>((result, column) => {
    const last = result[result.length - 1];
    if (last?.name === column.group) last.span += 1;
    else result.push({ name: column.group, span: 1 });
    return result;
  }, []);

  return <section className="ads-card ads-performance-table-card">
    <header className="ads-performance-head">
      <div><h2>Рекламные кабинеты</h2><p>Структура показателей построена по выгрузке Ads Manager: охват, трафик, сообщения, Instagram, видео и CRM.</p></div>
      <div className="ads-performance-actions"><button><Download size={14} /> Экспорт</button><button><SlidersHorizontal size={14} /> Настроить</button></div>
    </header>

    <div className="ads-table-controls">
      <div className="ads-column-views">{views.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
      <div className="ads-table-tools">
        <label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск кабинета" /></label>
        <button><Filter size={14} /> Фильтры</button>
        <button><Columns3 size={14} /> Столбцы <ChevronDown size={13} /></button>
      </div>
    </div>

    <div className="ads-detailed-table-scroll">
      <table className="ads-detailed-table">
        <thead>
          <tr className="ads-group-row">{groups.map((group, index) => <th key={`${group.name}-${index}`} colSpan={group.span}>{group.name}</th>)}</tr>
          <tr>{columns.map(column => <th key={column.key} className={column.className}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {filteredRows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key} className={column.className}>{renderValue(row, column.key)}</td>)}</tr>)}
          {!filteredRows.length && <tr><td colSpan={columns.length}><div className="ads-table-empty">Нет строк, соответствующих фильтру.</div></td></tr>}
        </tbody>
        <tfoot><tr>{columns.map(column => <td key={column.key}>{column.key === 'channel' ? <strong>Итого</strong> : column.key === 'crmLeads' ? rows.reduce((sum,row) => sum + row.leads,0) : column.key === 'sales' ? rows.reduce((sum,row) => sum + row.sales,0) : column.key === 'revenue' ? money.format(rows.reduce((sum,row) => sum + row.revenue,0)) : '—'}</td>)}</tr></tfoot>
      </table>
    </div>
    <footer className="ads-table-foot"><span>Показано: {filteredRows.length} каналов</span><span>Рекламные метрики появятся после подключения Ads API; CRM-данные уже рассчитываются из сделок.</span></footer>
  </section>;
}
