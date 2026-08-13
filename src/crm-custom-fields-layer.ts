import {
  createDealCustomField,
  createDealCustomFieldSection,
  fetchDealWorkspace,
  saveDealCustomFieldValues,
  updateDealCustomField,
  updateDealCustomFieldSection,
  type DealCustomFieldDefinition,
  type DealCustomFieldRole,
  type DealCustomFieldSection,
  type DealCustomFieldType,
  type DealWorkspacePayload,
} from './services/dealWorkspace';

const TYPE_LABELS: Record<DealCustomFieldType, string> = {
  text: 'Текст', textarea: 'Большой текст', number: 'Число', date: 'Дата', select: 'Список',
  checkbox: 'Чекбокс', phone: 'Телефон', email: 'Email',
};
const ROLE_LABELS: Record<DealCustomFieldRole, string> = {
  administrator: 'Администратор', marketer: 'Маркетолог / менеджер', analyst: 'Аналитик', viewer: 'Наблюдатель',
};
const ALL_ROLES = Object.keys(ROLE_LABELS) as DealCustomFieldRole[];
const GENERAL_SECTION = '__general';

function dealIdFromLocation(): string {
  return window.location.pathname.match(/\/pipeline\/deal\/([0-9a-f-]{36})/i)?.[1] || '';
}
function valueAsString(value: unknown): string { return value == null ? '' : typeof value === 'string' ? value : String(value); }
function textButton(label: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; if (className) button.className = className; return button;
}
function option(value: string, label: string, selected = false): HTMLOptionElement {
  const node = document.createElement('option'); node.value = value; node.textContent = label; node.selected = selected; return node;
}
function checkbox(name: string, label: string, checked: boolean, value = '1'): HTMLLabelElement {
  const wrap = document.createElement('label'); wrap.className = 'crm-builder-check';
  const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.value = value; input.checked = checked;
  const span = document.createElement('span'); span.textContent = label; wrap.append(input, span); return wrap;
}
function selectedCheckboxValues(form: HTMLFormElement, name: string): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)).map((input) => input.value);
}
function hasDragType(event: DragEvent, type: string): boolean {
  return Array.from(event.dataTransfer?.types || []).includes(type);
}

function fieldControl(field: DealCustomFieldDefinition, value: unknown, onSave: (value: unknown) => Promise<void>, onRefresh: () => Promise<void>): HTMLElement {
  const label = document.createElement('label');
  label.className = `crm-custom-field ${field.type === 'textarea' ? 'wide' : ''}`;
  const title = document.createElement('span'); title.className = 'crm-custom-field__label';
  const name = document.createElement('b'); name.textContent = field.label; title.appendChild(name);
  if (field.required || field.requiredStageIds.length) { const required = document.createElement('em'); required.textContent = 'обяз.'; required.title = field.required ? 'Обязательное поле' : 'Обязательно на выбранных стадиях'; title.appendChild(required); }
  label.appendChild(title);
  if (field.helpText) { const help = document.createElement('small'); help.textContent = field.helpText; label.appendChild(help); }

  let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea'); textarea.rows = 3; textarea.value = valueAsString(value); control = textarea;
  } else if (field.type === 'select') {
    const select = document.createElement('select'); select.appendChild(option('', 'Не выбрано'));
    for (const item of field.options) select.appendChild(option(item, item)); select.value = valueAsString(value); control = select;
  } else {
    const input = document.createElement('input');
    input.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
    if (field.type === 'checkbox') input.checked = value === true; else input.value = valueAsString(value); control = input;
  }
  control.disabled = !field.canEditValue;
  control.dataset.fieldId = field.id;
  const save = async () => {
    const nextValue = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control instanceof HTMLInputElement && control.type === 'number' ? (control.value === '' ? null : Number(control.value)) : control.value;
    control.classList.add('is-saving');
    try {
      await onSave(nextValue); control.classList.remove('is-error'); control.classList.add('is-saved'); window.setTimeout(() => control.classList.remove('is-saved'), 900); await onRefresh();
    } catch { control.classList.add('is-error'); }
    finally { control.classList.remove('is-saving'); }
  };
  if (field.canEditValue) {
    if (field.type === 'checkbox' || field.type === 'select' || field.type === 'date') control.addEventListener('change', () => void save());
    else control.addEventListener('blur', () => void save());
  }
  label.appendChild(control);
  return label;
}

