export type PlatformEventName =
  | 'lead.created'
  | 'lead.qualified'
  | 'contact.created'
  | 'conversation.started'
  | 'message.received'
  | 'message.sent'
  | 'ai.replied'
  | 'ai.paused'
  | 'manager.took_over'
  | 'deal.created'
  | 'deal.updated'
  | 'deal.stage_changed'
  | 'appointment.created'
  | 'appointment.completed'
  | 'payment.created'
  | 'payment.completed'
  | 'refund.created'
  | 'contract.created'
  | 'contract.signed'
  | 'ad_metrics.synced'
  | 'integration.connected'
  | 'integration.failed'
  | 'workflow.started'
  | 'workflow.completed';

export type PlatformEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  name: PlatformEventName;
  companyId: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  payload: TPayload;
};

export type EventDefinition = {
  name: PlatformEventName;
  domain: 'crm' | 'conversations' | 'ai' | 'marketing' | 'payments' | 'contracts' | 'integrations' | 'automation';
  description: string;
  analyticsRelevant: boolean;
  automationTrigger: boolean;
};

export const eventRegistry = [
  { name: 'lead.created', domain: 'crm', description: 'Создан новый лид.', analyticsRelevant: true, automationTrigger: true },
  { name: 'lead.qualified', domain: 'crm', description: 'Лид прошёл квалификацию.', analyticsRelevant: true, automationTrigger: true },
  { name: 'contact.created', domain: 'crm', description: 'Создан единый профиль клиента.', analyticsRelevant: true, automationTrigger: true },
  { name: 'conversation.started', domain: 'conversations', description: 'Начат новый диалог с клиентом.', analyticsRelevant: true, automationTrigger: true },
  { name: 'message.received', domain: 'conversations', description: 'Получено входящее сообщение.', analyticsRelevant: true, automationTrigger: true },
  { name: 'message.sent', domain: 'conversations', description: 'Отправлено исходящее сообщение.', analyticsRelevant: true, automationTrigger: false },
  { name: 'ai.replied', domain: 'ai', description: 'AI-агент отправил ответ клиенту.', analyticsRelevant: true, automationTrigger: false },
  { name: 'ai.paused', domain: 'ai', description: 'AI-агент поставлен на паузу.', analyticsRelevant: true, automationTrigger: true },
  { name: 'manager.took_over', domain: 'ai', description: 'Менеджер перехватил диалог у AI.', analyticsRelevant: true, automationTrigger: true },
  { name: 'deal.created', domain: 'crm', description: 'Создана новая сделка.', analyticsRelevant: true, automationTrigger: true },
  { name: 'deal.updated', domain: 'crm', description: 'Обновлены данные сделки.', analyticsRelevant: true, automationTrigger: false },
  { name: 'deal.stage_changed', domain: 'crm', description: 'Сделка перемещена на другой этап.', analyticsRelevant: true, automationTrigger: true },
  { name: 'appointment.created', domain: 'crm', description: 'Создана запись или встреча.', analyticsRelevant: true, automationTrigger: true },
  { name: 'appointment.completed', domain: 'crm', description: 'Встреча или визит состоялись.', analyticsRelevant: true, automationTrigger: true },
  { name: 'payment.created', domain: 'payments', description: 'Создан счёт или платёжное намерение.', analyticsRelevant: true, automationTrigger: true },
  { name: 'payment.completed', domain: 'payments', description: 'Оплата успешно подтверждена.', analyticsRelevant: true, automationTrigger: true },
  { name: 'refund.created', domain: 'payments', description: 'Оформлен возврат.', analyticsRelevant: true, automationTrigger: true },
  { name: 'contract.created', domain: 'contracts', description: 'Создан документ или договор.', analyticsRelevant: false, automationTrigger: true },
  { name: 'contract.signed', domain: 'contracts', description: 'Документ подписан.', analyticsRelevant: true, automationTrigger: true },
  { name: 'ad_metrics.synced', domain: 'marketing', description: 'Синхронизированы рекламные метрики.', analyticsRelevant: true, automationTrigger: true },
  { name: 'integration.connected', domain: 'integrations', description: 'Интеграция успешно подключена.', analyticsRelevant: false, automationTrigger: true },
  { name: 'integration.failed', domain: 'integrations', description: 'Интеграция завершилась ошибкой.', analyticsRelevant: false, automationTrigger: true },
  { name: 'workflow.started', domain: 'automation', description: 'Запущен сценарий автоматизации.', analyticsRelevant: false, automationTrigger: false },
  { name: 'workflow.completed', domain: 'automation', description: 'Сценарий автоматизации завершён.', analyticsRelevant: false, automationTrigger: false },
] as const satisfies readonly EventDefinition[];

export const eventByName = Object.fromEntries(eventRegistry.map((event) => [event.name, event])) as Record<PlatformEventName, EventDefinition>;
