import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Download, FilePlus2, LayoutDashboard, Mail, PauseCircle, PlayCircle, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';

type TargetType = 'reports' | 'dashboards';
type Action = 'add' | 'apply_template' | 'download' | 'remove' | 'edit_email' | 'edit_schedule';
type Client = { id: string; name: string; status: string };
type Template = { id: string; target_type: TargetType; name: string; description: string | null; category: string; config: Record<string, unknown> };
type Operation = { id: string; target_type: TargetType; action: Action; status: string; total_items: number; processed_items: number; succeeded_items: number; failed_items: number; parameters: Record<string, unknown>; output: Record<string, unknown>; error_message: string | null; created_at: string; completed_at: string | null };
type Bootstrap = { clients: Client[]; templates: Template[]; operations: Operation[]; permissions: { execute: boolean; remove: boolean } };

const actions: Array<{ id: Action; label: string; description: string; icon: typeof FilePlus2; reports: boolean; dashboards: boolean }> = [
  { id: 'add', label: 'Добавить', description: 'Создать новый объект для выбранных клиентов.', icon: FilePlus2, reports: true, dashboards: true },
  { id: 'apply_template', label: 'Применить шаблон', description: 'Заменить конфигурацию объектов выбранным шаблоном.', icon: Wand2, reports: true, dashboards: true },
  { id: 'download', label: 'Скачать', description: 'Подготовить массовую выгрузку выбранных объектов.', icon: Download, reports: true, dashboards: true },
  { id: 'remove', label: 'Удалить', description: 'Переместить объекты в архив с журналом операции.', icon: Trash2, reports: true, dashboards: true },
  { id: 'edit_email', label: 'Изменить письмо', description: 'Обновить тему и текст email для отчётов.', icon: Mail, reports: true, dashboards: false },
  { id: 'edit_schedule', label: 'Изменить расписание', description: 'Поставить отправку на паузу или возобновить.', icon: PauseCircle, reports: true, dashboards: false },
];

const actionLabels: Record<Action, string> = {
  add: 'Добавление',
  apply_template: 'Применение шаблона',
  download: 'Выгрузка',
  remove: 'Удаление',
  edit_email: 'Изменение письма',
  edit_schedule: 'Изменение расписания',
};