function qualityBar(data: DealWorkspacePayload): HTMLElement {
  const quality = data.customFields.quality;
  const wrap = document.createElement('div'); wrap.className = `crm-field-quality ${quality.missingRequiredFieldIds.length ? 'has-missing' : 'is-good'}`;
  const copy = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = `Данные сделки ${quality.completion}%`;
  const small = document.createElement('small'); small.textContent = quality.missingRequiredFieldIds.length ? `Не заполнено обязательных: ${quality.missingRequiredFieldIds.length}` : `${quality.filledFields} из ${quality.totalFields} полей заполнено`;
  copy.append(strong, small);
  const track = document.createElement('div'); track.className = 'crm-field-quality__track'; const fill = document.createElement('span'); fill.style.width = `${quality.completion}%`; track.appendChild(fill);
  wrap.append(copy, track); return wrap;
}

function fieldSettings(dealId: string, field: DealCustomFieldDefinition, data: DealWorkspacePayload, repaint: () => Promise<void>): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'crm-field-settings';
  const menu = textButton('⋮', 'crm-field-menu-button'); menu.title = 'Настройки поля'; wrap.appendChild(menu);
  const sheet = document.createElement('form'); sheet.className = 'crm-field-settings-sheet'; sheet.hidden = true;

  const top = document.createElement('div'); top.className = 'crm-field-settings-sheet__top';
  const title = document.createElement('strong'); title.textContent = 'Настройка поля'; const type = document.createElement('span'); type.textContent = TYPE_LABELS[field.type]; type.title = 'Тип поля фиксируется после создания'; top.append(title, type); sheet.appendChild(top);

  const grid = document.createElement('div'); grid.className = 'crm-field-settings-grid';
  const nameLabel = document.createElement('label'); nameLabel.innerHTML = '<span>Название</span>'; const name = document.createElement('input'); name.name = 'label'; name.maxLength = 80; name.value = field.label; nameLabel.appendChild(name); grid.appendChild(nameLabel);
  const sectionLabel = document.createElement('label'); sectionLabel.innerHTML = '<span>Раздел</span>'; const section = document.createElement('select'); section.name = 'sectionId'; section.appendChild(option('', 'Без раздела', !field.sectionId)); for (const item of data.customFields.sections.filter((item) => item.active)) section.appendChild(option(item.id, item.name, item.id === field.sectionId)); sectionLabel.appendChild(section); grid.appendChild(sectionLabel);
  const helpLabel = document.createElement('label'); helpLabel.className = 'wide'; helpLabel.innerHTML = '<span>Подсказка менеджеру</span>'; const help = document.createElement('input'); help.name = 'helpText'; help.maxLength = 300; help.placeholder = 'Что и как нужно заполнить'; help.value = field.helpText || ''; helpLabel.appendChild(help); grid.appendChild(helpLabel);
  if (field.type === 'select') {
    const optionsLabel = document.createElement('label'); optionsLabel.className = 'wide'; optionsLabel.innerHTML = '<span>Варианты списка</span>'; const options = document.createElement('input'); options.name = 'options'; options.value = field.options.join(', '); optionsLabel.appendChild(options); grid.appendChild(optionsLabel);
  }
  sheet.appendChild(grid);

  const rules = document.createElement('details'); rules.className = 'crm-field-settings-rules'; rules.open = false;
  const rulesSummary = document.createElement('summary'); rulesSummary.textContent = 'Обязательность и стадии'; rules.appendChild(rulesSummary);
  const globalRequired = checkbox('required', 'Обязательное всегда', field.required); rules.appendChild(globalRequired);
  if (data.customFields.stages.length) {
    const stagesTitle = document.createElement('small'); stagesTitle.textContent = 'Или требовать только при переходе на стадии:'; rules.appendChild(stagesTitle);
    const stages = document.createElement('div'); stages.className = 'crm-field-stage-rules';
    for (const stage of data.customFields.stages) stages.appendChild(checkbox('requiredStageIds', stage.name, field.requiredStageIds.includes(stage.id), stage.id));
    rules.appendChild(stages);
  }
  sheet.appendChild(rules);

  const access = document.createElement('details'); access.className = 'crm-field-settings-rules';
  const accessSummary = document.createElement('summary'); accessSummary.textContent = 'Кто видит и редактирует'; access.appendChild(accessSummary);
  const accessColumns = document.createElement('div'); accessColumns.className = 'crm-field-access-grid';
  const visible = document.createElement('div'); const visibleTitle = document.createElement('b'); visibleTitle.textContent = 'Видят'; visible.appendChild(visibleTitle);
  const editable = document.createElement('div'); const editableTitle = document.createElement('b'); editableTitle.textContent = 'Редактируют'; editable.appendChild(editableTitle);
  for (const item of ALL_ROLES) {
    const visibleCheck = checkbox('visibleRoles', ROLE_LABELS[item], field.visibleRoles.includes(item), item); if (item === 'administrator') (visibleCheck.querySelector('input') as HTMLInputElement).disabled = true; visible.appendChild(visibleCheck);
    const editableCheck = checkbox('editableRoles', ROLE_LABELS[item], field.editableRoles.includes(item), item); if (item === 'administrator') (editableCheck.querySelector('input') as HTMLInputElement).disabled = true; editable.appendChild(editableCheck);
  }
  accessColumns.append(visible, editable); access.appendChild(accessColumns); sheet.appendChild(access);
  sheet.appendChild(checkbox('showInSummary', 'Показывать среди ключевых данных карточки', field.showInSummary));

  const actions = document.createElement('div'); actions.className = 'crm-field-settings-actions';
  const archive = textButton(field.archivedAt ? 'Вернуть из архива' : 'В архив', field.archivedAt ? '' : 'danger-soft');
  const cancel = textButton('Закрыть'); const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Сохранить';
  actions.append(archive, cancel, save); sheet.appendChild(actions); wrap.appendChild(sheet);

  menu.addEventListener('click', () => { sheet.hidden = !sheet.hidden; });
  cancel.addEventListener('click', () => { sheet.hidden = true; });
  archive.addEventListener('click', async () => { archive.disabled = true; try { await updateDealCustomField(dealId, field.id, { archived: !field.archivedAt }); await repaint(); } finally { archive.disabled = false; } });
  sheet.addEventListener('submit', async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const selectedVisible = selectedCheckboxValues(sheet, 'visibleRoles') as DealCustomFieldRole[];
      const selectedEditable = selectedCheckboxValues(sheet, 'editableRoles') as DealCustomFieldRole[];
      const visibleRoles: DealCustomFieldRole[] = Array.from(new Set<DealCustomFieldRole>(['administrator', ...selectedVisible]));
      const editableRoles: DealCustomFieldRole[] = Array.from(new Set<DealCustomFieldRole>(['administrator', ...selectedEditable])).filter((item) => visibleRoles.includes(item));
      const input: Parameters<typeof updateDealCustomField>[2] = {
        label: name.value.trim(), sectionId: section.value || null, helpText: help.value.trim() || null,
        required: (sheet.elements.namedItem('required') as HTMLInputElement).checked,
        requiredStageIds: selectedCheckboxValues(sheet, 'requiredStageIds'), visibleRoles, editableRoles,
        showInSummary: (sheet.elements.namedItem('showInSummary') as HTMLInputElement).checked,
      };
      if (field.type === 'select') input.options = ((sheet.elements.namedItem('options') as HTMLInputElement)?.value || '').split(',').map((item) => item.trim()).filter(Boolean);
      await updateDealCustomField(dealId, field.id, input);
      await repaint();
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось сохранить настройки поля'); }
    finally { save.disabled = false; }
  });
  return wrap;
}

