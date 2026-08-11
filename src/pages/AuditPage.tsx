import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAuditLog,
  fetchErrors,
  retryError,
  updateErrorStatus,
  type AuditRecord,
  type ErrorRecord,
  type ErrorStatus
} from '../services/auditApi';
import '../audit.css';

type Tab = 'errors' | 'audit';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'user.role_changed': 'Смена роли',
  'integration.changed': 'Изменение интеграции',
  'integration.deleted': 'Удаление интеграции',
  'integration.sync_manual': 'Ручной запуск синхронизации',
  'funnel.stage_changed': 'Смена стадии',
  'funnel.lead_updated': 'Изменение лида',
  'funnel.lead_created': 'Создание лида',
  'funnel.lead_action': 'Действие по лиду',
  'chat.stage_changed': 'Смена статуса диалога',
  'chat.thread_updated': 'Изменение диалога',
  'entity.deleted': 'Удаление',
  'data.exported': 'Экспорт',
  'mass.operation': 'Массовая операция',
  'error.retry_requested': 'Повторная обработка',
  'error.status_changed': 'Статус ошибки'
};

const ERROR_STATUS_LABELS: Record<ErrorStatus, string> = {
  OPEN: 'Открыта',
  RETRYING: 'Повторная обработка',
  RESOLVED: 'Решена'
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-KZ', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
}

function DetailsJson({ value }: { value: unknown }) {
  if (value == null) return <span className="audit-muted">—</span>;
  return <pre className="audit-json">{JSON.stringify(value, null, 1)}</pre>;
}

