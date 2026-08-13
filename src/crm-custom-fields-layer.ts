import {
  createDealCustomField,
  fetchDealWorkspace,
  saveDealCustomFieldValues,
  type DealCustomFieldDefinition,
  type DealCustomFieldType,
  type DealWorkspacePayload,
} from './services/dealWorkspace';

const TYPE_LABELS: Record<DealCustomFieldType, string> = {
  text: 'Текст', textarea: 'Большой текст', number: 'Число', date: 'Дата', select: 'Список',
  checkbox: 'Чекбокс', phone: 'Телефон', email: 'Email',
};

function dealIdFromLocation(): string {
  return window.location.pathname.match(/\/pipeline\/deal\/([0-9a-f-]{36})/i)?.[1] || '';
}

function valueAsString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function fieldControl(field: DealCustomFieldDefinition, value: unknown, editable: boolean, onSave: (value: unknown) => void): HTMLElement {
  const label = document.createElement('label');
  label.className = `crm-custom-field ${field.type === 'textarea' ? 'wide' : ''}`;
  const title = document.createElement('span');
  title.textContent = `${field.label}${field.required ? ' *' : ''}`;
  label.appendChild(title);

  let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.value = valueAsString(value);
    control = textarea;
  } else if (field.type === 'select') {
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Не выбрано';
    select.appendChild(empty);
    for (const option of field.options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      select.appendChild(node);
    }
    select.value = valueAsString(value);
    control = select;
  } else {
    const input = document.createElement('input');
    input.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
    if (field.type === 'checkbox') input.checked = value === true;
    else input.value = valueAsString(value);
    control = input;
  }

  control.disabled = !editable;
  control.dataset.fieldId = field.id;
  const save = async () => {
    const nextValue = control instanceof HTMLInputElement && control.type === 'checkbox'
      ? control.checked
      : control instanceof HTMLInputElement && control.type === 'number'
        ? (control.value === '' ? null : Number(control.value))
        : control.value;
    control.classList.add('is-saving');
    try {
      await onSave(nextValue);
      control.classList.remove('is-error');
      control.classList.add('is-saved');
      window.setTimeout(() => control.classList.remove('is-saved'), 900);
    } catch {
      control.classList.add('is-error');
    } finally {
      control.classList.remove('is-saving');
    }
  };
  if (editable) {
    if (field.type === 'checkbox' || field.type === 'select' || field.type === 'date') control.addEventListener('change', () => void save());
    else control.addEventListener('blur', () => void save());
  }
  label.appendChild(control);
  return label;
}

function adminCreator(dealId: string, afterCreate: () => Promise<void>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'crm-custom-fields-admin';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'crm-custom-fields-add';
  toggle.textContent = '+ Поле';
  wrap.appendChild(toggle);

  const form = document.createElement('form');
  form.className = 'crm-custom-fields-form';
  form.hidden = true;
  form.innerHTML = `
    <div class="crm-custom-fields-form__grid">
      <label><span>Название поля</span><input name="label" maxlength="80" required placeholder="Например: Тип услуги"></label>
      <label><span>Тип</span><select name="type">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label class="wide crm-custom-fields-options" hidden><span>Варианты списка</span><input name="options" placeholder="Первичный, Повторный, VIP"></label>
      <label class="crm-custom-fields-required"><input name="required" type="checkbox"><span>Обязательное поле</span></label>
    </div>
    <div class="crm-custom-fields-form__actions"><button type="button" data-cancel>Отмена</button><button type="submit">Создать</button></div>
  `;
  wrap.appendChild(form);
  const type = form.elements.namedItem('type') as HTMLSelectElement;
  const optionsLabel = form.querySelector<HTMLElement>('.crm-custom-fields-options')!;
  const syncType = () => { optionsLabel.hidden = type.value !== 'select'; };
  type.addEventListener('change', syncType);
  syncType();
  toggle.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) (form.elements.namedItem('label') as HTMLInputElement).focus(); });
  form.querySelector('[data-cancel]')?.addEventListener('click', () => { form.hidden = true; form.reset(); syncType(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const label = (form.elements.namedItem('label') as HTMLInputElement).value.trim();
    const fieldType = type.value as DealCustomFieldType;
    const options = (form.elements.namedItem('options') as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean);
    const required = (form.elements.namedItem('required') as HTMLInputElement).checked;
    submit.disabled = true;
    submit.textContent = 'Создаю…';
    try {
      await createDealCustomField(dealId, { label, type: fieldType, options, required });
      form.hidden = true;
      form.reset();
      syncType();
      await afterCreate();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось создать поле');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Создать';
    }
  });
  return wrap;
}

async function renderPanel(details: HTMLElement, dealId: string): Promise<void> {
  const old = details.querySelector<HTMLElement>('.crm-custom-fields-panel');
  if (old?.dataset.dealId === dealId && old.dataset.ready === '1') return;
  old?.remove();

  const panel = document.createElement('section');
  panel.className = 'crm-custom-fields-panel';
  panel.dataset.dealId = dealId;
  panel.innerHTML = '<div class="crm-custom-fields-loading">Загрузка дополнительных полей…</div>';
  const relations = details.querySelector('.deal-workspace-relations');
  if (relations) details.insertBefore(panel, relations);
  else details.appendChild(panel);

  let payload: DealWorkspacePayload;
  try {
    payload = await fetchDealWorkspace(dealId);
  } catch (error) {
    panel.innerHTML = `<div class="crm-custom-fields-error">${error instanceof Error ? error.message : 'Не удалось загрузить поля'}</div>`;
    return;
  }

  const repaint = async () => {
    panel.dataset.ready = '0';
    const fresh = await fetchDealWorkspace(dealId);
    paint(fresh);
  };
  const paint = (data: DealWorkspacePayload) => {
    panel.replaceChildren();
    panel.dataset.ready = '1';
    const head = document.createElement('header');
    head.innerHTML = '<div><strong>Поля клиники</strong><small>Создаются администратором и доступны всем сделкам</small></div>';
    if (data.customFields.canManageFields) head.appendChild(adminCreator(dealId, repaint));
    panel.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'deal-workspace-fields crm-custom-fields-grid';
    if (!data.customFields.definitions.length) {
      const empty = document.createElement('div');
      empty.className = 'crm-custom-fields-empty';
      empty.textContent = data.customFields.canManageFields ? 'Поля ещё не созданы. Нажмите «+ Поле».' : 'Администратор пока не добавил дополнительные поля.';
      grid.appendChild(empty);
    } else {
      for (const field of data.customFields.definitions) {
        grid.appendChild(fieldControl(field, data.customFields.values[field.id], data.customFields.canEditValues, async (value) => {
          await saveDealCustomFieldValues(dealId, { [field.id]: value });
        }));
      }
    }
    panel.appendChild(grid);
  };
  paint(payload);
}

let scheduled = false;
function scan(): void {
  scheduled = false;
  const dealId = dealIdFromLocation();
  if (!dealId) return;
  const details = document.querySelector<HTMLElement>('.deal-workspace-more');
  if (!details) return;
  void renderPanel(details, dealId);
}
function scheduleScan(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(scan);
}

if (typeof window !== 'undefined') {
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleScan);
  const originalPushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args) => { originalPushState(...args); scheduleScan(); };
  scheduleScan();
}
