import { useEffect, useMemo } from 'react';
import { CalendarDays, Link2, Phone } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import ClinicSchedulePage from './ClinicSchedulePage';

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function ContextualSchedulePage() {
  const [params] = useSearchParams();
  const dealId = params.get('deal_id') || '';
  const leadId = params.get('lead_id') || '';
  const phone = params.get('phone') || '';
  const hasContext = Boolean(dealId || leadId || phone);
  const normalizedPhone = useMemo(() => normalizePhone(phone), [phone]);

  useEffect(() => {
    if (!hasContext || !phone) return;

    const prefillModal = () => {
      const modal = document.querySelector<HTMLElement>('.schedule-modal');
      if (!modal || modal.dataset.crmPrefilled === '1') return;

      const labels = Array.from(modal.querySelectorAll<HTMLLabelElement>('label'));
      const patientInput = labels.find((label) => label.querySelector('span')?.textContent?.trim() === 'Пациент')?.querySelector<HTMLInputElement>('input');
      const phoneInput = labels.find((label) => label.querySelector('span')?.textContent?.trim() === 'Телефон')?.querySelector<HTMLInputElement>('input');
      if (!phoneInput) return;

      const options = Array.from(document.querySelectorAll<HTMLOptionElement>('#schedule-patients option'));
      const matched = options.find((option) => normalizePhone(option.textContent || '') === normalizedPhone);
      const patientName = matched?.value || (phone ? `Клиент ${phone}` : 'Клиент');

      if (patientInput && !patientInput.value.trim()) setInputValue(patientInput, patientName);
      if (!phoneInput.value.trim()) setInputValue(phoneInput, phone);
      modal.dataset.crmPrefilled = '1';
    };

    const focusContext = window.setTimeout(() => {
      const search = document.querySelector<HTMLInputElement>('.mis-topbar-controls .search input');
      if (search && !search.value) setInputValue(search, phone);
      prefillModal();
    }, 250);

    const observer = new MutationObserver(prefillModal);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(focusContext);
      observer.disconnect();
    };
  }, [hasContext, normalizedPhone, phone]);

  return <div className="contextual-module-page">
    {hasContext && <section className="crm-context-bar crm-context-bar--schedule">
      <div className="crm-context-bar__icon"><CalendarDays size={19}/></div>
      <div className="crm-context-bar__copy">
        <small><Link2 size={13}/> CRM контекст</small>
        <strong>{dealId ? 'Запись из сделки' : leadId ? 'Запись из лида' : 'Запись клиента'}</strong>
        <span>{phone ? <><Phone size={13}/>{phone}</> : 'Контакт передан из CRM'}</span>
      </div>
      <div className="crm-context-bar__hint">Выберите свободное время. Штатная форма Schedule автоматически подставит клиента.</div>
    </section>}
    <ClinicSchedulePage/>
  </div>;
}
