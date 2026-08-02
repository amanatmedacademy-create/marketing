import { useMemo, useState } from 'react';
import { GripVertical, Plus, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useActionFeedback } from '../../system/ActionFeedback';
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
  const { currentUser } = useAuth();
  const feedback = useActionFeedback();
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
  const isBusy = createPipeline.isPending || renamePipeline.isPending || deletePipeline.isPending;

  const addStage = () => setStages(value => [...value, { id: crypto.randomUUID(), name: `Этап ${value.length + 1}`, color: '#64748B', type: 'open' }]);
  const updateStage = (id: string, patch: Partial<DraftStage>) => setStages(value => value.map(stage => stage.id === id ? { ...stage, ...patch } : stage));
  const removeStage = (id: string) => setStages(value => value.length <= 2 ? value : value.filter(stage => stage.id !== id));

  const submit = () => {
    createPipeline.mutate({
      companyId: currentUser.companyId,
      name: name.trim(),
      isDefault,
      stages: stages.map(stage => ({ name: stage.name.trim(), color: stage.color, isWon: stage.type === 'won', isLost: stage.type === 'lost' })),
    }, {
      onSuccess: id => {
        feedback.success('Воронка создана', `«${name.trim()}» готова к работе.`);
        onSelect(id);
        onClose();
      },
      onError: mutationError => feedback.error('Не удалось создать воронку', mutationError instanceof Error ? mutationError.message : 'Проверьте введённые данные.'),
    });
  };

  const rename = (pipeline: Pipeline) => {
    const nextName = renameValue.trim();
    if (!nextName || nextName === pipeline.name) {
      setRenamingId(null);
      return;
    }
    renamePipeline.mutate({ companyId: currentUser.companyId, pipelineId: pipeline.id, name: nextName }, {
      onSuccess: () => {
        feedback.success('Воронка переименована', `Новое название: «${nextName}».`);
        setRenamingId(null);
      },
      onError: mutationError => feedback.error('Не удалось переименовать', mutationError instanceof Error ? mutationError.message : 'Попробуйте ещё раз.'),
    });
  };

  const remove = async (pipeline: Pipeline) => {
    if (pipelines.length <= 1) return;
    const approved = await feedback.confirm({
      title: 'Удалить воронку?',
      message: `Воронка «${pipeline.name}» и её этапы будут удалены. Сделки должны быть перенесены заранее.`,
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!approved) return;
    deletePipeline.mutate({ companyId: currentUser.companyId, pipelineId: pipeline.id }, {
      onSuccess: () => feedback.success('Воронка удалена', `«${pipeline.name}» удалена.`),
      onError: mutationError => feedback.error('Не удалось удалить воронку', mutationError instanceof Error ? mutationError.message : 'Проверьте, нет ли в ней сделок.'),
    });
  };

  return <div className="pipeline-modal-backdrop" onMouseDown={() => { if (!isBusy) onClose(); }}>
    <section className="pipeline-modal" onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><h2>{mode === 'create' ? 'Создать воронку' : 'Управление воронками'}</h2><p>{mode === 'create' ? 'Настройте этапы и результат каждого этапа.' : 'Выберите, переименуйте или удалите воронку.'}</p></div>
        <button className="pipeline-icon-button" disabled={isBusy} onClick={onClose}><X size={18} /></button>
      </header>

      {mode === 'list' ? <>
        <div className="pipeline-list">
          {pipelines.map(pipeline => <article key={pipeline.id} className={pipeline.id === currentPipelineId ? 'active' : ''}>
            <button className="pipeline-list-main" disabled={isBusy} onClick={() => { onSelect(pipeline.id); onClose(); }}>
              <span style={{ background: pipeline.stages[0]?.color ?? '#3B82F6' }} />
              <div><strong>{pipeline.name}</strong><small>{pipeline.stages.length} этапов{pipeline.isDefault ? ' · основная' : ''}</small></div>
            </button>
            {renamingId === pipeline.id ? <div className="pipeline-rename-row"><input value={renameValue} autoFocus disabled={renamePipeline.isPending} onKeyDown={event => { if (event.key === 'Enter') rename(pipeline); if (event.key === 'Escape') setRenamingId(null); }} onChange={event => setRenameValue(event.target.value)} /><button disabled={renamePipeline.isPending || !renameValue.trim()} onClick={() => rename(pipeline)}><Save size={15} /></button></div> : <div className="pipeline-row-actions"><button disabled={isBusy} onClick={() => { setRenamingId(pipeline.id); setRenameValue(pipeline.name); }}>Переименовать</button><button className="danger" disabled={pipelines.length <= 1 || isBusy} onClick={() => void remove(pipeline)}><Trash2 size={15} /></button></div>}
          </article>)}
        </div>
        <footer><span>{error instanceof Error ? error.message : ''}</span><button className="pipeline-primary" disabled={isBusy} onClick={() => setMode('create')}><Plus size={16} /> Создать воронку</button></footer>
      </> : <>
        <div className="pipeline-form-grid">
          <label><span>Название</span><input value={name} disabled={createPipeline.isPending} onChange={event => setName(event.target.value)} placeholder="Например: Продажи" /></label>
          <label className="pipeline-checkbox"><input type="checkbox" checked={isDefault} disabled={createPipeline.isPending} onChange={event => setIsDefault(event.target.checked)} /><span>Сделать основной воронкой</span></label>
        </div>
        <div className="pipeline-stages-head"><div><strong>Этапы</strong><small>Минимум два этапа</small></div><button disabled={createPipeline.isPending} onClick={addStage}><Plus size={15} /> Добавить этап</button></div>
        <div className="pipeline-stage-list">
          {stages.map((stage, index) => <div className="pipeline-stage-row" key={stage.id}>
            <GripVertical size={17} className="pipeline-grip" />
            <span className="pipeline-stage-number">{index + 1}</span>
            <input type="color" value={stage.color} disabled={createPipeline.isPending} onChange={event => updateStage(stage.id, { color: event.target.value })} />
            <input className="pipeline-stage-name" value={stage.name} disabled={createPipeline.isPending} onChange={event => updateStage(stage.id, { name: event.target.value })} />
            <select value={stage.type} disabled={createPipeline.isPending} onChange={event => updateStage(stage.id, { type: event.target.value as DraftStage['type'] })}><option value="open">В работе</option><option value="won">Успешная продажа</option><option value="lost">Отказ</option></select>
            <button className="pipeline-icon-button danger" disabled={stages.length <= 2 || createPipeline.isPending} onClick={() => removeStage(stage.id)}><Trash2 size={15} /></button>
          </div>)}
        </div>
        <footer><button className="pipeline-secondary" disabled={createPipeline.isPending} onClick={() => setMode('list')}>Назад</button><span>{error instanceof Error ? error.message : ''}</span><button className="pipeline-primary" disabled={createPipeline.isPending || !name.trim() || stages.some(stage => !stage.name.trim())} onClick={submit}><Save size={16} /> {createPipeline.isPending ? 'Создание…' : 'Сохранить'}</button></footer>
      </>}
    </section>
  </div>;
}
