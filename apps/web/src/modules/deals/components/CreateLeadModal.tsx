import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { Pipeline } from '../types';

type Props = {
  pipeline: Pipeline;
  isSubmitting: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: { title: string; stageId: string; phone?: string; email?: string; source?: string; amount?: number }) => void;
};

export function CreateLeadModal({ pipeline, isSubmitting, error, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('0');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');

  useEffect(() => {
    if (!pipeline.stages.some((stage) => stage.id === stageId)) {
      setStageId([...pipeline.stages].sort((a, b) => a.order - b.order)[0]?.id ?? '');
    }
  }, [pipeline, stageId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !stageId || isSubmitting) return;
    onSubmit({
      title: name.trim(),
      stageId,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      source: source.trim() || undefined,
      amount: Number(amount || 0),
    });
  }

  return <div className="lead-modal-backdrop" onMouseDown={isSubmitting ? undefined : onClose}>
    <form className="lead-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>Добавить лид</h2><button type="button" onClick={onClose} disabled={isSubmitting}><X size={18} /></button></header>
      <div className="lead-form-grid">
        <label>Имя / название сделки *<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Алия — консультация" /></label>
        <label>Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 999 123 4567" /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" /></label>
        <label>Источник<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Instagram, WhatsApp, сайт" /></label>
        <label>Воронка *<select value={pipeline.id} disabled><option value={pipeline.id}>{pipeline.name}</option></select></label>
        <label>Этап *<select value={stageId} onChange={(event) => setStageId(event.target.value)}>{[...pipeline.stages].sort((a,b) => a.order-b.order).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label>Сумма сделки (₸)<input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      </div>
      {error && <div className="lead-modal-error"><AlertCircle size={16} /><span>{error}</span></div>}
      <footer><button type="button" onClick={onClose} disabled={isSubmitting}>Отмена</button><button className="primary" disabled={!name.trim() || !stageId || isSubmitting}>{isSubmitting ? 'Создание…' : 'Создать лид'}</button></footer>
    </form>
  </div>;
}