function createFieldForm(dealId: string, data: DealWorkspacePayload, repaint: () => Promise<void>): HTMLElement {
  const form = document.createElement('form'); form.className = 'crm-builder-create-form';
  const title = document.createElement('strong'); title.textContent = 'Новое поле'; form.appendChild(title);
  const grid = document.createElement('div'); grid.className = 'crm-builder-create-grid';
  const nameLabel = document.createElement('label'); nameLabel.innerHTML = '<span>Название</span>'; const name = document.createElement('input'); name.required = true; name.maxLength = 80; name.placeholder = 'Например: Бюджет пациента'; nameLabel.appendChild(name); grid.appendChild(nameLabel);
  const typeLabel = document.createElement('label'); typeLabel.innerHTML = '<span>Тип</span>'; const type = document.createElement('select'); for (const [value, label] of Object.entries(TYPE_LABELS)) type.appendChild(option(value, label)); typeLabel.appendChild(type); grid.appendChild(typeLabel);
  const sectionLabel = document.createElement('label'); sectionLabel.innerHTML = '<span>Раздел</span>'; const section = document.createElement('select'); section.appendChild(option('', 'Без раздела')); for (const item of data.customFields.sections.filter((item) => item.active)) section.appendChild(option(item.id, item.name)); sectionLabel.appendChild(section); grid.appendChild(sectionLabel);
  const optionsLabel = document.createElement('label'); optionsLabel.className = 'wide'; optionsLabel.hidden = true; optionsLabel.innerHTML = '<span>Варианты списка</span>'; const options = document.createElement('input'); options.placeholder = 'Первичный, Повторный, VIP'; optionsLabel.appendChild(options); grid.appendChild(optionsLabel); form.appendChild(grid);
  const actions = document.createElement('div'); actions.className = 'crm-builder-create-actions'; const cancel = textButton('Отмена'); cancel.dataset.cancel = '1'; const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Создать поле'; actions.append(cancel, submit); form.appendChild(actions);
  type.addEventListener('change', () => { optionsLabel.hidden = type.value !== 'select'; });
  form.addEventListener('submit', async (event) => { event.preventDefault(); submit.disabled = true; try { await createDealCustomField(dealId, { label: name.value.trim(), type: type.value as DealCustomFieldType, sectionId: section.value || null, options: type.value === 'select' ? options.value.split(',').map((item) => item.trim()).filter(Boolean) : [] }); await repaint(); } catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось создать поле'); } finally { submit.disabled = false; } });
  return form;
}

function createSectionForm(dealId: string, repaint: () => Promise<void>): HTMLElement {
  const form = document.createElement('form'); form.className = 'crm-builder-create-form crm-builder-create-section';
  const title = document.createElement('strong'); title.textContent = 'Новый раздел'; form.appendChild(title);
  const grid = document.createElement('div'); grid.className = 'crm-builder-create-grid';
  const nameLabel = document.createElement('label'); nameLabel.innerHTML = '<span>Название</span>'; const name = document.createElement('input'); name.required = true; name.maxLength = 80; name.placeholder = 'Например: Лечение'; nameLabel.appendChild(name); grid.appendChild(nameLabel);
  const descLabel = document.createElement('label'); descLabel.className = 'wide'; descLabel.innerHTML = '<span>Описание</span>'; const description = document.createElement('input'); description.maxLength = 300; description.placeholder = 'Необязательная подсказка'; descLabel.appendChild(description); grid.appendChild(descLabel); form.appendChild(grid);
  const actions = document.createElement('div'); actions.className = 'crm-builder-create-actions'; const cancel = textButton('Отмена'); cancel.dataset.cancel = '1'; const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Создать раздел'; actions.append(cancel, submit); form.appendChild(actions);
  form.addEventListener('submit', async (event) => { event.preventDefault(); submit.disabled = true; try { await createDealCustomFieldSection(dealId, { name: name.value.trim(), description: description.value.trim() || null }); await repaint(); } catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось создать раздел'); } finally { submit.disabled = false; } });
  return form;
}

async function reorderFields(dealId: string, data: DealWorkspacePayload, fieldId: string, targetFieldId: string | null, sectionId: string | null, repaint: () => Promise<void>): Promise<void> {
  const fields = data.customFields.definitions.filter((field) => !field.archivedAt).slice().sort((a, b) => a.position - b.position);
  const moving = fields.find((field) => field.id === fieldId); if (!moving) return;
  const without = fields.filter((field) => field.id !== fieldId);
  let insertAt = targetFieldId ? without.findIndex((field) => field.id === targetFieldId) : without.length;
  if (insertAt < 0) insertAt = without.length;
  without.splice(insertAt, 0, { ...moving, sectionId: sectionId || undefined });
  await Promise.all(without.map((field, index) => updateDealCustomField(dealId, field.id, { position: (index + 1) * 10, sectionId: field.id === fieldId ? (sectionId || null) : field.sectionId || null })));
  await repaint();
}

async function reorderSections(dealId: string, sections: DealCustomFieldSection[], sectionId: string, targetId: string, repaint: () => Promise<void>): Promise<void> {
  const ordered = sections.filter((item) => item.active).slice().sort((a, b) => a.position - b.position);
  const moving = ordered.find((item) => item.id === sectionId); if (!moving) return;
  const without = ordered.filter((item) => item.id !== sectionId); const target = without.findIndex((item) => item.id === targetId); without.splice(target < 0 ? without.length : target, 0, moving);
  await Promise.all(without.map((item, index) => updateDealCustomFieldSection(dealId, item.id, { position: (index + 1) * 10 })));
  await repaint();
}

function sectionBlock(dealId: string, section: DealCustomFieldSection | null, fields: DealCustomFieldDefinition[], data: DealWorkspacePayload, manageMode: boolean, repaint: () => Promise<void>): HTMLElement {
  const block = document.createElement('section'); block.className = 'crm-field-section'; block.dataset.sectionId = section?.id || GENERAL_SECTION;
  if (manageMode && section) { block.draggable = true; block.addEventListener('dragstart', (event) => { event.dataTransfer?.setData('text/x-crm-section', section.id); block.classList.add('is-dragging'); }); block.addEventListener('dragend', () => block.classList.remove('is-dragging')); }
  const head = document.createElement('header');
  const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = section?.name || 'Дополнительные данные'; copy.appendChild(name); if (section?.description) { const small = document.createElement('small'); small.textContent = section.description; copy.appendChild(small); } head.appendChild(copy);
  if (manageMode && section) {
    const actions = document.createElement('div'); actions.className = 'crm-field-section-actions'; const handle = document.createElement('span'); handle.textContent = '⠿'; handle.title = 'Перетащить раздел'; const rename = textButton('⋮'); rename.title = 'Настройки раздела'; actions.append(handle, rename); head.appendChild(actions);
    rename.addEventListener('click', async () => { const next = window.prompt('Название раздела', section.name); if (next === null) return; const trimmed = next.trim(); if (!trimmed) return; await updateDealCustomFieldSection(dealId, section.id, { name: trimmed }); await repaint(); });
  }
  block.appendChild(head);
  const grid = document.createElement('div'); grid.className = 'crm-custom-fields-grid';
  const visibleFields = fields.filter((field) => !field.archivedAt && (manageMode || field.active));
  for (const field of visibleFields) {
    const row = document.createElement('div'); row.className = `crm-custom-field-row ${!field.active ? 'is-hidden' : ''}`; row.dataset.fieldId = field.id;
    if (manageMode) {
      row.draggable = true; const handle = document.createElement('span'); handle.className = 'crm-field-drag-handle'; handle.textContent = '⠿'; handle.title = 'Перетащить поле'; row.appendChild(handle);
      row.addEventListener('dragstart', (event) => { event.stopPropagation(); event.dataTransfer?.setData('text/x-crm-field', field.id); row.classList.add('is-dragging'); }); row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    }
    row.appendChild(fieldControl(field, data.customFields.values[field.id], async (value) => { await saveDealCustomFieldValues(dealId, { [field.id]: value }); }, repaint));
    if (manageMode) row.appendChild(fieldSettings(dealId, field, data, repaint));
    row.addEventListener('dragover', (event) => { if (manageMode && hasDragType(event, 'text/x-crm-field')) { event.preventDefault(); row.classList.add('is-drop-target'); } });
    row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
    row.addEventListener('drop', (event) => { row.classList.remove('is-drop-target'); const movingId = event.dataTransfer?.getData('text/x-crm-field'); if (!movingId || movingId === field.id) return; event.preventDefault(); event.stopPropagation(); void reorderFields(dealId, data, movingId, field.id, section?.id || null, repaint); });
    grid.appendChild(row);
  }
  if (!visibleFields.length) { const empty = document.createElement('div'); empty.className = 'crm-field-section-empty'; empty.textContent = manageMode ? 'Перетащите поле сюда или создайте новое.' : 'Нет полей'; grid.appendChild(empty); }
  block.appendChild(grid);
  block.addEventListener('dragover', (event) => { if (!manageMode) return; if (hasDragType(event, 'text/x-crm-field') || hasDragType(event, 'text/x-crm-section')) { event.preventDefault(); block.classList.add('is-drop-section'); } });
  block.addEventListener('dragleave', (event) => { if (!block.contains(event.relatedTarget as Node | null)) block.classList.remove('is-drop-section'); });
  block.addEventListener('drop', (event) => {
    block.classList.remove('is-drop-section'); if (!manageMode) return;
    const movingField = event.dataTransfer?.getData('text/x-crm-field'); if (movingField) { event.preventDefault(); void reorderFields(dealId, data, movingField, null, section?.id || null, repaint); return; }
    const movingSection = event.dataTransfer?.getData('text/x-crm-section'); if (movingSection && section && movingSection !== section.id) { event.preventDefault(); void reorderSections(dealId, data.customFields.sections, movingSection, section.id, repaint); }
  });
  return block;
}

async function renderPanel(details: HTMLElement, dealId: string): Promise<void> {
  const old = details.querySelector<HTMLElement>('.crm-custom-fields-panel');
  if (old?.dataset.dealId === dealId && (old.dataset.state === 'loading' || old.dataset.state === 'ready')) return;
  old?.remove();
  const panel = document.createElement('section'); panel.className = 'crm-custom-fields-panel'; panel.dataset.dealId = dealId; panel.dataset.state = 'loading'; panel.innerHTML = '<div class="crm-custom-fields-loading">Загрузка дополнительных полей…</div>';
  const relations = details.querySelector('.deal-workspace-relations'); if (relations) details.insertBefore(panel, relations); else details.appendChild(panel);
  let manageMode = false;
  let creator: 'field' | 'section' | null = null;

  const repaint = async () => { panel.dataset.state = 'loading'; const fresh = await fetchDealWorkspace(dealId); paint(fresh); };
  const paint = (data: DealWorkspacePayload) => {
    panel.replaceChildren(); panel.dataset.state = 'ready';
    const head = document.createElement('header');
    const copy = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = 'Поля сделки'; const small = document.createElement('small'); small.textContent = data.customFields.canManageFields ? 'Структура общая для всех сделок клиники' : 'Заполняйте данные, настроенные администратором'; copy.append(strong, small); head.appendChild(copy);
    if (data.customFields.canManageFields) {
      const tools = document.createElement('div'); tools.className = 'crm-field-builder-tools'; const manage = textButton(manageMode ? 'Готово' : 'Настроить поля', manageMode ? 'is-active' : ''); tools.appendChild(manage);
      manage.addEventListener('click', () => { manageMode = !manageMode; creator = null; paint(data); });
      if (manageMode) { const addField = textButton('+ Поле', 'primary'); const addSection = textButton('+ Раздел'); tools.prepend(addSection); tools.prepend(addField); addField.addEventListener('click', () => { creator = creator === 'field' ? null : 'field'; paint(data); }); addSection.addEventListener('click', () => { creator = creator === 'section' ? null : 'section'; paint(data); }); }
      head.appendChild(tools);
    }
    panel.appendChild(head);
    panel.appendChild(qualityBar(data));
    if (manageMode && creator) {
      const createWrap = document.createElement('div'); createWrap.className = 'crm-builder-create-wrap'; const form = creator === 'field' ? createFieldForm(dealId, data, repaint) : createSectionForm(dealId, repaint); form.querySelector('[data-cancel]')?.addEventListener('click', () => { creator = null; paint(data); }); createWrap.appendChild(form); panel.appendChild(createWrap);
    }
    if (manageMode) { const hint = document.createElement('div'); hint.className = 'crm-field-builder-hint'; hint.textContent = '⠿ Перетаскивайте поля между разделами и меняйте порядок. Тип поля после создания фиксируется, чтобы не повредить данные.'; panel.appendChild(hint); }

    const activeSections = data.customFields.sections.filter((section) => manageMode || section.active).slice().sort((a, b) => a.position - b.position);
    const ungrouped = data.customFields.definitions.filter((field) => !field.sectionId && !field.archivedAt);
    if (ungrouped.length || (!activeSections.length && !data.customFields.definitions.filter((field) => !field.archivedAt).length)) panel.appendChild(sectionBlock(dealId, null, ungrouped, data, manageMode, repaint));
    for (const section of activeSections) panel.appendChild(sectionBlock(dealId, section, data.customFields.definitions.filter((field) => field.sectionId === section.id), data, manageMode, repaint));
    if (manageMode) {
      const archived = data.customFields.definitions.filter((field) => field.archivedAt);
      if (archived.length) { const archive = document.createElement('details'); archive.className = 'crm-field-archive'; const summary = document.createElement('summary'); summary.textContent = `Архив полей · ${archived.length}`; archive.appendChild(summary); const grid = document.createElement('div'); grid.className = 'crm-custom-fields-grid'; for (const field of archived) { const row = document.createElement('div'); row.className = 'crm-custom-field-row is-archived'; row.append(fieldControl(field, data.customFields.values[field.id], async () => undefined, repaint), fieldSettings(dealId, field, data, repaint)); grid.appendChild(row); } archive.appendChild(grid); panel.appendChild(archive); }
    }
  };
  try { paint(await fetchDealWorkspace(dealId)); } catch (error) { panel.dataset.state = 'error'; panel.innerHTML = `<div class="crm-custom-fields-error">${error instanceof Error ? error.message : 'Не удалось загрузить поля'}</div>`; }
}

let scheduled = false;
function scan(): void { scheduled = false; const dealId = dealIdFromLocation(); if (!dealId) return; const details = document.querySelector<HTMLElement>('.deal-workspace-more'); if (!details) return; void renderPanel(details, dealId); }
function scheduleScan(): void { if (scheduled) return; scheduled = true; window.requestAnimationFrame(scan); }
if (typeof window !== 'undefined') {
  const observer = new MutationObserver(scheduleScan); observer.observe(document.documentElement, { childList: true, subtree: true }); window.addEventListener('popstate', scheduleScan);
  const originalPushState = window.history.pushState.bind(window.history); window.history.pushState = (...args) => { originalPushState(...args); scheduleScan(); }; scheduleScan();
}
