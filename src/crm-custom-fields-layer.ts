import {
  createDealCustomField,
  fetchDealWorkspace,
  saveDealCustomFieldValues,
  updateDealCustomField,
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
function valueAsString(value: unknown): string { return value == null ? '' : typeof value === 'string' ? value : String(value); }

function fieldControl(field: DealCustomFieldDefinition, value: unknown, editable: boolean, onSave: (value: unknown) => void): HTMLElement {
  const label = document.createElement('label');
  label.className = `crm-custom-field ${field.type === 'textarea' ? 'wide' : ''}`;
  const title = document.createElement('span');
  title.textContent = `${field.label}${field.required ? ' *' : ''}`;
  label.appendChild(title);
  let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea'); textarea.rows = 3; textarea.value = valueAsString(value); control = textarea;
  } else if (field.type === 'select') {
    const select = document.createElement('select');
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Не выбрано'; select.appendChild(empty);
    for (const option of field.options) { const node = document.createElement('option'); node.value = option; node.textContent = option; select.appendChild(node); }
    select.value = valueAsString(value); control = select;
  } else {
    const input = document.createElement('input');
    input.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
    if (field.type === 'checkbox') input.checked = value === true; else input.value = valueAsString(value); control = input;
  }
  control.disabled = !editable || !field.active;
  const save = async () => {
    const nextValue = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control instanceof HTMLInputElement && control.type === 'number' ? (control.value === '' ? null : Number(control.value)) : control.value;
    control.classList.add('is-saving');
    try { await onSave(nextValue); control.classList.remove('is-error'); control.classList.add('is-saved'); window.setTimeout(() => control.classList.remove('is-saved'), 900); }
    catch { control.classList.add('is-error'); }
    finally { control.classList.remove('is-saving'); }
  };
  if (editable && field.active) {
    if (field.type === 'checkbox' || field.type === 'select' || field.type === 'date') control.addEventListener('change', () => void save());
    else control.addEventListener('blur', () => void save());
  }
  label.appendChild(control);
  return label;
}

function fieldEditor(dealId: string, field: DealCustomFieldDefinition, afterSave: () => Promise<void>): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'crm-custom-field-admin';
  const controls = document.createElement('div'); controls.className = 'crm-custom-field-admin__buttons';
  const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.title = 'Поднять выше';
  const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.title = 'Опустить ниже';
  const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Настроить';
  const hide = document.createElement('button'); hide.type = 'button'; hide.textContent = field.active ? 'Скрыть' : 'Вернуть'; hide.className = field.active ? 'danger-soft' : '';
  controls.append(up, down, edit, hide); wrap.appendChild(controls);

  const form = document.createElement('form'); form.className = 'crm-custom-field-edit-form'; form.hidden = true;
  form.innerHTML = `
    <label><span>Название</span><input name="label" maxlength="80" value="${field.label.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></label>
    <label><span>Тип</span><select name="type">${Object.entries(TYPE_LABELS).map(([value,label]) => `<option value="${value}" ${value===field.type?'selected':''}>${label}</option>`).join('')}</select></label>
    <label class="wide options"><span>Варианты списка</span><input name="options" value="${field.options.join(', ').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></label>
    <label class="check"><input name="required" type="checkbox" ${field.required?'checked':''}><span>Обязательное</span></label>
    <div class="actions"><button type="button" data-cancel>Отмена</button><button type="submit">Сохранить</button></div>`;
  wrap.appendChild(form);
  const type = form.elements.namedItem('type') as HTMLSelectElement;
  const options = form.querySelector<HTMLElement>('.options')!;
  const sync = () => { options.hidden = type.value !== 'select'; }; sync(); type.addEventListener('change', sync);
  edit.addEventListener('click', () => { form.hidden = !form.hidden; });
  form.querySelector('[data-cancel]')?.addEventListener('click', () => { form.hidden = true; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const label = (form.elements.namedItem('label') as HTMLInputElement).value.trim();
    const fieldType = type.value as DealCustomFieldType;
    const fieldOptions = (form.elements.namedItem('options') as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean);
    const required = (form.elements.namedItem('required') as HTMLInputElement).checked;
    await updateDealCustomField(dealId, field.id, { label, type: fieldType, options: fieldOptions, required });
    await afterSave();
  });
  hide.addEventListener('click', async () => { await updateDealCustomField(dealId, field.id, { active: !field.active }); await afterSave(); });
  up.addEventListener('click', () => wrap.dispatchEvent(new CustomEvent('fieldmove', { bubbles: true, detail: { id: field.id, direction: -1 } })));
  down.addEventListener('click', () => wrap.dispatchEvent(new CustomEvent('fieldmove', { bubbles: true, detail: { id: field.id, direction: 1 } })));
  return wrap;
}

