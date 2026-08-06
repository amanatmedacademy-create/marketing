import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, CircleDollarSign, Clock3, Plus, RefreshCw, Settings2, Target, Trash2, TrendingUp, UsersRound, X } from 'lucide-react';
import { SalesFunnelKanban } from '../components/SalesFunnelKanban';
import { useAuth } from '../components/AuthGate';
import {
  createFunnelDeal,
  createFunnelPipeline,
  createFunnelStage,
  deleteFunnelPipeline,
  deleteFunnelStage,
  fetchFunnelWorkspace,
  moveFunnelDeal,
  searchFunnelContacts,
  updateFunnelDeal,
  updateFunnelPipeline,
  updateFunnelStage,
  type FunnelContact,
  type FunnelDeal,
  type FunnelDealInput,
  type FunnelDealPriority,
  type FunnelPipeline,
  type FunnelStage,
  type FunnelStageType,
  type FunnelWorkspace
} from '../services/salesFunnel';
import '../sales-funnel-v2.css';

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const PRIORITY_LABELS: Record<FunnelDealPriority, string> = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный' };
const STAGE_TYPE_LABELS: Record<FunnelStageType, string> = { open: 'В работе', won: 'Успешно', lost: 'Потеряно' };

const EMPTY_DEAL: FunnelDealInput = {
  fullName: '', phone: '', email: '', source: 'Маркетинг', priority: 'MEDIUM', managerUserId: null,
  diagnostUserId: null, description: '', amount: 0, paid: false, lostReason: '', nextAction: '', nextActionAt: null
};

type StageDraft = Pick<FunnelStage, 'id' | 'name' | 'color' | 'probability' | 'stageType' | 'position'>;

