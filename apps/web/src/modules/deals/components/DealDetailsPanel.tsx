import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, LoaderCircle, Mail, Phone, Save, UserRound, X } from 'lucide-react';
import { useDealQuery, useUpdateDealMutation } from '../api/useDeals';
import type { Deal, Pipeline, PipelineStage } from '../types';

type Props = {
  deal: Deal;
  pipeline: Pipeline;
  stage: PipelineStage;
  onClose: () => void;
};

export function DealDetailsPanel({ deal, pipeline, stage, onClose }: Props) {
  const query = useDealQuery(deal.id);
  const current = query.data ?? deal;
  const updateDeal = useUpdateDealMutation(pipeline.id, deal.id);
  const [title, setTitle] = useState(current.title);
  const [phone, setPhone] = useState(current.phone ?? current.contact?.phone ?? '');
  const [email, setEmail] = useState(current.email ?? current.contact?.email ?? '');
  const [source, setSource] = useState(current.source ?? '');
  const [amount, setAmount] = useState(String(current.oneTimeAmount ?? '0'));
  const [stageId, setStageId] = useState(current.stageId);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(current.title);
    setPhone(current.phone ?? current.contact?.phone ?? '');
    setEmail(current.email ?? current.contact?.email ?? '');
    setSource(current.source ?? '');
    setAmount(String(current.oneTimeAmount ?? '0'));
    setStageId(current.stageId);
  }, [current.id, current.title, current.phone, current.email, current.source, current.oneTimeAmount, current.stageId, current.contact]);

  const selectedStage = useMemo(() => pipeline.stages.find((item) => item.id === stageId) ?? stage, [pipeline.stages, stage, stageId]);

  const save = () => {
    setSaved(false);
    updateDeal.mutate({
      title: title.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      source: source.trim() || null,
      amount: Number(amount || 0),
      stageId,
    }, { onSuccess: () => setSaved(true) });
  };

  return <div className="deal-panel-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="deal-details-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="deal-details-head">
        <div><span>Сделка</span><h2>{current.title}</h2></div>
        <button onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
      </header>

      {query.isLoading ? <div className="kanban-message"><LoaderCircle className="auth-spinner" size={22} /> Загрузка карточки…</div> : (
        <div className="deal-details-grid">
          <section className="deal-main-column">
            <div className="deal-contact-summary">
              <div className="deal-contact-avatar"><UserRound size={20} /></div>
              <div><strong>{title || current.title}</strong><span>{phone || 'Телефон не указан'}</span></div>
              <a href={phone ? `tel:${phone}` : undefined}><Phone size={15} /> Позвонить</a>
              <a href={phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : undefined} target="_blank" rel="noreferrer">WhatsApp</a>
            </div>

            <div className="deal-edit-form">
              <label><span>Название сделки</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label><span>Телефон</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
              <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label><span>Источник</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Instagram, WhatsApp, Meta Ads" /></label>
              <label><span>Сумма, ₸</span><input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
              <label><span>Этап</span><select value={stageId} onChange={(event) => setStageId(event.target.value)}>{[...pipeline.stages].sort((a,b) => a.order-b.order).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {updateDeal.isError && <div className="auth-error">{updateDeal.error instanceof Error ? updateDeal.error.message : 'Не удалось сохранить карточку'}</div>}
              <button className="auth-submit" type="button" onClick={save} disabled={updateDeal.isPending || !title.trim()}>{updateDeal.isPending ? <LoaderCircle size={17} className="auth-spinner" /> : <Save size={17} />} Сохранить изменения</button>
              {saved && <small>Изменения сохранены в Supabase.</small>}
            </div>
          </section>

          <aside className="deal-info-column">
            <section><h3><UserRound size={16} /> Клиент</h3><dl><div><dt>Название</dt><dd>{title || '—'}</dd></div><div><dt>Телефон</dt><dd>{phone || '—'}</dd></div><div><dt>Email</dt><dd><Mail size={13} /> {email || '—'}</dd></div><div><dt>Источник</dt><dd>{source || '—'}</dd></div></dl></section>
            <section><h3><CircleDollarSign size={16} /> Финансы</h3><dl><div className="deal-total-row"><dt>Сумма</dt><dd>{Number(amount || 0).toLocaleString('ru-RU')} ₸</dd></div></dl></section>
            <section><h3>Воронка</h3><dl><div><dt>Воронка</dt><dd>{pipeline.name}</dd></div><div><dt>Этап</dt><dd><i style={{ background: selectedStage.color }} /> {selectedStage.name}</dd></div></dl></section>
          </aside>
        </div>
      )}
    </section>
  </div>;
}
