import { CalendarDays, Link2, Phone } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import ClinicSchedulePage from './ClinicSchedulePage';
import type { ScheduleCrmContext } from './scheduleCrmContext';

export default function ContextualSchedulePage() {
  const [params] = useSearchParams();
  const crmContext: ScheduleCrmContext = {
    contactId: params.get('contact_id') || undefined,
    leadId: params.get('lead_id') || undefined,
    dealId: params.get('deal_id') || undefined,
    phone: params.get('phone') || undefined,
    name: params.get('name') || undefined,
  };
  const hasContext = Boolean(crmContext.contactId || crmContext.leadId || crmContext.dealId || crmContext.phone || crmContext.name);

  return <div className="contextual-module-page">
    {hasContext && <section className="crm-context-bar crm-context-bar--schedule">
      <div className="crm-context-bar__icon"><CalendarDays size={19}/></div>
      <div className="crm-context-bar__copy">
        <small><Link2 size={13}/> CRM контекст</small>
        <strong>{crmContext.dealId ? 'Запись из сделки' : crmContext.leadId ? 'Запись из лида' : 'Запись клиента'}</strong>
        <span>{crmContext.phone ? <><Phone size={13}/>{crmContext.phone}</> : crmContext.name || 'Контакт передан из CRM'}</span>
      </div>
      <div className="crm-context-bar__hint">Выберите свободное время. Форма Schedule использует CRM-контекст нативно.</div>
    </section>}
    <ClinicSchedulePage crmContext={hasContext ? crmContext : undefined}/>
  </div>;
}
