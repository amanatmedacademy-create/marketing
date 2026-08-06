import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import {
  archiveFunnelKanbanBoard,
  createFunnelKanbanBoard,
  fetchFunnelKanbanBoards,
  updateFunnelKanbanBoard,
  type FunnelKanbanBoard,
  type FunnelKanbanBoardInput,
  type FunnelKanbanColumn,
  type FunnelLead,
  type FunnelLeadAction,
  type FunnelLeadPriority,
  type FunnelLeadStage,
  type FunnelUser
} from '../services/salesFunnel';
import '../sales-funnel-builder.css';

const BOARD_STORAGE_KEY = 'amanat:funnel-kanban-board';

const STAGE_DEFAULTS: Record<FunnelLeadStage, FunnelKanbanColumn> = {
  NEW: { stage: 'NEW', title: 'Новые', subtitle: 'Первичный контакт', color: '#2196f3', wipLimit: 0, visible: true },
  QUALIFICATION: { stage: 'QUALIFICATION', title: 'Квалификация', subtitle: 'Диагност + ТМ', color: '#8b5cf6', wipLimit: 0, visible: true },
  APPOINTMENT: { stage: 'APPOINTMENT', title: 'Запись', subtitle: 'Назначена консультация', color: '#f59e0b', wipLimit: 0, visible: true },
  DIAGNOSTIC: { stage: 'DIAGNOSTIC', title: 'Диагностика', subtitle: 'Осмотр и решение', color: '#14b8a6', wipLimit: 0, visible: true },
  COURSE: { stage: 'COURSE', title: 'Курс оплачен', subtitle: 'Продажа завершена', color: '#22c55e', wipLimit: 0, visible: true },
  LOST: { stage: 'LOST', title: 'Потеряны', subtitle: 'Отказ / не дозвонились', color: '#ef4444', wipLimit: 0, visible: true }
};

const PRIORITY_LABELS: Record<FunnelLeadPriority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный'
};

const FALLBACK_BOARD: FunnelKanbanBoard = {
  id: '__fallback__',
  name: 'Основная воронка',
  description: 'Все лиды отдела продаж',
  columns: Object.values(STAGE_DEFAULTS),
  filters: { sources: [], priorities: [], diagnostUserIds: [], managerUserIds: [] },
  showTotals: true,
  isDefault: true,
  isActive: true,
  sortOrder: 10,
  createdAt: '',
  updatedAt: ''
};

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });

