import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Pipeline } from '../types';

type Props = {
  pipeline: Pipeline;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; stageId: string }) => void;
};

export function CreateLeadModal({ pipeline, isSubmitting, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !stageId || isSubmitting) return;
    onSubmit({ title: name.trim(), stageId });
  }

  return (
    <div className="lead-modal-backdrop" onMouseDown={onClose}>
      <form className="lead-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>Добавить лид</h2><button type="button" onClick={onClose}><X size={18} /></button></header>

        <div className="lead-form-grid">
          <label>Имя *<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя" /></label>
          <label>Телефон<input placeholder="+7 999 123 4567" /></label>
          <label>Email<input type="email" placeholder="email@example.com" /></label>
          <label>Источник<input placeholder="Instagram, сайт…" /></label>
          <label>Должность<input placeholder="Должность" /></label>
          <label>Город<input placeholder="Алматы" /></label>
          <label>Страна<input placeholder="Казахстан" /></label>
          <label>Instagram<input placeholder="@username" /></label>
          <label>Воронка *<select value={pipeline.id} disabled><option>{pipeline.name}</option></select></label>
          <label>Этап *<select value={stageId} onChange={(event) => setStageId(event.target.value)}>{pipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          <label>Менеджер<select><option>Не назначен</option></select></label>
          <label>Разовый (₸)<input type="number" min="0" defaultValue="0" /></label>
          <label>Ежемесячный (₸)<input type="number" min="0" defaultValue="0" /></label>
          <label className="lead-notes-field">Заметки<textarea placeholder="Заметки…" /></label>
        </div>

        <footer><button type="button" onClick={onClose}>Отмена</button><button className="primary" disabled={!name.trim() || !stageId || isSubmitting}>{isSubmitting ? 'Создание…' : 'Создать'}</button></footer>
      </form>
    </div>
  );
}