export function BulkOperations() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [targetType, setTargetType] = useState<TargetType>('reports');
  const [action, setAction] = useState<Action>('add');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [emailSubject, setEmailSubject] = useState('Ваш маркетинговый отчёт');
  const [emailMessage, setEmailMessage] = useState('Здравствуйте! Направляем актуальный маркетинговый отчёт.');
  const [scheduleStatus, setScheduleStatus] = useState<'active' | 'paused'>('active');
  const [frequency, setFrequency] = useState('monthly');
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await apiFetch<Bootstrap>('/bulk-operations/bootstrap');
      setData(payload);
      if (!selectedClients.size && payload.clients.length) setSelectedClients(new Set(payload.clients.map(client => client.id)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить массовые операции');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const definition = actions.find(item => item.id === action);
    if (definition && !definition[targetType]) setAction('add');
    setTemplateId('');
  }, [targetType]);

  const templates = useMemo(() => (data?.templates ?? []).filter(item => item.target_type === targetType), [data, targetType]);
  const availableActions = actions.filter(item => item[targetType]);
  const allSelected = Boolean(data?.clients.length) && selectedClients.size === data?.clients.length;

  function toggleClient(id: string) {
    setSelectedClients(current => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedClients(allSelected ? new Set() : new Set((data?.clients ?? []).map(client => client.id)));
  }

  async function execute() {
    if (!selectedClients.size) return setError('Выберите минимум одного клиента');
    if ((action === 'apply_template' || (action === 'add' && templates.length)) && !templateId) return setError('Выберите шаблон');
    if (action === 'remove' && !window.confirm(`Удалить ${targetType === 'reports' ? 'отчёты' : 'dashboard sections'} у ${selectedClients.size} клиентов?`)) return;
    setExecuting(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiFetch<Operation>('/bulk-operations/execute', {
        method: 'POST',
        body: {
          targetType,
          action,
          clientIds: Array.from(selectedClients),
          templateId: templateId || undefined,
          title: title || undefined,
          emailSubject,
          emailMessage,
          scheduleStatus,
          schedule: { frequency, timezone: 'Asia/Almaty' },
        },
      });
      setSuccess(`${actionLabels[action]} завершено: ${result.succeeded_items} успешно, ${result.failed_items} с ошибкой.`);
      if (action === 'download') downloadSummary(result);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Операция не выполнена');
    } finally {
      setExecuting(false);
    }
  }

  function downloadSummary(operation: Operation) {
    const clientNames = (data?.clients ?? []).filter(client => selectedClients.has(client.id)).map(client => client.name);
    const rows = [['Операция', actionLabels[operation.action]], ['Объект', operation.target_type], ['Статус', operation.status], ['Успешно', operation.succeeded_items], ['Ошибки', operation.failed_items], ['Клиенты', clientNames.join(', ')]];
    const blob = new Blob([`\uFEFF${rows.map(row => row.join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bulk_operation_${operation.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedAction = actions.find(item => item.id === action)!;

  return <div className="bulk-workspace">
    <section className="bulk-builder">
      <header className="bulk-title-row">
        <div><h2>Bulk Operations</h2><p>Массово управляйте отчётами и dashboard sections для нескольких клиентов.</p></div>
        <button onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Обновить</button>
      </header>

      {error && <div className="bulk-alert error">{error}</div>}
      {success && <div className="bulk-alert success">{success}</div>}

      <div className="bulk-step">
        <span className="bulk-step-number">1</span>
        <div className="bulk-step-body">
          <h3>Что изменить?</h3>
          <div className="bulk-target-tabs">
            <button className={targetType === 'reports' ? 'active' : ''} onClick={() => setTargetType('reports')}><CheckSquare size={17} /> Reports</button>
            <button className={targetType === 'dashboards' ? 'active' : ''} onClick={() => setTargetType('dashboards')}><LayoutDashboard size={17} /> Dashboards</button>
          </div>
        </div>
      </div>

      <div className="bulk-step">
        <span className="bulk-step-number">2</span>
        <div className="bulk-step-body">
          <h3>Выберите операцию</h3>
          <div className="bulk-action-grid">{availableActions.map(item => { const Icon = item.icon; return <button key={item.id} className={action === item.id ? 'active' : ''} onClick={() => setAction(item.id)}><Icon size={18} /><strong>{item.label}</strong><small>{item.description}</small></button>; })}</div>
        </div>
      </div>

      <div className="bulk-step">
        <span className="bulk-step-number">3</span>
        <div className="bulk-step-body">
          <div className="bulk-section-heading"><h3>Выберите клиентов</h3><button onClick={toggleAll}>{allSelected ? 'Снять все' : 'Выбрать все'}</button></div>
          <div className="bulk-client-list">{(data?.clients ?? []).map(client => <label key={client.id}><input type="checkbox" checked={selectedClients.has(client.id)} onChange={() => toggleClient(client.id)} /><span>{client.name}</span><small>{client.status}</small></label>)}{!loading && !data?.clients.length && <div className="bulk-empty">Клиенты не найдены</div>}</div>
        </div>
      </div>

      <div className="bulk-step">
        <span className="bulk-step-number">4</span>
        <div className="bulk-step-body">
          <h3>Параметры операции</h3>
          <div className="bulk-form">
            {(action === 'add' || action === 'apply_template') && <label>Шаблон<select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">Выберите шаблон</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
            {action === 'add' && <label>Название<input value={title} onChange={event => setTitle(event.target.value)} placeholder={targetType === 'reports' ? 'Название отчёта' : 'Название dashboard section'} /></label>}
            {action === 'edit_email' && <><label>Тема письма<input value={emailSubject} onChange={event => setEmailSubject(event.target.value)} /></label><label>Сообщение<textarea rows={5} value={emailMessage} onChange={event => setEmailMessage(event.target.value)} /></label></>}
            {action === 'edit_schedule' && <><label>Состояние<select value={scheduleStatus} onChange={event => setScheduleStatus(event.target.value as 'active' | 'paused')}><option value="active">Активно</option><option value="paused">Пауза</option></select></label><label>Частота<select value={frequency} onChange={event => setFrequency(event.target.value)}><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="quarterly">Ежеквартально</option></select></label></>}
            {(action === 'download' || action === 'remove') && <div className="bulk-operation-note"><selectedAction.icon size={18} /><div><strong>{selectedAction.label}</strong><span>{selectedAction.description}</span></div></div>}
          </div>
        </div>
      </div>

      <footer className="bulk-execute-bar">
        <div><strong>{selectedClients.size} клиентов</strong><span>{targetType === 'reports' ? 'Reports' : 'Dashboards'} · {selectedAction.label}</span></div>
        <button className={action === 'remove' ? 'danger' : 'primary'} disabled={executing || !data?.permissions.execute} onClick={() => void execute()}>{action === 'edit_schedule' && scheduleStatus === 'active' ? <PlayCircle size={17} /> : action === 'edit_schedule' ? <PauseCircle size={17} /> : <selectedAction.icon size={17} />}{executing ? 'Выполнение…' : 'Выполнить операцию'}</button>
      </footer>
    </section>

    <section className="bulk-history">
      <header><div><h2>История операций</h2><p>Последние 50 запусков с результатами по каждому пакету.</p></div></header>
      <div className="bulk-history-table"><table><thead><tr><th>Дата</th><th>Операция</th><th>Объект</th><th>Статус</th><th>Прогресс</th><th>Результат</th></tr></thead><tbody>{(data?.operations ?? []).map(operation => <tr key={operation.id}><td>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(new Date(operation.created_at))}</td><td>{actionLabels[operation.action]}</td><td>{operation.target_type === 'reports' ? 'Reports' : 'Dashboards'}</td><td><span className={`bulk-status ${operation.status}`}>{operation.status}</span></td><td>{operation.processed_items}/{operation.total_items}</td><td><b>{operation.succeeded_items}</b> успешно · <em>{operation.failed_items}</em> ошибок</td></tr>)}{!loading && !data?.operations.length && <tr><td colSpan={6}><div className="bulk-empty">Операций пока нет</div></td></tr>}</tbody></table></div>
    </section>
  </div>;
}