type Props = {
  leads: FunnelLead[];
  users: FunnelUser[];
  draggingId: string | null;
  onDraggingChange: (id: string | null) => void;
  onMove: (lead: FunnelLead, stage: FunnelLeadStage) => Promise<void> | void;
  onOpen: (lead: FunnelLead) => void;
  onAction: (lead: FunnelLead, action: FunnelLeadAction) => Promise<void> | void;
  onError: (message: string) => void;
};

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function ageLabel(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '—';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'только что';
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

function cloneColumns(columns: FunnelKanbanColumn[]): FunnelKanbanColumn[] {
  return columns.map((column) => ({ ...column }));
}

function blankDraft(source?: FunnelKanbanBoard): FunnelKanbanBoardInput {
  if (source) {
    return {
      name: source.name,
      description: source.description || '',
      columns: cloneColumns(source.columns),
      filters: {
        sources: [...source.filters.sources],
        priorities: [...source.filters.priorities],
        diagnostUserIds: [...source.filters.diagnostUserIds],
        managerUserIds: [...source.filters.managerUserIds]
      },
      showTotals: source.showTotals,
      isDefault: source.isDefault,
      sortOrder: source.sortOrder
    };
  }
  return {
    name: 'Новая воронка',
    description: '',
    columns: cloneColumns(Object.values(STAGE_DEFAULTS)),
    filters: { sources: [], priorities: [], diagnostUserIds: [], managerUserIds: [] },
    showTotals: true,
    isDefault: false,
    sortOrder: 100
  };
}

function boardMatchesLead(board: FunnelKanbanBoard, lead: FunnelLead): boolean {
  const filters = board.filters;
  if (filters.sources.length && !filters.sources.includes(lead.source)) return false;
  if (filters.priorities.length && !filters.priorities.includes(lead.priority)) return false;
  if (filters.diagnostUserIds.length && (!lead.diagnostUserId || !filters.diagnostUserIds.includes(lead.diagnostUserId))) return false;
  if (filters.managerUserIds.length && (!lead.managerUserId || !filters.managerUserIds.includes(lead.managerUserId))) return false;
  return true;
}

export function SalesFunnelKanban({ leads, users, draggingId, onDraggingChange, onMove, onOpen, onAction, onError }: Props) {
  const [boards, setBoards] = useState<FunnelKanbanBoard[]>([]);
  const [selectedId, setSelectedId] = useState(() => {
    try { return window.localStorage.getItem(BOARD_STORAGE_KEY) || ''; } catch { return ''; }
  });
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [boardError, setBoardError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FunnelKanbanBoardInput>(() => blankDraft());
  const [saving, setSaving] = useState(false);
  const [stageToAdd, setStageToAdd] = useState<FunnelLeadStage>('NEW');
  const [insertAfter, setInsertAfter] = useState<FunnelLeadStage | ''>('');

  const loadBoards = useCallback(async () => {
    setLoadingBoards(true);
    setBoardError('');
    try {
      const next = await fetchFunnelKanbanBoards();
      setBoards(next);
      setSelectedId((current) => {
        const valid = next.some((board) => board.id === current);
        const selected = valid ? current : next.find((board) => board.isDefault)?.id || next[0]?.id || '';
        try { window.localStorage.setItem(BOARD_STORAGE_KEY, selected); } catch { /* storage unavailable */ }
        return selected;
      });
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : 'Не удалось загрузить воронки');
    } finally {
      setLoadingBoards(false);
    }
  }, []);

  useEffect(() => { void loadBoards(); }, [loadBoards]);

  const selectedBoard = boards.find((board) => board.id === selectedId) || boards.find((board) => board.isDefault) || boards[0] || FALLBACK_BOARD;
  const visibleColumns = selectedBoard.columns.filter((column) => column.visible);
  const boardLeads = useMemo(() => leads.filter((lead) => boardMatchesLead(selectedBoard, lead)), [leads, selectedBoard]);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const sourceOptions = useMemo(() => Array.from(new Set(leads.map((lead) => lead.source).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')), [leads]);
  const availableStages = useMemo(() => (Object.keys(STAGE_DEFAULTS) as FunnelLeadStage[]).filter((stage) => !draft.columns.some((column) => column.stage === stage)), [draft.columns]);

  useEffect(() => {
    if (availableStages.length && !availableStages.includes(stageToAdd)) setStageToAdd(availableStages[0]);
    if (!insertAfter || !draft.columns.some((column) => column.stage === insertAfter)) setInsertAfter(draft.columns.at(-1)?.stage || '');
  }, [availableStages, draft.columns, insertAfter, stageToAdd]);

  const selectBoard = (id: string) => {
    setSelectedId(id);
    try { window.localStorage.setItem(BOARD_STORAGE_KEY, id); } catch { /* storage unavailable */ }
  };

  const openCreate = () => {
    const next = blankDraft();
    setEditingId(null);
    setDraft(next);
    setInsertAfter(next.columns.at(-1)?.stage || '');
    setModalOpen(true);
    setBoardError('');
  };

  const openEdit = () => {
    if (selectedBoard.id === FALLBACK_BOARD.id) return;
    const next = blankDraft(selectedBoard);
    setEditingId(selectedBoard.id);
    setDraft(next);
    setInsertAfter(next.columns.at(-1)?.stage || '');
    setModalOpen(true);
    setBoardError('');
  };

  const duplicateBoard = () => {
    const next = { ...blankDraft(selectedBoard), name: `${selectedBoard.name} — копия`, isDefault: false, sortOrder: (selectedBoard.sortOrder || 0) + 10 };
    setEditingId(null);
    setDraft(next);
    setInsertAfter(next.columns.at(-1)?.stage || '');
    setModalOpen(true);
    setBoardError('');
  };

  const saveBoard = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) { setBoardError('Укажите название воронки'); return; }
    if (!draft.columns.length) { setBoardError('Добавьте хотя бы одну стадию'); return; }
    if (!draft.columns.some((column) => column.visible)) { setBoardError('Оставьте хотя бы одну видимую стадию'); return; }
    setSaving(true);
    setBoardError('');
    try {
      const payload: FunnelKanbanBoardInput = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        columns: cloneColumns(draft.columns),
        filters: {
          sources: [...draft.filters.sources],
          priorities: [...draft.filters.priorities],
          diagnostUserIds: [...draft.filters.diagnostUserIds],
          managerUserIds: [...draft.filters.managerUserIds]
        }
      };
      const saved = editingId ? await updateFunnelKanbanBoard(editingId, payload) : await createFunnelKanbanBoard(payload);
      await loadBoards();
      selectBoard(saved.id);
      setModalOpen(false);
      setEditingId(null);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : 'Не удалось сохранить воронку');
    } finally {
      setSaving(false);
    }
  };

  const archiveBoard = async () => {
    if (!editingId || boards.length < 2 || !window.confirm('Архивировать эту воронку? Лиды останутся в системе.')) return;
    setSaving(true);
    setBoardError('');
    try {
      await archiveFunnelKanbanBoard(editingId);
      setModalOpen(false);
      setEditingId(null);
      await loadBoards();
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : 'Не удалось архивировать воронку');
    } finally {
      setSaving(false);
    }
  };

  const updateColumn = (index: number, patch: Partial<FunnelKanbanColumn>) => {
    setDraft((current) => ({ ...current, columns: current.columns.map((column, columnIndex) => columnIndex === index ? { ...column, ...patch } : column) }));
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.columns.length) return;
    setDraft((current) => {
      const columns = cloneColumns(current.columns);
      [columns[index], columns[target]] = [columns[target], columns[index]];
      return { ...current, columns };
    });
  };

  const addColumn = () => {
    if (!availableStages.length) { setBoardError('Все доступные системные стадии уже добавлены'); return; }
    const template = STAGE_DEFAULTS[stageToAdd];
    setDraft((current) => {
      const columns = cloneColumns(current.columns);
      const afterIndex = insertAfter ? columns.findIndex((column) => column.stage === insertAfter) : columns.length - 1;
      columns.splice(Math.max(0, afterIndex + 1), 0, { ...template });
      return { ...current, columns };
    });
    setInsertAfter(stageToAdd);
    setBoardError('');
  };

  const removeColumn = (index: number) => {
    const column = draft.columns[index];
    if (!column || draft.columns.length <= 1) { setBoardError('В воронке должна остаться хотя бы одна стадия'); return; }
    const count = boardLeads.filter((lead) => lead.stage === column.stage).length;
    if (count > 0) {
      setBoardError(`В стадии «${column.title}» находится ${count} лидов. Сначала перенесите их в другую стадию.`);
      return;
    }
    setDraft((current) => ({ ...current, columns: current.columns.filter((_, columnIndex) => columnIndex !== index) }));
    setBoardError('');
  };

  const toggleFilterValue = <T extends string>(values: T[], value: T): T[] => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const dropLead = async (column: FunnelKanbanColumn) => {
    const lead = leads.find((item) => item.id === draggingId);
    if (!lead) return;
    const targetCount = boardLeads.filter((item) => item.stage === column.stage).length;
    if (lead.stage !== column.stage && column.wipLimit > 0 && targetCount >= column.wipLimit) {
      onDraggingChange(null);
      onError(`Стадия «${column.title}» заполнена: лимит ${column.wipLimit}`);
      return;
    }
    await onMove(lead, column.stage);
  };

  return <section className="rop-kanban-shell" aria-label="Канбан воронки продаж">
    <header className="rop-kanban-toolbar">
      <div className="rop-board-tabs" role="tablist" aria-label="Воронки продаж">
        {boards.map((board) => <button type="button" role="tab" aria-selected={board.id === selectedBoard.id} className={board.id === selectedBoard.id ? 'active' : ''} key={board.id} onClick={() => selectBoard(board.id)}>
          <span>{board.name}</span>{board.isDefault && <i title="Основная воронка">●</i>}
        </button>)}
        {!boards.length && <button type="button" className="active" disabled>{FALLBACK_BOARD.name}</button>}
      </div>
      <div className="rop-board-actions">
        {loadingBoards && <span className="rop-board-sync">Синхронизация…</span>}
        <button type="button" onClick={openCreate}>+ Воронка</button>
        <button type="button" onClick={duplicateBoard} disabled={selectedBoard.id === FALLBACK_BOARD.id}>Копия</button>
        <button type="button" onClick={openEdit} disabled={selectedBoard.id === FALLBACK_BOARD.id}>Настроить</button>
      </div>
    </header>

    <div className="rop-board-caption">
      <div><strong>{selectedBoard.name}</strong><span>{selectedBoard.description || 'Настраиваемая воронка лидов'}</span></div>
      <div><b>{boardLeads.length}</b><span>лидов</span><b>{visibleColumns.length}</b><span>стадий</span></div>
    </div>

    {boardError && !modalOpen && <div className="rop-board-error">{boardError}<button type="button" onClick={() => { setBoardError(''); void loadBoards(); }}>Повторить</button></div>}

    <div className="rop-kanban-scroll" tabIndex={0} aria-label="Горизонтальная прокрутка воронки">
      <div className="rop-config-board">
        {visibleColumns.map((column) => {
          const stageLeads = boardLeads.filter((lead) => lead.stage === column.stage);
          const stageAmount = stageLeads.reduce((sum, lead) => sum + lead.amount, 0);
          const limitReached = column.wipLimit > 0 && stageLeads.length >= column.wipLimit;
          return <article className={`rop-column rop-config-column stage-${column.stage.toLowerCase()} ${draggingId ? 'drag-active' : ''} ${limitReached ? 'limit-reached' : ''}`} key={column.stage} onDragOver={(event) => event.preventDefault()} onDrop={() => void dropLead(column)}>
            <header style={{ borderTopColor: column.color }}><div><span>{column.title}</span><small>{column.subtitle}</small></div><b>{stageLeads.length}{column.wipLimit > 0 ? ` / ${column.wipLimit}` : ''}</b>{selectedBoard.showTotals && <em>{money.format(stageAmount)}</em>}</header>
            <div className="rop-column-body">
              {stageLeads.map((lead) => <section className={`rop-lead-card priority-${lead.priority.toLowerCase()}`} key={lead.id} draggable onDragStart={(event: DragEvent) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', lead.id); onDraggingChange(lead.id); }} onDragEnd={() => onDraggingChange(null)} onDoubleClick={() => onOpen(lead)}>
                <header><span className="rop-lead-avatar">{initials(lead.fullName)}</span><div><strong>{lead.fullName}</strong><small>{lead.phone || 'Телефон не указан'}</small></div><b>{PRIORITY_LABELS[lead.priority]}</b></header>
                <p>{lead.diagnosis || 'Запрос не указан'}</p>
                <div className="rop-owner-grid"><span>Диагност<b>{userMap.get(lead.diagnostUserId || '')?.fullName || 'Не назначен'}</b></span><span>ТМ<b>{userMap.get(lead.managerUserId || '')?.fullName || 'Не назначен'}</b></span></div>
                <div className="rop-lead-meta"><span>{lead.source}</span><span>WhatsApp {lead.whatsappCount}</span><time>{ageLabel(lead.updatedAt)}</time></div>
                {lead.amount > 0 && <div className="rop-lead-amount"><span>{lead.paid ? 'Оплачено' : 'Сумма сделки'}</span><strong>{money.format(lead.amount)}</strong></div>}
                {lead.lostReason && <div className="rop-lost-reason">{lead.lostReason}</div>}
                <footer>
                  <button type="button" onClick={() => void onAction(lead, 'WHATSAPP')} title="WhatsApp">W</button>
                  {lead.stage !== 'LOST' && lead.stage !== 'COURSE' && <button type="button" onClick={() => void onAction(lead, 'BOOK')} title="Создать запись">＋</button>}
                  {lead.stage !== 'COURSE' && lead.stage !== 'LOST' && <button type="button" onClick={() => void onAction(lead, 'COURSE')} title="Продать курс">₸</button>}
                  {lead.stage !== 'LOST' ? <button type="button" onClick={() => void onAction(lead, 'LOST')} title="Потерян">×</button> : <button type="button" onClick={() => void onAction(lead, 'RESTORE')} title="Восстановить">↻</button>}
                  <button type="button" onClick={() => onOpen(lead)} title="Карточка">•••</button>
                </footer>
              </section>)}
              {!stageLeads.length && <div className="rop-column-empty">Перетащите лид сюда</div>}
            </div>
          </article>;
        })}
      </div>
    </div>

    {modalOpen && <div className="rop-board-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}>
      <form className="rop-board-modal" onSubmit={(event) => void saveBoard(event)}>
        <header><div><small>ВОРОНКА ПРОДАЖ</small><h2>{editingId ? 'Настроить воронку' : 'Новая воронка'}</h2></div><button type="button" onClick={() => setModalOpen(false)}>×</button></header>
        <div className="rop-board-modal-body">
          <section className="rop-board-settings-grid">
            <label><span>Название *</span><input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
            <label><span>Порядок в списке</span><input type="number" min="0" max="9999" value={draft.sortOrder || 0} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })}/></label>
            <label className="wide"><span>Описание</span><textarea rows={2} maxLength={500} value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
            <label className="rop-board-check"><input type="checkbox" checked={draft.showTotals} onChange={(event) => setDraft({ ...draft, showTotals: event.target.checked })}/><span>Показывать суммы в стадиях</span></label>
            <label className="rop-board-check"><input type="checkbox" checked={draft.isDefault === true} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}/><span>Основная воронка</span></label>
          </section>

          <section className="rop-board-filter-settings">
            <header><div><strong>Какие лиды показывать</strong><span>Пустой выбор показывает все лиды</span></div></header>
            <div className="rop-board-filter-group"><strong>Источники</strong><div>{sourceOptions.map((source) => <label key={source}><input type="checkbox" checked={draft.filters.sources.includes(source)} onChange={() => setDraft({ ...draft, filters: { ...draft.filters, sources: toggleFilterValue(draft.filters.sources, source) } })}/><span>{source}</span></label>)}{!sourceOptions.length && <em>Источники появятся после добавления лидов</em>}</div></div>
            <div className="rop-board-filter-group"><strong>Приоритеты</strong><div>{(Object.keys(PRIORITY_LABELS) as FunnelLeadPriority[]).map((value) => <label key={value}><input type="checkbox" checked={draft.filters.priorities.includes(value)} onChange={() => setDraft({ ...draft, filters: { ...draft.filters, priorities: toggleFilterValue(draft.filters.priorities, value) } })}/><span>{PRIORITY_LABELS[value]}</span></label>)}</div></div>
          </section>

          <section className="rop-board-column-settings">
            <header><div><strong>Стадии и последовательность</strong><span>Создавайте, удаляйте и указывайте, после какой стадии идёт следующая</span></div></header>
            <div className="rop-stage-sequence">{draft.columns.map((column, index) => <span key={column.stage}><b>{column.title}</b>{index < draft.columns.length - 1 && <i>→</i>}</span>)}</div>
            <div className="rop-stage-builder">
              <label><span>Добавить стадию</span><select value={stageToAdd} disabled={!availableStages.length} onChange={(event) => setStageToAdd(event.target.value as FunnelLeadStage)}>{availableStages.map((stage) => <option key={stage} value={stage}>{STAGE_DEFAULTS[stage].title}</option>)}</select></label>
              <label><span>После какой стадии</span><select value={insertAfter} onChange={(event) => setInsertAfter(event.target.value as FunnelLeadStage)}>{draft.columns.map((column) => <option key={column.stage} value={column.stage}>{column.title}</option>)}</select></label>
              <button type="button" disabled={!availableStages.length} onClick={addColumn}>+ Добавить</button>
            </div>
            {!availableStages.length && <p className="rop-stage-warning">Все шесть системных типов стадий уже используются. Ненужную пустую стадию можно удалить и добавить заново в другом месте.</p>}
            {draft.columns.map((column, index) => <article key={column.stage}>
              <label className="rop-column-visible"><input type="checkbox" checked={column.visible} onChange={(event) => updateColumn(index, { visible: event.target.checked })}/><span>{index + 1}</span></label>
              <input aria-label="Название стадии" value={column.title} onChange={(event) => updateColumn(index, { title: event.target.value })}/>
              <input aria-label="Подпись стадии" value={column.subtitle} onChange={(event) => updateColumn(index, { subtitle: event.target.value })}/>
              <input className="rop-column-color" aria-label="Цвет стадии" type="color" value={column.color} onChange={(event) => updateColumn(index, { color: event.target.value })}/>
              <label className="rop-column-limit"><span>Лимит</span><input type="number" min="0" max="999" value={column.wipLimit} onChange={(event) => updateColumn(index, { wipLimit: Number(event.target.value) })}/></label>
              <div className="rop-column-order"><button type="button" disabled={index === 0} onClick={() => moveColumn(index, -1)}>↑</button><button type="button" disabled={index === draft.columns.length - 1} onClick={() => moveColumn(index, 1)}>↓</button><button type="button" className="rop-stage-remove" title="Удалить стадию" disabled={draft.columns.length <= 1} onClick={() => removeColumn(index)}>×</button></div>
            </article>)}
          </section>
        </div>
        {boardError && <div className="rop-board-modal-error">{boardError}</div>}
        <footer>
          <div>{editingId && boards.length > 1 && <button type="button" className="button rop-board-archive" disabled={saving} onClick={() => void archiveBoard()}>Архивировать воронку</button>}</div>
          <div><button type="button" className="button button-secondary" disabled={saving} onClick={() => setModalOpen(false)}>Отмена</button><button className="button button-primary" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить воронку'}</button></div>
        </footer>
      </form>
    </div>}
  </section>;
}
