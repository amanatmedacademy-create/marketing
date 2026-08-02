import { useMemo, useState } from 'react';
import { GripVertical, Plus, Save, Trash2, X } from 'lucide-react';
import { useCreatePipelineMutation, useDeletePipelineMutation, useRenamePipelineMutation } from '../api/usePipelineManagement';
import type { Pipeline } from '../types';

type DraftStage = { id: string; name: string; color: string; type: 'open' | 'won' | 'lost' };

const defaultStages = (): DraftStage[] => [
  { id: crypto.randomUUID(), name: 'Новый лид', color: '#3B82F6', type: 'open' },
  { id: crypto.randomUUID(), name: 'В работе', color: '#F59E0B', type: 'open' },
  { id: crypto.randomUUID(), name: 'Продажа', color: '#22C55E', type: 'won' },
  { id: crypto.randomUUID(), name: 'Отказ', color: '#EF4444', type: 'lost' },
];

export function PipelineManagerModal({ pipelines, currentPipelineId, onClose, onSelect }: { pipelines: Pipeline[]; currentPipelineId?: string; onClose: () => void; onSelect: (id: string) => void }) {
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [name, setName] = useState('Новая воронка');
  const [isDefault, setIsDefault] = useState(false);
  const [stages, setStages] = useState<DraftStage[]>(defaultStages);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const createPipeline = useCreatePipelineMutation();
  const renamePipeline = useRenamePipelineMutation();
  const deletePipeline = useDeletePipelineMutation();
  const error = useMemo(() => createPipeline.error ?? renamePipeline.error ?? deletePipeline.error, [createPipeline.error, renamePipeline.error, deletePipeline.error]);

  const addStage = () => setStages(value => [...value, { id: crypto.randomUUID(), name: `Этап ${value.length + 1}`, color: '#64748B', type: 'open' }]);
  const updateStage = (id: string, patch: Partial<DraftStage>) => setStages(value => value.map(stage => stage.id === id ? { ...stage, ...patch } : stage));
  const removeStage = (id: string) => setStages(value => value.length <= 2 ? value : value.filter(stage => stage.id !== id));

  const submit = () => {
    createPipeline.mutate({
      name,
      isDefault,
      stages: stages.map(stage => ({ name: stage.name, color: stage.color, isWon: stage.type === 'won', isLost: stage.type === 'lost' })),
    }, {
      onSuccess: (pipeline) => { onSelect(pipeline.id); onClose(); },
    });
  };

  return <div className="pipeline-modal-backdrop" onMouseDown={onClose}>
    <section className="pipeline-modal" onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><h2>{mode === 'create' ? 'Создать воронку' : 'Управление воронками'}</h2><p>{mode === 'create' ? 'Настройте этапы и результат каждого этапа.' : 'Выберите, переименуйте или удалите воронку.'}</p></div>
        <button className="pipeline-icon-button" onClick={onClose}><X size={18} /></button>
      </header>

      {mode === 'list' ? <>
        <div className="pipeline-list">
          {pipelines.map(pipeline => <article key={pipeline.id} className={pipeline.id === currentPipelineId ? 'active' : ''}>
            <button className="pipeline-list-main" onClick={() => { onSelect(pipeline.id); onClose(); }}>
              <span style={{ background: pipeline.stages[0]?.color ?? '#3B82F6' }} />
              <div><strong>{pipeline.name}</strong><small>{pipeline.stages.length} этапов{pipeline.isDefault ? ' · основная' : ''}</small></div>
            </button>
            {renamingId === pipeline.id ? <div className="pipeline-rename-row"><input value={renameValue} autoFocus onChange={event => setRenameValue(event.target.value)} /><button onClick={() => renamePipeline.mutate({ pipelineId: pipeline.id, name: renameValue }, { onSuccess: () => setRenamingId(null) })}><Save size={15} /></button></div> : <div className="pipeline-row-actions"><button onClick={() => { setRenamingId(pipeline.id); setRenameValue(pipeline.name); }}>Переименовать</button><button className="danger" disabled={pipelines.length <= 1 || deletePipeline.isPending} onClick={() => { if (window.confirm(`Удалить воронку «${pipeline.name}»?`)) deletePipeline.mutate({ pipelineId: pipeline.id }); }}><Trash2 size={15} /></button></div>}
          </article>)}
        </div>
        <footer><span>{error instanceof Error ? error.message : ''}</span><button className="pipeline-primary" onClick={() => setMode('create')}><Plus size={16} /> Создать воронку</button></footer>
      </> : <>
        <div className="pipeline-form-grid">
          <label><span>Название</span><input value={name} onChange={event => setName(event.target.value)} placeholder="Например: Продажи" /></label>
          <label className="pipeline-checkbox"><input type="checkbox" checked={isDefault} onChange={event => setIsDefault(event.target.checked)} /><span>Сделать основной воронкой</span></label>
        </div>
        <div className="pipeline-stages-head"><div><strong>Этапы</strong><small>Минимум два этапа</small></div><button onClick={addStage}><Plus size={15} /> Добавить этап</button></div>
        <div className="pipeline-stage-list">
          {stages.map((stage, index) => <div className="pipeline-stage-row" key={stage.id}>
            <GripVertical size={17} className="pipeline-grip" />
            <span className="pipeline-stage-number">{index + 1}</span>
            <input type="color" value={stage.color} onChange={event => updateStage(stage.id, { color: event.target.value })} />
            <input className="pipeline-stage-name" value={stage.name} onChange={event => updateStage(stage.id, { name: event.target.value })} />
            <select value={stage.type} onChange={event => updateStage(stage.id, { type: event.target.value as DraftStage['type'] })}><option value="open">В работе</option><option value="won">Успешная продажа</option><option value="lost">Отказ</option></select>
            <button className="pipeline-icon-button danger" disabled={stages.length <= 2} onClick={() => removeStage(stage.id)}><Trash2 size={15} /></button>
          </div>)}
        </div>
        <footer><button className="pipeline-secondary" onClick={() => setMode('list')}>Назад</button><span>{error instanceof Error ? error.message : ''}</span><button className="pipeline-primary" disabled={createPipeline.isPending || !name.trim() || stages.some(stage => !stage.name.trim())} onClick={submit}><Save size={16} /> {createPipeline.isPending ? 'Создание…' : 'Сохранить'}</button></footer>
      </>}
    </section>
  </div>;
}
