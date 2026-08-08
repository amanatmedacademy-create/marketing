type Row = Record<string, unknown>;

export const CLINIC_FLOW_NAME = 'IMDS Clinic Appointment';
export const CLINIC_FLOW_CATEGORY = ['APPOINTMENT_BOOKING', 'LEAD_GENERATION'];
export const CLINIC_FLOW_SCHEMA_VERSION = 3;

const optionArray = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  },
};

const stringData = (example: string) => ({ type: 'string', __example__: example });
const booleanData = (example: boolean) => ({ type: 'boolean', __example__: example });

export const CLINIC_FLOW_JSON: Row = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    APPOINTMENT: ['DETAILS'],
    DETAILS: ['SUMMARY'],
    SUMMARY: ['TERMS'],
    TERMS: [],
  },
  screens: [
    {
      id: 'APPOINTMENT',
      title: 'Запись в клинику',
      data: {
        service: {
          ...optionArray,
          __example__: [
            { id: 'consultation', title: 'Консультация' },
            { id: 'diagnostics', title: 'Диагностика' },
          ],
        },
        branch: {
          ...optionArray,
          __example__: [{ id: 'branch-1', title: 'Филиал', description: 'Адрес' }],
        },
        is_branch_enabled: booleanData(true),
        doctor: {
          ...optionArray,
          __example__: [{ id: 'doctor-1', title: 'Врач', description: 'Специализация' }],
        },
        is_doctor_enabled: booleanData(true),
        date: {
          ...optionArray,
          __example__: [{ id: '2026-08-10', title: 'пн, 10 авг.' }],
        },
        is_date_enabled: booleanData(true),
        time: {
          ...optionArray,
          __example__: [{ id: '2026-08-10T09:00:00+05:00', title: '09:00' }],
        },
        is_time_enabled: booleanData(true),
        error_message: stringData(''),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'appointment_form',
            children: [
              { type: 'TextHeading', text: 'Подберите удобное время' },
              { type: 'TextBody', text: 'IMDS показывает только доступные филиалы, врачей и свободные слоты из расписания клиники.' },
              {
                type: 'Dropdown',
                label: 'Услуга',
                name: 'service',
                'data-source': '${data.service}',
                required: true,
                'on-select-action': {
                  name: 'data_exchange',
                  payload: {
                    trigger: 'service_selected',
                    service: '${form.service}',
                  },
                },
              },
              {
                type: 'Dropdown',
                label: 'Филиал',
                name: 'branch',
                'data-source': '${data.branch}',
                required: '${data.is_branch_enabled}',
                enabled: '${data.is_branch_enabled}',
                'on-select-action': {
                  name: 'data_exchange',
                  payload: {
                    trigger: 'branch_selected',
                    service: '${form.service}',
                    branch: '${form.branch}',
                  },
                },
              },
              {
                type: 'Dropdown',
                label: 'Врач',
                name: 'doctor',
                'data-source': '${data.doctor}',
                required: '${data.is_doctor_enabled}',
                enabled: '${data.is_doctor_enabled}',
                'on-select-action': {
                  name: 'data_exchange',
                  payload: {
                    trigger: 'doctor_selected',
                    service: '${form.service}',
                    branch: '${form.branch}',
                    doctor: '${form.doctor}',
                  },
                },
              },
              {
                type: 'Dropdown',
                label: 'Дата',
                name: 'date',
                'data-source': '${data.date}',
                required: '${data.is_date_enabled}',
                enabled: '${data.is_date_enabled}',
                'on-select-action': {
                  name: 'data_exchange',
                  payload: {
                    trigger: 'date_selected',
                    service: '${form.service}',
                    branch: '${form.branch}',
                    doctor: '${form.doctor}',
                    date: '${form.date}',
                  },
                },
              },
              {
                type: 'Dropdown',
                label: 'Время',
                name: 'time',
                'data-source': '${data.time}',
                required: '${data.is_time_enabled}',
                enabled: '${data.is_time_enabled}',
              },
              { type: 'TextBody', text: '${data.error_message}' },
              {
                type: 'Footer',
                label: 'Продолжить',
                'on-click-action': {
                  name: 'navigate',
                  next: { type: 'screen', name: 'DETAILS' },
                  payload: {
                    service: '${form.service}',
                    branch: '${form.branch}',
                    doctor: '${form.doctor}',
                    date: '${form.date}',
                    time: '${form.time}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'DETAILS',
      title: 'Данные пациента',
      data: {
        service: stringData('consultation'),
        branch: stringData('branch-1'),
        doctor: stringData('doctor-1'),
        date: stringData('2026-08-10'),
        time: stringData('2026-08-10T09:00:00+05:00'),
        error_message: stringData(''),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'details_form',
            children: [
              { type: 'TextInput', label: 'Имя', name: 'name', required: true },
              { type: 'TextInput', label: 'Телефон', name: 'phone', 'input-type': 'phone', required: true },
              { type: 'TextArea', label: 'Комментарий', name: 'comment', 'helper-text': 'Причина обращения или дополнительная информация', required: false },
              { type: 'TextBody', text: '${data.error_message}' },
              {
                type: 'Footer',
                label: 'Проверить запись',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    service: '${data.service}',
                    branch: '${data.branch}',
                    doctor: '${data.doctor}',
                    date: '${data.date}',
                    time: '${data.time}',
                    name: '${form.name}',
                    phone: '${form.phone}',
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
      id: 'SUMMARY',
      title: 'Подтверждение',
      terminal: true,
      data: {
        appointment: stringData('Филиал · Врач\n10 августа 2026, 09:00'),
        details: stringData('Имя: Пациент\nТелефон: +77000000000'),
        service: stringData('consultation'),
        branch: stringData('branch-1'),
        doctor: stringData('doctor-1'),
        date: stringData('2026-08-10'),
        time: stringData('2026-08-10T09:00:00+05:00'),
        name: stringData('Пациент'),
        phone: stringData('+77000000000'),
        comment: stringData(''),
        error_message: stringData(''),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'confirmation_form',
            children: [
              { type: 'TextHeading', text: 'Запись' },
              { type: 'TextBody', text: '${data.appointment}' },
              { type: 'TextHeading', text: 'Пациент' },
              { type: 'TextBody', text: '${data.details}' },
              { type: 'TextBody', text: '${data.error_message}' },
              {
                type: 'OptIn',
                name: 'terms',
                label: 'Я подтверждаю данные и согласен на их обработку для организации записи',
                required: true,
                'on-click-action': {
                  name: 'navigate',
                  next: { type: 'screen', name: 'TERMS' },
                  payload: {},
                },
              },
              {
                type: 'Footer',
                label: 'Подтвердить запись',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    service: '${data.service}',
                    branch: '${data.branch}',
                    doctor: '${data.doctor}',
                    date: '${data.date}',
                    time: '${data.time}',
                    name: '${data.name}',
                    phone: '${data.phone}',
                    comment: '${data.comment}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'TERMS',
      title: 'Условия',
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Обработка данных' },
          { type: 'TextBody', text: 'Данные из этой формы используются клиникой для обработки заявки, подтверждения записи и связи с пациентом. Доступ к данным предоставляется только уполномоченным сотрудникам в рамках рабочего процесса IMDS.' },
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
