export const SHARED_ENTITY_TYPES = [
  'contact',
  'lead',
  'patient',
  'deal',
  'conversation',
  'appointment',
  'payment',
  'treatment_course',
] as const;

export type SharedEntityType = (typeof SHARED_ENTITY_TYPES)[number];

export interface SharedEntityIds {
  organization_id: string;
  branch_id?: string | null;
  contact_id?: string | null;
  lead_id?: string | null;
  patient_id?: string | null;
  deal_id?: string | null;
  conversation_id?: string | null;
  appointment_id?: string | null;
  payment_id?: string | null;
  treatment_course_id?: string | null;
}

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>
  extends SharedEntityIds {
  event_id: string;
  type: string;
  occurred_at: string;
  actor_type: 'user' | 'ai' | 'system' | 'integration' | 'patient';
  actor_id?: string | null;
  source_system: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export const SUPPORTED_MIS_EVENTS = [
  'lead.created',
  'lead.qualified',
  'lead.stage_changed',
  'appointment.created',
  'appointment.confirmed',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.no_show',
  'patient.arrived',
  'deal.created',
  'deal.won',
  'payment.created',
  'payment.completed',
  'payment.refunded',
  'treatment.started',
  'treatment.completed',
] as const;

export type SupportedMisEvent = (typeof SUPPORTED_MIS_EVENTS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function assertOrganizationId(value: unknown): asserts value is string {
  if (!isUuid(value)) throw new Error('organization_id must be a valid UUID');
}

export function parseDomainEvent(value: unknown): DomainEvent {
  if (!value || typeof value !== 'object') throw new Error('Event payload must be an object');
  const input = value as Record<string, unknown>;
  assertOrganizationId(input.organization_id);

  if (typeof input.event_id !== 'string' || !input.event_id.trim()) {
    throw new Error('event_id is required');
  }
  if (typeof input.type !== 'string' || !input.type.trim()) {
    throw new Error('type is required');
  }
  if (typeof input.occurred_at !== 'string' || Number.isNaN(Date.parse(input.occurred_at))) {
    throw new Error('occurred_at must be a valid ISO date');
  }
  if (!['user', 'ai', 'system', 'integration', 'patient'].includes(String(input.actor_type))) {
    throw new Error('actor_type is invalid');
  }
  if (typeof input.source_system !== 'string' || !input.source_system.trim()) {
    throw new Error('source_system is required');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new Error('payload must be an object');
  }

  const optionalIds = [
    'branch_id',
    'contact_id',
    'lead_id',
    'patient_id',
    'deal_id',
    'conversation_id',
    'appointment_id',
    'payment_id',
    'treatment_course_id',
  ];

  for (const key of optionalIds) {
    const candidate = input[key];
    if (candidate != null && !isUuid(candidate)) throw new Error(`${key} must be a valid UUID`);
  }

  return input as unknown as DomainEvent;
}
