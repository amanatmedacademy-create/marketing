type Row = Record<string, unknown>;

export const CLINIC_FLOW_NAME = 'IMDS Clinic Appointment';
export const CLINIC_FLOW_CATEGORY = ['APPOINTMENT_BOOKING', 'LEAD_GENERATION'];
export const CLINIC_FLOW_SCHEMA_VERSION = 2;

const optionArray = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
    },
  },
};

export const CLINIC_FLOW_JSON: Row = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    APPOINTMENT: ['DOCTOR'],
    DOCTOR: ['SLOT'],
    SLOT: ['SUCCESS'],
    SUCCESS: [],
  },
  screens: [
    {
      id: 'APPOINTMENT',
      title: 'Запись в клинику',
      terminal: false,
      success: false,
      data: {
        branches: { ...optionArray, __example__: [{ id: 'branch-1', title: 'Филиал', description: 'Адрес' }] },
        has_branches: { type: 'boolean', __example__: true },
        error_message: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'appointment_form',
            children: [
              { type: 'TextHeading', text: 'Выберите филиал' },
              { type: 'TextBody', text: 'Укажите данные пациента и выберите филиал. На следующем шаге покажем доступных врачей и свободное время.' },
              { type: 'TextInput', name: 'name', label: 'Имя', required: true, 'input-type': 'text' },
              { type: 'TextInput', name: 'phone', label: 'Телефон', required: true, 'input-type': 'phone' },
              {
                type: 'Dropdown',
                name: 'service',
                label: 'Что вас интересует?',
                required: true,
                'data-source': [
                  { id: 'consultation', title: 'Консультация' },
                  { id: 'diagnostics', title: 'Диагностика' },
                  { id: 'repeat', title: 'Повторный приём' },
                  { id: 'other', title: 'Другое' },
                ],
              },
              { type: 'Dropdown', name: 'branch_id', label: 'Филиал', required: true, 'data-source': '${data.branches}' },
              { type: 'TextBody', text: '${data.error_message}' },
              {
                type: 'Footer',
                label: 'Выбрать врача',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    name: '${form.name}',
                    phone: '${form.phone}',
                    service: '${form.service}',
                    branch_id: '${form.branch_id}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'DOCTOR',
      title: 'Выберите врача',
      terminal: false,
      success: false,
      data: {
        name: { type: 'string', __example__: 'Пациент' },
        phone: { type: 'string', __example__: '+77000000000' },
        service: { type: 'string', __example__: 'consultation' },
        branch_id: { type: 'string', __example__: 'branch-1' },
        doctors: { ...optionArray, __example__: [{ id: 'doctor-1', title: 'Врач', description: 'Специализация' }] },
        has_doctors: { type: 'boolean', __example__: true },
        error_message: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'doctor_form',
            children: [
              { type: 'TextHeading', text: 'Доступные специалисты' },
              { type: 'TextBody', text: 'Выберите врача. После этого IMDS покажет только реально свободные слоты из расписания.' },
              { type: 'Dropdown', name: 'doctor_id', label: 'Врач', required: true, 'data-source': '${data.doctors}' },
              { type: 'TextBody', text: '${data.error_message}' },
              {
                type: 'Footer',
                label: 'Показать свободное время',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    name: '${data.name}',
                    phone: '${data.phone}',
                    service: '${data.service}',
                    branch_id: '${data.branch_id}',
                    doctor_id: '${form.doctor_id}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'SLOT',
      title: 'Дата и время',
      terminal: false,
      success: false,
      data: {
        name: { type: 'string', __example__: 'Пациент' },
        phone: { type: 'string', __example__: '+77000000000' },
        service: { type: 'string', __example__: 'consultation' },
        branch_id: { type: 'string', __example__: 'branch-1' },
        doctor_id: { type: 'string', __example__: 'doctor-1' },
        slots: { ...optionArray, __example__: [{ id: '2026-08-10T09:00:00+05:00', title: '10.08, 09:00', description: 'пн · 30 мин' }] },
        has_slots: { type: 'boolean', __example__: true },
        error_message: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'slot_form',
            children: [
              { type: 'TextHeading', text: 'Свободное время' },
              { type: 'TextBody', text: 'Слоты обновляются из расписания клиники. Перед подтверждением IMDS повторно проверит доступность.' },
              { type: 'Dropdown', name: 'slot_id', label: 'Дата и время', required: true, 'data-source': '${data.slots}' },
              { type: 'TextInput', name: 'comment', label: 'Комментарий', required: false, 'input-type': 'text' },
              { type: 'TextBody', text: '${data.error_message}' },
              {
                type: 'Footer',
                label: 'Записаться',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    name: '${data.name}',
                    phone: '${data.phone}',
                    service: '${data.service}',
                    branch_id: '${data.branch_id}',
                    doctor_id: '${data.doctor_id}',
                    slot_id: '${form.slot_id}',
                    comment: '${form.comment}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'SUCCESS',
      title: 'Запись подтверждена',
      terminal: true,
      success: true,
      data: {
        summary: { type: 'string', __example__: 'Запись создана.' },
        lead_id: { type: 'string', __example__: '00000000-0000-0000-0000-000000000000' },
        appointment_id: { type: 'string', __example__: '00000000-0000-0000-0000-000000000000' },
        extension_message_response: {
          type: 'object',
          properties: {
            params: {
              type: 'object',
              properties: {
                flow_token: { type: 'string' },
                lead_id: { type: 'string' },
                appointment_id: { type: 'string' },
              },
            },
          },
          __example__: {
            params: {
              flow_token: 'example-token',
              lead_id: '00000000-0000-0000-0000-000000000000',
              appointment_id: '00000000-0000-0000-0000-000000000000',
            },
          },
        },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Готово' },
          { type: 'TextBody', text: '${data.summary}' },
          {
            type: 'Footer',
            label: 'Закрыть',
            'on-click-action': {
              name: 'complete',
              payload: {
                lead_id: '${data.lead_id}',
                appointment_id: '${data.appointment_id}',
              },
            },
          },
        ],
      },
    },
  ],
};

export const SERVICE_LABELS: Record<string, string> = {
  consultation: 'Консультация',
  diagnostics: 'Диагностика',
  repeat: 'Повторный приём',
  other: 'Другое',
};