export function SalesFunnelPage() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [workspace, setWorkspace] = useState<FunnelWorkspace | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState(() => localStorage.getItem('amanat:selected-sales-pipeline') || '');
  const [query, setQuery] = useState('');
  const [managerId, setManagerId] = useState('');
  const [diagnostId, setDiagnostId] = useState('');
  const [priority, setPriority] = useState<FunnelDealPriority | ''>('');
  const [stageId, setStageId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dealModal, setDealModal] = useState(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [dealDraft, setDealDraft] = useState<FunnelDealInput>(EMPTY_DEAL);
  const [savingDeal, setSavingDeal] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState<FunnelContact[]>([]);
  const [settingsModal, setSettingsModal] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineDefault, setPipelineDefault] = useState(false);
  const [stageDrafts, setStageDrafts] = useState<StageDraft[]>([]);
  const [newStageName, setNewStageName] = useState('');
  const [newStageType, setNewStageType] = useState<FunnelStageType>('open');
  const [newStageColor, setNewStageColor] = useState('#64748b');
  const [newStageProbability, setNewStageProbability] = useState(20);
  const [savingSettings, setSavingSettings] = useState(false);
  const [createPipelineModal, setCreatePipelineModal] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');

  const filters = useMemo(() => ({ pipelineId: selectedPipelineId, query, managerId, diagnostId, priority, stageId }), [selectedPipelineId, query, managerId, diagnostId, priority, stageId]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const next = await fetchFunnelWorkspace(filters);
      setWorkspace(next);
      const resolved = next.selectedPipelineId || next.pipelines[0]?.id || '';
      if (resolved && resolved !== selectedPipelineId) setSelectedPipelineId(resolved);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Не удалось загрузить воронку продаж');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [filters, selectedPipelineId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    if (selectedPipelineId) localStorage.setItem('amanat:selected-sales-pipeline', selectedPipelineId);
    setStageId('');
  }, [selectedPipelineId]);

  useEffect(() => {
    if (!dealModal) return;
    const timer = window.setTimeout(async () => {
      try { setContacts(await searchFunnelContacts(contactQuery)); }
      catch { setContacts([]); }
    }, contactQuery.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [contactQuery, dealModal]);

  const pipeline = workspace?.pipelines.find((item) => item.id === selectedPipelineId) || workspace?.pipelines[0];
  const stats = workspace?.stats;
  const conversion = stats && stats.won + stats.lost > 0 ? Math.round(stats.won / (stats.won + stats.lost) * 100) : 0;

  const selectPipeline = (id: string) => { setSelectedPipelineId(id); setStageId(''); };

  const openCreateDeal = () => {
    setEditingDealId(null);
    setDealDraft({ ...EMPTY_DEAL, pipelineId: pipeline?.id, stageId: pipeline?.stages.find((stage) => stage.stageType === 'open')?.id || pipeline?.stages[0]?.id });
    setContactQuery(''); setContacts([]); setDealModal(true); setActionError('');
  };
  const openEditDeal = (deal: FunnelDeal) => {
    setEditingDealId(deal.id);
    setDealDraft({ pipelineId: deal.pipelineId, stageId: deal.stageId, marketingLeadId: deal.marketingLeadId || null, fullName: deal.fullName, phone: deal.phone || '', email: deal.email || '', source: deal.source, priority: deal.priority, managerUserId: deal.managerUserId || null, diagnostUserId: deal.diagnostUserId || null, description: deal.description || '', amount: deal.amount, paid: deal.paid, lostReason: deal.lostReason || '', nextAction: deal.nextAction || '', nextActionAt: deal.nextActionAt ? deal.nextActionAt.slice(0, 16) : null });
    setContactQuery(''); setContacts([]); setDealModal(true); setActionError('');
  };
  const selectContact = (id: string) => {
    const contact = contacts.find((item) => item.id === id);
    if (!contact) return;
    setDealDraft((current) => ({ ...current, marketingLeadId: contact.id, fullName: contact.fullName, phone: contact.phone || current.phone, email: contact.email || current.email, source: contact.source || current.source, description: contact.description || current.description }));
  };
  const saveDeal = async (event: FormEvent) => {
    event.preventDefault(); setSavingDeal(true); setActionError('');
    try {
      if (editingDealId) await updateFunnelDeal(editingDealId, dealDraft); else await createFunnelDeal(dealDraft);
      setDealModal(false); setEditingDealId(null); await load(false);
    } catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось сохранить сделку'); }
    finally { setSavingDeal(false); }
  };
  const moveDeal = async (deal: FunnelDeal, targetStageId: string) => {
    if (!pipeline) return;
    setActionError('');
    try { await moveFunnelDeal(deal.id, { pipelineId: pipeline.id, stageId: targetStageId, position: Date.now() }); await load(false); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось переместить сделку'); }
    finally { setDraggingId(null); }
  };

  const openSettings = () => {
    if (!pipeline) return;
    setPipelineName(pipeline.name); setPipelineDefault(pipeline.isDefault);
    setStageDrafts(pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name, color: stage.color, probability: stage.probability, stageType: stage.stageType, position: stage.position })));
    setSettingsModal(true); setActionError('');
  };
  const moveStageDraft = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stageDrafts.length) return;
    setStageDrafts((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  };
  const updateStageDraft = (id: string, patch: Partial<StageDraft>) => setStageDrafts((current) => current.map((stage) => stage.id === id ? { ...stage, ...patch } : stage));
  const savePipelineSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!pipeline || !pipelineName.trim()) return;
    setSavingSettings(true); setActionError('');
    try {
      await updateFunnelPipeline(pipeline.id, { name: pipelineName.trim(), isDefault: pipelineDefault });
      for (let index = 0; index < stageDrafts.length; index += 1) {
        const stage = stageDrafts[index];
        await updateFunnelStage(stage.id, { name: stage.name.trim(), color: stage.color, probability: stage.probability, stageType: stage.stageType, position: (index + 1) * 100 });
      }
      setSettingsModal(false); await load(false);
    } catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось сохранить настройки'); }
    finally { setSavingSettings(false); }
  };
  const addStage = async () => {
    if (!pipeline || !newStageName.trim()) return;
    setSavingSettings(true); setActionError('');
    try {
      await createFunnelStage({ pipelineId: pipeline.id, name: newStageName.trim(), color: newStageColor, probability: newStageProbability, stageType: newStageType, afterStageId: stageDrafts.at(-1)?.id });
      setNewStageName(''); await load(false);
      const refreshed = await fetchFunnelWorkspace({ pipelineId: pipeline.id });
      const current = refreshed.pipelines.find((item) => item.id === pipeline.id);
      if (current) setStageDrafts(current.stages.map((stage) => ({ id: stage.id, name: stage.name, color: stage.color, probability: stage.probability, stageType: stage.stageType, position: stage.position })));
    } catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось добавить стадию'); }
    finally { setSavingSettings(false); }
  };
  const removeStage = async (stage: StageDraft) => {
    if (!confirm(`Удалить стадию «${stage.name}»?`)) return;
    setSavingSettings(true); setActionError('');
    try { await deleteFunnelStage(stage.id); setStageDrafts((current) => current.filter((item) => item.id !== stage.id)); await load(false); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось удалить стадию'); }
    finally { setSavingSettings(false); }
  };
  const removePipeline = async () => {
    if (!pipeline || !confirm(`Удалить воронку «${pipeline.name}»?`)) return;
    setSavingSettings(true); setActionError('');
    try { await deleteFunnelPipeline(pipeline.id); setSettingsModal(false); setSelectedPipelineId(''); await load(false); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось удалить воронку'); }
    finally { setSavingSettings(false); }
  };
  const createPipeline = async (event: FormEvent) => {
    event.preventDefault(); if (!newPipelineName.trim()) return;
    setSavingSettings(true); setActionError('');
    try { const created = await createFunnelPipeline({ name: newPipelineName.trim(), isDefault: !workspace?.pipelines.length }); setCreatePipelineModal(false); setNewPipelineName(''); setSelectedPipelineId(created.id); await load(false); }
    catch (nextError) { setActionError(nextError instanceof Error ? nextError.message : 'Не удалось создать воронку'); }
    finally { setSavingSettings(false); }
  };

  return <div className="funnel-v2-page">
    <header className="funnel-v2-heading">
      <div><span>CRM SALES</span><h1>Воронка продаж</h1><p>Независимые воронки, динамические стадии и сделки с полной историей переходов.</p></div>
      <div><button className="button button-secondary" type="button" onClick={() => void load()}><RefreshCw size={15}/> Обновить</button><button className="button button-primary" type="button" onClick={openCreateDeal}><Plus size={15}/> Новая сделка</button></div>
    </header>

    {loading && <div className="funnel-v2-state">Загрузка CRM-воронки…</div>}
    {error && <div className="funnel-v2-state error"><AlertTriangle size={18}/>{error}<button onClick={() => void load()}>Повторить</button></div>}

    {workspace && !loading && <>
      {actionError && <div className="funnel-v2-alert"><AlertTriangle size={16}/><span>{actionError}</span><button onClick={() => setActionError('')}><X size={15}/></button></div>}
      <section className="funnel-v2-kpis">
        <article><UsersRound/><div><small>Всего сделок</small><strong>{stats?.total || 0}</strong><em>{stats?.open || 0} в работе</em></div></article>
        <article><TrendingUp/><div><small>Конверсия</small><strong>{conversion}%</strong><em>{stats?.won || 0} выиграно · {stats?.lost || 0} потеряно</em></div></article>
        <article><CircleDollarSign/><div><small>Выручка</small><strong>{money.format(stats?.wonAmount || 0)}</strong><em>по выигранным сделкам</em></div></article>
        <article><Target/><div><small>Взвешенная сумма</small><strong>{money.format(stats?.weightedAmount || 0)}</strong><em>с учётом вероятности стадий</em></div></article>
        <article className={stats?.overdue ? 'warning' : ''}><Clock3/><div><small>Просрочено</small><strong>{stats?.overdue || 0}</strong><em>следующих действий</em></div></article>
      </section>

      <section className="funnel-v2-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, телефон, email, источник или описание"/>
        <select value={managerId} onChange={(event) => setManagerId(event.target.value)}><option value="">Все менеджеры</option>{workspace.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>
        <select value={diagnostId} onChange={(event) => setDiagnostId(event.target.value)}><option value="">Все диагносты</option>{workspace.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>
        <select value={priority} onChange={(event) => setPriority(event.target.value as FunnelDealPriority | '')}><option value="">Все приоритеты</option>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">Все стадии</option>{pipeline?.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" onClick={() => { setQuery(''); setManagerId(''); setDiagnostId(''); setPriority(''); setStageId(''); }}>Сбросить</button>
      </section>

      <SalesFunnelKanban pipelines={workspace.pipelines} selectedPipelineId={selectedPipelineId} deals={workspace.deals} users={workspace.users} draggingId={draggingId} onSelectPipeline={selectPipeline} onDraggingChange={setDraggingId} onMove={moveDeal} onOpen={openEditDeal} onCreatePipeline={() => setCreatePipelineModal(true)} onManagePipeline={openSettings}/>

      <section className="funnel-v2-bottom">
        <article><header><BarChart3 size={16}/><div><strong>Состав воронки</strong><small>Сделки и сумма по стадиям</small></div></header>{pipeline?.stages.map((stage) => { const deals = workspace.deals.filter((deal) => deal.stageId === stage.id); const amount = deals.reduce((sum, deal) => sum + deal.amount, 0); return <div className="funnel-v2-stage-row" key={stage.id}><i style={{ background: stage.color }}/><span>{stage.name}</span><b>{deals.length}</b><strong>{money.format(amount)}</strong></div>; })}</article>
        <article><header><Clock3 size={16}/><div><strong>Последние переходы</strong><small>История выбранной воронки</small></div></header>{workspace.events.slice(0, 12).map((item) => { const deal = workspace.deals.find((candidate) => candidate.id === item.dealId); const stage = pipeline?.stages.find((candidate) => candidate.id === item.toStageId); return <div className="funnel-v2-event" key={item.id}><span>{deal?.fullName || 'Сделка'}</span><b>→ {stage?.name || 'Стадия'}</b><time>{new Date(item.createdAt).toLocaleString('ru-KZ')}</time></div>; })}{!workspace.events.length && <p className="funnel-v2-empty">Переходов пока нет</p>}</article>
      </section>
    </>}

    {dealModal && <div className="funnel-v2-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingDeal) setDealModal(false); }}><form className="funnel-v2-modal" onSubmit={(event) => void saveDeal(event)}>
      <header><div><small>СДЕЛКА</small><h2>{editingDealId ? 'Карточка сделки' : 'Новая сделка'}</h2></div><button type="button" onClick={() => setDealModal(false)}><X/></button></header>
      <div className="funnel-v2-modal-body">
        <label className="wide"><span>Найти маркетинговый лид</span><input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Имя, телефон или email"/></label>
        {contacts.length > 0 && <label className="wide"><span>Связать с лидом</span><select value={dealDraft.marketingLeadId || ''} onChange={(event) => selectContact(event.target.value)}><option value="">Без связи</option>{contacts.map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.phone || item.email || 'без контакта'}</option>)}</select></label>}
        <label className="wide"><span>Имя *</span><input required value={dealDraft.fullName || ''} onChange={(event) => setDealDraft({ ...dealDraft, fullName: event.target.value })}/></label>
        <label><span>Телефон</span><input value={dealDraft.phone || ''} onChange={(event) => setDealDraft({ ...dealDraft, phone: event.target.value })}/></label>
        <label><span>Email</span><input type="email" value={dealDraft.email || ''} onChange={(event) => setDealDraft({ ...dealDraft, email: event.target.value })}/></label>
        <label><span>Воронка</span><select value={dealDraft.pipelineId || pipeline?.id || ''} onChange={(event) => { const next = workspace?.pipelines.find((item) => item.id === event.target.value); setDealDraft({ ...dealDraft, pipelineId: event.target.value, stageId: next?.stages[0]?.id }); }} disabled={Boolean(editingDealId)}>{workspace?.pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Стадия</span><select value={dealDraft.stageId || ''} onChange={(event) => setDealDraft({ ...dealDraft, stageId: event.target.value })}>{workspace?.pipelines.find((item) => item.id === (dealDraft.pipelineId || pipeline?.id))?.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Приоритет</span><select value={dealDraft.priority} onChange={(event) => setDealDraft({ ...dealDraft, priority: event.target.value as FunnelDealPriority })}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Источник</span><input value={dealDraft.source || ''} onChange={(event) => setDealDraft({ ...dealDraft, source: event.target.value })}/></label>
        <label><span>Менеджер</span><select value={dealDraft.managerUserId || ''} onChange={(event) => setDealDraft({ ...dealDraft, managerUserId: event.target.value || null })}><option value="">Не назначен</option>{workspace?.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
        <label><span>Диагност</span><select value={dealDraft.diagnostUserId || ''} onChange={(event) => setDealDraft({ ...dealDraft, diagnostUserId: event.target.value || null })}><option value="">Не назначен</option>{workspace?.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
        <label className="wide"><span>Потребность / комментарий</span><textarea rows={3} value={dealDraft.description || ''} onChange={(event) => setDealDraft({ ...dealDraft, description: event.target.value })}/></label>
        <label><span>Сумма, ₸</span><input type="number" min="0" step="1000" value={dealDraft.amount || 0} onChange={(event) => setDealDraft({ ...dealDraft, amount: Number(event.target.value) })}/></label>
        <label className="check"><input type="checkbox" checked={dealDraft.paid === true} onChange={(event) => setDealDraft({ ...dealDraft, paid: event.target.checked })}/><span>Оплачено</span></label>
        <label><span>Следующее действие</span><input value={dealDraft.nextAction || ''} onChange={(event) => setDealDraft({ ...dealDraft, nextAction: event.target.value })}/></label>
        <label><span>Срок действия</span><input type="datetime-local" value={dealDraft.nextActionAt || ''} onChange={(event) => setDealDraft({ ...dealDraft, nextActionAt: event.target.value || null })}/></label>
        {pipeline?.stages.find((item) => item.id === dealDraft.stageId)?.stageType === 'lost' && <label className="wide"><span>Причина потери</span><textarea rows={2} value={dealDraft.lostReason || ''} onChange={(event) => setDealDraft({ ...dealDraft, lostReason: event.target.value })}/></label>}
      </div>
      {actionError && <div className="funnel-v2-modal-error">{actionError}</div>}
      <footer><button type="button" className="button button-secondary" onClick={() => setDealModal(false)}>Отмена</button><button className="button button-primary" disabled={savingDeal}>{savingDeal ? 'Сохранение…' : 'Сохранить'}</button></footer>
    </form></div>}

    {createPipelineModal && <div className="funnel-v2-modal-layer"><form className="funnel-v2-modal compact" onSubmit={(event) => void createPipeline(event)}><header><div><small>ВОРОНКА</small><h2>Новая воронка</h2></div><button type="button" onClick={() => setCreatePipelineModal(false)}><X/></button></header><div className="funnel-v2-modal-body"><label className="wide"><span>Название *</span><input autoFocus required value={newPipelineName} onChange={(event) => setNewPipelineName(event.target.value)} placeholder="Например: Курсы для детей"/></label></div>{actionError && <div className="funnel-v2-modal-error">{actionError}</div>}<footer><button type="button" className="button button-secondary" onClick={() => setCreatePipelineModal(false)}>Отмена</button><button className="button button-primary" disabled={savingSettings}>Создать</button></footer></form></div>}

    {settingsModal && pipeline && <div className="funnel-v2-modal-layer"><form className="funnel-v2-modal settings" onSubmit={(event) => void savePipelineSettings(event)}><header><div><small>КОНСТРУКТОР</small><h2>Настройка воронки</h2></div><button type="button" onClick={() => setSettingsModal(false)}><X/></button></header>
      <div className="funnel-v2-modal-body settings-body">
        <section className="funnel-v2-pipeline-settings"><label><span>Название</span><input required value={pipelineName} onChange={(event) => setPipelineName(event.target.value)}/></label><label className="check"><input type="checkbox" checked={pipelineDefault} onChange={(event) => setPipelineDefault(event.target.checked)}/><span>Основная воронка</span></label></section>
        <section className="funnel-v2-stage-settings"><header><div><strong>Стадии</strong><small>Порядок сверху вниз определяет движение сделки</small></div></header>{stageDrafts.map((stage, index) => <article key={stage.id}>
          <span className="number">{index + 1}</span><input className="color" type="color" value={stage.color} onChange={(event) => updateStageDraft(stage.id, { color: event.target.value })}/><input value={stage.name} onChange={(event) => updateStageDraft(stage.id, { name: event.target.value })}/><select value={stage.stageType} onChange={(event) => updateStageDraft(stage.id, { stageType: event.target.value as FunnelStageType })}>{Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label><span>Вероятность</span><input type="number" min="0" max="100" value={stage.probability} onChange={(event) => updateStageDraft(stage.id, { probability: Number(event.target.value) })}/></label><div><button type="button" disabled={index === 0} onClick={() => moveStageDraft(index, -1)}><ArrowUp/></button><button type="button" disabled={index === stageDrafts.length - 1} onClick={() => moveStageDraft(index, 1)}><ArrowDown/></button><button type="button" className="danger" disabled={stageDrafts.length <= 1} onClick={() => void removeStage(stage)}><Trash2/></button></div>
        </article>)}</section>
        <section className="funnel-v2-add-stage"><header><strong>Добавить стадию</strong></header><input value={newStageName} onChange={(event) => setNewStageName(event.target.value)} placeholder="Название стадии"/><input type="color" value={newStageColor} onChange={(event) => setNewStageColor(event.target.value)}/><select value={newStageType} onChange={(event) => setNewStageType(event.target.value as FunnelStageType)}>{Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="number" min="0" max="100" value={newStageProbability} onChange={(event) => setNewStageProbability(Number(event.target.value))}/><button className="button button-secondary" type="button" disabled={!newStageName.trim() || savingSettings} onClick={() => void addStage()}><Plus size={14}/> Добавить</button></section>
      </div>
      {actionError && <div className="funnel-v2-modal-error">{actionError}</div>}
      <footer><div>{isAdmin && <button type="button" className="button danger-button" disabled={savingSettings} onClick={() => void removePipeline()}><Trash2 size={14}/> Удалить воронку</button>}</div><div><button type="button" className="button button-secondary" onClick={() => setSettingsModal(false)}>Отмена</button><button className="button button-primary" disabled={savingSettings}>{savingSettings ? 'Сохранение…' : 'Сохранить'}</button></div></footer>
    </form></div>}
  </div>;
}
