import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bell, CalendarDays, ChevronLeft, CircleDollarSign, LayoutDashboard, LoaderCircle, Mail, Megaphone, MessageCircle, Moon, Plus, RefreshCw, Search, Settings, Sun, Users, WalletCards, X } from 'lucide-react';
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
  const [dark, setDark] = useState(false);

  const activePipeline = pipelines.find((item) => item.id === pipelineId) ?? pipelines[0];

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await loadPipelines();
      setPipelines(next);
      const selected = pipelineId || next.find((item) => item.is_default)?.id || next[0]?.id || '';
      setPipelineId(selected);
      setDeals(selected ? await loadDeals(selected) : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [pipelineId]);

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (pipelineId) void loadDeals(pipelineId).then(setDeals).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, [pipelineId]);

  const visibleDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? deals.filter((deal) => [deal.title, deal.phone, deal.email, deal.source].some((value) => String(value || '').toLowerCase().includes(term))) : deals;
  }, [deals, query]);

  const total = visibleDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);

  async function handleMove(dealId: string, stageId: string) {
    const previous = deals;
    const current = deals.find((deal) => deal.id === dealId);
    if (!current || current.stage_id === stageId) return;
    setMovingId(dealId);
    setDeals((items) => items.map((deal) => deal.id === dealId ? { ...deal, stage_id: stageId } : deal));
    try {
      const updated = await moveDeal(dealId, stageId);
      setDeals((items) => items.map((deal) => deal.id === dealId ? updated : deal));
    } catch (reason) { setDeals(previous); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setMovingId(null); }
  }

  if (loading) return <div className="crm-state"><LoaderCircle className="spin"/><span>Загрузка CRM</span></div>;

  return <div className={`satu-shell ${dark ? 'is-dark' : ''}`}>
    <aside className="satu-sidebar">
      <a className="satu-logo" href="/"><span/>S</a>
      <nav>
        <a href="/"><LayoutDashboard/></a>
        <button className="active"><WalletCards/></button>
        <button><CalendarDays/></button>
        <button><Users/></button>
        <button><MessageCircle/></button>
        <button><Mail/></button>
        <button><Megaphone/></button>
      </nav>
      <button className="satu-settings"><Settings/></button>
    </aside>

    <div className="satu-main">
      <header className="satu-topbar">
        <div className="satu-brand"><strong>Satu CRM</strong><span>Омниканальные продажи</span></div>
        <label className="satu-global-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по сделкам"/><span>AI</span></label>
        <div className="satu-top-actions">
          <button onClick={() => setDark((value) => !value)}>{dark ? <Sun/> : <Moon/>}</button>
          <button><Bell/><i/></button>
          <div className="satu-avatar">АО</div>
        </div>
      </header>

      <div className="satu-banner"><span><strong>CRM подключена к рабочей базе.</strong> Сделки и стадии сохраняются в Supabase.</span></div>

      <main className="satu-content">
        <div className="satu-page-head">
          <div><a href="/"><ChevronLeft/>IMDS Marketing</a><h1>Сделки</h1><p>Управление лидами и продажами по воронкам</p></div>
          <div className="satu-head-actions"><button onClick={() => void refresh()}><RefreshCw/></button><button className="satu-primary" onClick={() => setCreatingStageId(activePipeline?.stages[0]?.id || null)}><Plus/>Новая сделка</button></div>
        </div>

        <section className="satu-kpis">
          <div><span>Сумма в работе</span><strong>{money.format(total)} ₸</strong><small>{visibleDeals.length} сделок</small></div>
          <div><span>Активная воронка</span><strong>{activePipeline?.name || '—'}</strong><small>{activePipeline?.stages.length || 0} стадий</small></div>
          <div><span>Успешные сделки</span><strong>{visibleDeals.filter((deal) => deal.status === 'won').length}</strong><small>Закрыто успешно</small></div>
          <div><span>Средний чек</span><strong>{visibleDeals.length ? money.format(total / visibleDeals.length) : 0} ₸</strong><small>По текущей выборке</small></div>
        </section>

        <section className="satu-toolbar">
          <select value={activePipeline?.id || ''} onChange={(event) => setPipelineId(event.target.value)}>{pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</select>
          <div className="satu-total"><CircleDollarSign/><strong>{money.format(total)} ₸</strong><span>{visibleDeals.length} сделок</span></div>
        </section>

        {error && <div className="crm-error"><span>{error}</span><button onClick={() => setError('')}><X/></button></div>}

        <div className="satu-board">
          {activePipeline?.stages.map((stage) => {
            const stageDeals = visibleDeals.filter((deal) => deal.stage_id === stage.id);
            const stageAmount = stageDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
            return <section className="satu-column" key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/deal-id'); if (id) void handleMove(id, stage.id); }}>
              <header style={{ borderTopColor: stage.color }}><div><h2>{stage.name}</h2><span>{stageDeals.length}</span></div><strong>{money.format(stageAmount)} ₸</strong></header>
              <div className="satu-cards">
                {stageDeals.map((deal) => <article key={deal.id} draggable className={movingId === deal.id ? 'is-moving' : ''} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/deal-id', deal.id); }}>
                  <h3>{deal.title}</h3>{deal.phone && <p>{deal.phone}</p>}{deal.source && <em>{deal.source}</em>}<footer><strong>{money.format(Number(deal.amount || 0))} ₸</strong><span>{deal.status}</span></footer>
                </article>)}
                {!stageDeals.length && <div className="satu-empty">Перетащите сделку сюда</div>}
              </div>
              <button className="satu-add" onClick={() => setCreatingStageId(stage.id)}><Plus/>Добавить сделку</button>
            </section>;
          })}
        </div>
      </main>
    </div>

    {creatingStageId && <DealModal stageId={creatingStageId} onClose={() => setCreatingStageId(null)} onCreated={(deal) => { setDeals((items) => [...items, deal]); setCreatingStageId(null); }}/>} 
  </div>;
}

function DealModal({ stageId, onClose, onCreated }: { stageId: string; onClose: () => void; onCreated: (deal: Deal) => void }) {
  const [title, setTitle] = useState(''); const [phone, setPhone] = useState(''); const [source, setSource] = useState(''); const [amount, setAmount] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); if (!title.trim()) return; setSaving(true); setError(''); try { onCreated(await createDeal({ title: title.trim(), stageId, phone: phone.trim() || undefined, source: source.trim() || undefined, amount: Number(amount || 0) })); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false); } }
  return <div className="crm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="crm-modal" onSubmit={submit}><div className="crm-modal-head"><div><h2>Новая сделка</h2><p>Добавление в выбранную стадию</p></div><button type="button" onClick={onClose}><X/></button></div><label>Название<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required/></label><label>Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)}/></label><label>Источник<input value={source} onChange={(event) => setSource(event.target.value)}/></label><label>Сумма, ₸<input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)}/></label>{error && <div className="crm-error">{error}</div>}<div className="crm-modal-actions"><button type="button" onClick={onClose}>Отмена</button><button className="satu-primary" disabled={saving || !title.trim()}>{saving ? 'Сохранение…' : 'Создать сделку'}</button></div></form></div>;
}
