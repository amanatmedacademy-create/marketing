import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Link2, ListChecks, LoaderCircle, Phone } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../components/AuthGate';
import { tasksApi } from '../services/tasks';
import TasksPage from './TasksPage';

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export default function ContextualTasksPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const dealId = params.get('deal_id') || '';
  const leadId = params.get('lead_id') || '';
  const phone = params.get('phone') || '';
  const hasContext = Boolean(dealId || leadId || phone);
  const [title, setTitle] = useState(() => phone ? `Связаться с клиентом ${phone}` : 'Связаться с клиентом');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);

  const linkLabel = useMemo(() => {
    if (dealId) return `CRM сделка · ${phone || dealId.slice(0, 8)}`;
    if (leadId) return `CRM лид · ${phone || leadId.slice(0, 8)}`;
    return phone ? `Клиент · ${phone}` : 'CRM';
  }, [dealId, leadId, phone]);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await tasksApi.create({
        title: title.trim(),
        description: phone ? `Клиент: ${phone}` : null,
        priority: 'medium',
        assignmentMode: 'shared',
        workflowKey: phone ? 'call_center' : 'general',
        targets: [{
          targetType: 'user',
          targetValue: user.id,
          targetLabel: user.name || user.email || 'Текущий пользователь',
        }],
        linkType: dealId ? 'crm_deal' : leadId ? 'marketing_lead' : 'customer',
        linkId: dealId || leadId || normalizePhone(phone) || null,
        linkLabel,
      });
      setCreated(true);
      window.setTimeout(() => window.location.assign('/tasks'), 350);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать задачу');
    } finally {
      setBusy(false);
    }
  };

  return <div className="contextual-module-page">
    {hasContext && <section className="crm-context-bar crm-context-bar--task">
      <div className="crm-context-bar__icon"><ListChecks size={19}/></div>
      <div className="crm-context-bar__copy">
        <small><Link2 size={13}/> CRM контекст</small>
        <strong>{linkLabel}</strong>
        <span>{phone ? <><Phone size={13}/>{phone}</> : 'Связанная задача будет сохранена в едином Task Engine.'}</span>
      </div>
      <label className="crm-context-bar__field">
        <span>Новая задача</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create(); }}/>
      </label>
      <button className="button button--primary crm-context-bar__action" type="button" disabled={busy || created || !title.trim()} onClick={() => void create()}>
        {created ? <CheckCircle2 size={16}/> : busy ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={16}/>}
        {created ? 'Создано' : busy ? 'Создаём…' : 'Создать'}
      </button>
      {error && <div className="crm-context-bar__error">{error}</div>}
    </section>}
    <TasksPage/>
  </div>;
}