export function AuditPage() {
  const [tab, setTab] = useState<Tab>('errors');
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [knownAuditActions, setKnownAuditActions] = useState<string[]>(Object.keys(ACTION_LABELS));
  const [statusFilter, setStatusFilter] = useState<ErrorStatus | ''>('');
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [expandedId, setExpandedId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      if (tab === 'errors') setErrors(await fetchErrors(statusFilter));
      else {
        const rows = await fetchAuditLog({ action: actionFilter || undefined, limit: 300 });
        setAudit(rows);
        setKnownAuditActions((current) => Array.from(new Set([...current, ...rows.map((item) => item.action), ...Object.keys(ACTION_LABELS)])).sort());
      }
    } catch (nextError) {
      setPageError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить журнал');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, statusFilter, tab]);

  useEffect(() => { void load(); }, [load]);

  const onRetry = async (record: ErrorRecord) => {
    setBusyId(record.id);
    setNotice('');
    try {
      const result = await retryError(record.id);
      if (!result.executed) setNotice(`Для «${record.endpoint}» нет автоматической повторной обработки — ошибка переведена в статус «Повторная обработка».`);
      else if (result.success) setNotice(`Повторная обработка «${record.endpoint}» выполнена успешно, ошибка решена.`);
      else setNotice(`Повторная обработка «${record.endpoint}» снова завершилась ошибкой.`);
      await load();
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : 'Повторная обработка не выполнена');
    } finally {
      setBusyId('');
    }
  };

  const onResolve = async (record: ErrorRecord, status: ErrorStatus) => {
    setBusyId(record.id);
    setNotice('');
    try {
      await updateErrorStatus(record.id, status);
      await load();
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : 'Не удалось изменить статус');
    } finally {
      setBusyId('');
    }
  };

  const auditActions = useMemo(
    () => Array.from(new Set([...knownAuditActions, ...audit.map((item) => item.action), ...Object.keys(ACTION_LABELS)])).sort(),
    [audit, knownAuditActions]
  );

  return <div className="stack audit-root">
    <div className="audit-heading">
      <div><span>FR-060 · Журнал и аудит</span><h1>Аудит и ошибки</h1><p>Действия пользователей с контекстом до/после и реестр ошибок интеграций и API с повторной обработкой. Секреты и персональные данные маскируются.</p></div>
      <div className="audit-tabs">
        <button type="button" className={tab === 'errors' ? 'active' : ''} onClick={() => setTab('errors')}>Ошибки</button>
        <button type="button" className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Аудит</button>
        <button type="button" className="audit-refresh" onClick={() => void load()} disabled={loading} aria-label="Обновить журнал">↻</button>
      </div>
    </div>

    {notice && <div className="audit-notice">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div>}
    {pageError !== null && <div className="audit-state audit-state-error">{pageError}<button className="audit-button" type="button" onClick={() => void load()}>Повторить</button></div>}
    {loading && <div className="audit-state">Загрузка журнала…</div>}

    {!loading && pageError === null && tab === 'errors' && <section className="audit-panel">
      <header className="audit-panel-head">
        <h2>Реестр ошибок</h2>
        <label><span>Статус</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ErrorStatus | '')}><option value="">Все</option><option value="OPEN">Открытые</option><option value="RETRYING">Повторная обработка</option><option value="RESOLVED">Решённые</option></select></label>
      </header>
      <div className="audit-table-scroll">
        <table className="audit-table">
          <thead><tr><th>Источник</th><th>Endpoint</th><th>Код</th><th>Сообщение</th><th>Correlation ID</th><th>Повторы</th><th>Первое</th><th>Последнее</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            {errors.map((record) => <tr key={record.id} className={`status-${record.status.toLowerCase()}`}>
              <td>{record.source}</td>
              <td className="audit-endpoint">{record.endpoint}</td>
              <td><b>{record.code}</b></td>
              <td className="audit-message">{record.message}</td>
              <td className="audit-correlation">{record.correlationId || '—'}</td>
              <td className="audit-center">{record.repeatCount}{record.retryAttempts > 0 && <small> · retry {record.retryAttempts}</small>}</td>
              <td>{formatDateTime(record.firstSeenAt)}</td>
              <td>{formatDateTime(record.lastSeenAt)}</td>
              <td><span className={`audit-status status-${record.status.toLowerCase()}`}>{ERROR_STATUS_LABELS[record.status]}</span></td>
              <td className="audit-actions">
                <button type="button" className="audit-button" disabled={busyId === record.id} onClick={() => void onRetry(record)}>{busyId === record.id ? '…' : 'Повторить'}</button>
                {record.status !== 'RESOLVED'
                  ? <button type="button" className="audit-button audit-button-ghost" disabled={busyId === record.id} onClick={() => void onResolve(record, 'RESOLVED')}>Решена</button>
                  : <button type="button" className="audit-button audit-button-ghost" disabled={busyId === record.id} onClick={() => void onResolve(record, 'OPEN')}>Открыть</button>}
              </td>
            </tr>)}
            {!errors.length && <tr><td colSpan={10} className="audit-empty">Ошибок по выбранному фильтру нет</td></tr>}
          </tbody>
        </table>
      </div>
    </section>}

    {!loading && pageError === null && tab === 'audit' && <section className="audit-panel">
      <header className="audit-panel-head">
        <h2>Журнал аудита</h2>
        <label><span>Действие</span><select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}><option value="">Все действия</option>{auditActions.map((action) => <option key={action} value={action}>{ACTION_LABELS[action] || action}</option>)}</select></label>
      </header>
      <div className="audit-table-scroll">
        <table className="audit-table">
          <thead><tr><th>Время</th><th>Действие</th><th>Объект</th><th>Пользователь</th><th>IP</th><th>Correlation ID</th><th></th></tr></thead>
          <tbody>
            {audit.map((record) => <Fragment key={record.id}>
              <tr>
                <td>{formatDateTime(record.createdAt)}</td>
                <td><span className="audit-action">{ACTION_LABELS[record.action] || record.action}</span><small className="audit-muted"> {record.action}</small></td>
                <td>{record.entityType || '—'}{record.entityId && <small className="audit-muted"> {record.entityId.slice(0, 24)}</small>}</td>
                <td className="audit-correlation">{record.userId ? record.userId.slice(0, 8) : 'система'}</td>
                <td>{record.ip || '—'}</td>
                <td className="audit-correlation">{record.correlationId || '—'}</td>
                <td><button type="button" className="audit-button audit-button-ghost" onClick={() => setExpandedId((current) => current === record.id ? '' : record.id)}>{expandedId === record.id ? 'Скрыть' : 'До/после'}</button></td>
              </tr>
              {expandedId === record.id && <tr className="audit-details-row">
                <td colSpan={7}><div className="audit-details"><div><strong>Before</strong><DetailsJson value={record.before} /></div><div><strong>After</strong><DetailsJson value={record.after} /></div><div><strong>User-Agent</strong><span className="audit-muted">{record.userAgent || '—'}</span></div></div></td>
              </tr>}
            </Fragment>)}
            {!audit.length && <tr><td colSpan={7} className="audit-empty">Записей аудита пока нет</td></tr>}
          </tbody>
        </table>
      </div>
    </section>}
  </div>;
}
