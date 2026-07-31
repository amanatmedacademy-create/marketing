import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CircleDollarSign, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react';
import { createDeal, loadDeals, loadPipelines, moveDeal, type Deal, type Pipeline } from '../services/crm';

const money = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 });

export default function CrmBoard() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingStageId, setCreatingStageId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const activePipeline = pipelines.find((item) => item.id === pipelineId) ?? pipelines[0];

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextPipelines = await loadPipelines();
      setPipelines(nextPipelines);
      const selected = pipelineId || nextPipelines.find((item) => item.is_default)?.id || nextPipelines[0]?.id || '';
      setPipelineId(selected);
      setDeals(selected ? await loadDeals(selected) : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!pipelineId) return;
    void loadDeals(pipelineId).then(setDeals).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [pipelineId]);

  const visibleDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return deals;
    return deals.filter((deal) => [deal.title, deal.phone, deal.email, deal.source].some((value) => String(value || '').toLowerCase().includes(term)));
  }, [deals, query]);

  async function handleMove(dealId: string, stageId: string) {
    const previous = deals;
    const current = deals.find((deal) => deal.id === dealId);
    if (!current || current.stage_id === stageId) return;
    setMovingId(dealId);
    setDeals((items) => items.map((deal) => deal.id === dealId ? { ...deal, stage_id: stageId } : deal));
    try {
      const updated = await moveDeal(dealId, stageId);
      setDeals((items) => items.map((deal) => deal.id === dealId ? updated : deal));
    } catch (reason) {
      setDeals(previous);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMovingId(null);
    }
  }

  if (loading) return <div className="crm-state"><LoaderCircle className="spin"/><span>Загрузка CRM</span></div>;

  return <div className="crm-page">
    <header className="crm-header">
      <div>
        <a className="crm-back" href="/"><ArrowLeft size={16}/> IMDS Marketing</a>
        <h1>CRM · Сделки</h1>
        <p>Воронка продаж и работа с лидами</p>
      </div>
      <div className="crm-header-actions">
        <button className="crm-icon-button" onClick={() => void refresh()} title="Обновить"><RefreshCw size={18}/></button>
        <button className="crm-primary" onClick={() => setCreatingStageId(activePipeline?.stages[0]?.id || null)}><Plus size={18}/> Новая сделка</button>
      </div>
    </header>

    <section className="crm-toolbar">
      <select value={activePipeline?.id || ''} onChange={(event) => setPipelineId(event.target.value)}>
        {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
      </select>
      <label className="crm-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по сделкам"/></label>
      <div className="crm-total"><CircleDollarSign size={18}/><strong>{money.format(visibleDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0))} ₸</strong><span>{visibleDeals.length} сделок</span></div>
    </section>

    {error && <div className="crm-error"><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}

    <main className="crm-board">
      {activePipeline?.stages.map((stage) => {
        const stageDeals = visibleDeals.filter((deal) => deal.stage_id === stage.id);
        const stageAmount = stageDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
        return <section className="crm-column" key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/deal-id'); if (id) void handleMove(id, stage.id); }}>
          <div className="crm-column-head" style={{ borderTopColor: stage.color }}>
            <div><h2>{stage.name}</h2><span>{stageDeals.length}</span></div>
            <strong>{money.format(stageAmount)} ₸</strong>
          </div>
          <div className="crm-cards">
            {stageDeals.map((deal) => <article className={`crm-card ${movingId === deal.id ? 'is-moving' : ''}`} key={deal.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/deal-id', deal.id); }}>
              <div className="crm-card-title">{deal.title}</div>
              {deal.phone && <div className="crm-card-meta">{deal.phone}</div>}
              {deal.source && <div className="crm-card-source">{deal.source}</div>}
              <div className="crm-card-footer"><strong>{money.format(Number(deal.amount || 0))} ₸</strong><span>{deal.status}</span></div>
            </article>)}
            {!stageDeals.length && <div className="crm-empty">Перетащите сделку сюда</div>}
          </div>
          <button className="crm-add-card" onClick={() => setCreatingStageId(stage.id)}><Plus size={16}/> Добавить сделку</button>
        </section>;
      })}
    </main>

    {creatingStageId && <DealModal stageId={creatingStageId} onClose={() => setCreatingStageId(null)} onCreated={(deal) => { setDeals((items) => [...items, deal]); setCreatingStageId(null); }}/>} 
  </div>;
}

function DealModal({ stageId, onClose, onCreated }: { stageId: string; onClose: () => void; onCreated: (deal: Deal) => void }) {
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true); setError('');
    try { onCreated(await createDeal({ title: title.trim(), stageId, phone: phone.trim() || undefined, source: source.trim() || undefined, amount: Number(amount || 0) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false); }
  }

  return <div className="crm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="crm-modal" onSubmit={submit}>
      <div className="crm-modal-head"><div><h2>Новая сделка</h2><p>Добавление карточки в выбранную стадию</p></div><button type="button" onClick={onClose}><X size={20}/></button></div>
      <label>Название<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Лечение позвоночника" required/></label>
      <label>Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 700 000 00 00"/></label>
      <label>Источник<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Meta Ads, TikTok, органика"/></label>
      <label>Сумма, ₸<input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0"/></label>
      {error && <div className="crm-error">{error}</div>}
      <div className="crm-modal-actions"><button type="button" onClick={onClose}>Отмена</button><button className="crm-primary" disabled={saving || !title.trim()}>{saving ? 'Сохранение…' : 'Создать сделку'}</button></div>
    </form>
  </div>;
}