function adminCreator(dealId: string, afterCreate: () => Promise<void>): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'crm-custom-fields-admin';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'crm-custom-fields-add'; toggle.textContent = '+ Поле'; wrap.appendChild(toggle);
  const form = document.createElement('form'); form.className = 'crm-custom-fields-form'; form.hidden = true;
  form.innerHTML = `<div class="crm-custom-fields-form__grid"><label><span>Название поля</span><input name="label" maxlength="80" required placeholder="Например: Тип услуги"></label><label><span>Тип</span><select name="type">${Object.entries(TYPE_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label class="wide crm-custom-fields-options" hidden><span>Варианты списка</span><input name="options" placeholder="Первичный, Повторный, VIP"></label><label class="crm-custom-fields-required"><input name="required" type="checkbox"><span>Обязательное поле</span></label></div><div class="crm-custom-fields-form__actions"><button type="button" data-cancel>Отмена</button><button type="submit">Создать</button></div>`;
  wrap.appendChild(form);
  const type = form.elements.namedItem('type') as HTMLSelectElement; const optionsLabel = form.querySelector<HTMLElement>('.crm-custom-fields-options')!; const syncType = () => { optionsLabel.hidden = type.value !== 'select'; }; type.addEventListener('change', syncType); syncType();
  toggle.addEventListener('click', () => { form.hidden = !form.hidden; });
  form.querySelector('[data-cancel]')?.addEventListener('click', () => { form.hidden = true; form.reset(); syncType(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const label = (form.elements.namedItem('label') as HTMLInputElement).value.trim(); const fieldType = type.value as DealCustomFieldType; const options = (form.elements.namedItem('options') as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean); const required = (form.elements.namedItem('required') as HTMLInputElement).checked;
    await createDealCustomField(dealId, { label, type: fieldType, options, required }); form.hidden = true; form.reset(); syncType(); await afterCreate();
  });
  return wrap;
}

async function renderPanel(details: HTMLElement, dealId: string): Promise<void> {
  const old = details.querySelector<HTMLElement>('.crm-custom-fields-panel');
  if (old?.dataset.dealId === dealId && (old.dataset.state === 'loading' || old.dataset.state === 'ready')) return;
  old?.remove();
  const panel = document.createElement('section'); panel.className = 'crm-custom-fields-panel'; panel.dataset.dealId = dealId; panel.dataset.state = 'loading'; panel.innerHTML = '<div class="crm-custom-fields-loading">Загрузка дополнительных полей…</div>';
  const relations = details.querySelector('.deal-workspace-relations'); if (relations) details.insertBefore(panel, relations); else details.appendChild(panel);
  let payload: DealWorkspacePayload;
  try { payload = await fetchDealWorkspace(dealId); } catch (error) { panel.dataset.state = 'error'; panel.innerHTML = `<div class="crm-custom-fields-error">${error instanceof Error ? error.message : 'Не удалось загрузить поля'}</div>`; return; }
  const repaint = async () => { panel.dataset.state = 'loading'; paint(await fetchDealWorkspace(dealId)); };
  const paint = (data: DealWorkspacePayload) => {
    panel.replaceChildren(); panel.dataset.state = 'ready';
    const head = document.createElement('header'); head.innerHTML = '<div><strong>Поля клиники</strong><small>Администратор управляет структурой, остальные заполняют</small></div>'; if (data.customFields.canManageFields) head.appendChild(adminCreator(dealId, repaint)); panel.appendChild(head);
    const grid = document.createElement('div'); grid.className = 'deal-workspace-fields crm-custom-fields-grid';
    const visible = data.customFields.definitions.filter((field) => field.active || data.customFields.canManageFields);
    if (!visible.length) { const empty = document.createElement('div'); empty.className = 'crm-custom-fields-empty'; empty.textContent = data.customFields.canManageFields ? 'Поля ещё не созданы. Нажмите «+ Поле».' : 'Администратор пока не добавил дополнительные поля.'; grid.appendChild(empty); }
    for (const field of visible) {
      const item = document.createElement('div'); item.className = `crm-custom-field-row ${field.active ? '' : 'is-hidden'}`;
      item.appendChild(fieldControl(field, data.customFields.values[field.id], data.customFields.canEditValues, async (value) => { await saveDealCustomFieldValues(dealId, { [field.id]: value }); }));
      if (data.customFields.canManageFields) item.appendChild(fieldEditor(dealId, field, repaint));
      grid.appendChild(item);
    }
    grid.addEventListener('fieldmove', async (event) => {
      const detail = (event as CustomEvent<{id:string;direction:number}>).detail; const fields = data.customFields.definitions.slice().sort((a,b)=>a.position-b.position); const index = fields.findIndex((f)=>f.id===detail.id); const target = index + detail.direction; if (index < 0 || target < 0 || target >= fields.length) return;
      const a = fields[index], b = fields[target]; await updateDealCustomField(dealId, a.id, { position: b.position }); await updateDealCustomField(dealId, b.id, { position: a.position }); await repaint();
    });
    panel.appendChild(grid);
  };
  paint(payload);
}

let scheduled = false;
function scan(): void { scheduled = false; const dealId = dealIdFromLocation(); if (!dealId) return; const details = document.querySelector<HTMLElement>('.deal-workspace-more'); if (!details) return; void renderPanel(details, dealId); }
function scheduleScan(): void { if (scheduled) return; scheduled = true; window.requestAnimationFrame(scan); }
if (typeof window !== 'undefined') {
  const observer = new MutationObserver(scheduleScan); observer.observe(document.documentElement, { childList: true, subtree: true }); window.addEventListener('popstate', scheduleScan);
  const originalPushState = window.history.pushState.bind(window.history); window.history.pushState = (...args) => { originalPushState(...args); scheduleScan(); }; scheduleScan();
}
