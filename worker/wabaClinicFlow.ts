type Row = Record<string, unknown>;

export const CLINIC_FLOW_NAME = 'IMDS Clinic Appointment';
export const CLINIC_FLOW_CATEGORY = ['APPOINTMENT_BOOKING', 'LEAD_GENERATION'];

export const CLINIC_FLOW_JSON: Row = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    APPOINTMENT: ['SUCCESS'],
    SUCCESS: [],
  },
  screens: [
    {
      id: 'APPOINTMENT',
      title: 'Запись в клинику',
      terminal: false,
      success: false,
      data: {},
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'appointment_form',
            children: [
              {
                type: 'TextHeading',
                text: 'Оставьте заявку на запись',
              },
              {
                type: 'TextBody',
                text: 'Выберите удобные параметры. Администратор клиники подтвердит точную дату и время после получения заявки.',
              },
              {
                type: 'TextInput',
                name: 'name',
                label: 'Имя',
                required: true,
                'input-type': 'text',
              },
              {
                type: 'TextInput',
                name: 'phone',
                label: 'Телефон',
                required: true,
                'input-type': 'phone',
              },
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
              {
                type: 'TextInput',
                name: 'preferred_date',
                label: 'Желаемая дата',
                required: true,
                'input-type': 'text',
                'helper-text': 'Например: 12 августа',
              },
              {
                type: 'Dropdown',
                name: 'preferred_time',
                label: 'Удобное время',
                required: true,
                'data-source': [
                  { id: 'morning', title: 'Утро · 09:00–12:00' },
                  { id: 'day', title: 'День · 12:00–17:00' },
                  { id: 'evening', title: 'Вечер · 17:00–20:00' },
                ],
              },
              {
                type: 'TextInput',
                name: 'comment',
                label: 'Комментарий',
                required: false,
                'input-type': 'text',
              },
              {
                type: 'Footer',
                label: 'Отправить заявку',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    name: '${form.name}',
                    phone: '${form.phone}',
                    service: '${form.service}',
                    preferred_date: '${form.preferred_date}',
                    preferred_time: '${form.preferred_time}',
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
      title: 'Заявка принята',
      terminal: true,
      success: true,
      data: {
        summary: {
          type: 'string',
          __example__: 'Администратор свяжется с вами для подтверждения записи.',
        },
        lead_id: {
          type: 'string',
          __example__: '00000000-0000-0000-0000-000000000000',
        },
        extension_message_response: {
          type: 'object',
          properties: {
            params: {
              type: 'object',
              properties: {
                flow_token: { type: 'string' },
                lead_id: { type: 'string' },
              },
            },
          },
          __example__: {
            params: {
              flow_token: 'example-token',
              lead_id: '00000000-0000-0000-0000-000000000000',
            },
          },
        },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'TextHeading',
            text: 'Спасибо',
          },
          {
            type: 'TextBody',
            text: '${data.summary}',
          },
          {
            type: 'Footer',
            label: 'Готово',
            'on-click-action': {
              name: 'complete',
              payload: {
                lead_id: '${data.lead_id}',
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

export const TIME_LABELS: Record<string, string> = {
  morning: 'Утро · 09:00–12:00',
  day: 'День · 12:00–17:00',
  evening: 'Вечер · 17:00–20:00',
};
