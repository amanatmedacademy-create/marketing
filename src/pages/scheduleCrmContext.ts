export type ScheduleCrmContext = {
  contactId?: string;
  leadId?: string;
  dealId?: string;
  phone?: string;
  name?: string;
};

export type ScheduleCrmPatient = {
  id: string;
  name: string;
  phone?: string | null;
  crm_contact_id?: string | null;
};

export function normalizeSchedulePhone(value?: string | null): string {
  return String(value || '').replace(/\D/g, '');
}

export function matchScheduleCrmPatient<T extends ScheduleCrmPatient>(patients: T[], context?: ScheduleCrmContext): T | undefined {
  if (!context) return undefined;
  if (context.contactId) {
    const byContact = patients.find((patient) => patient.crm_contact_id === context.contactId);
    if (byContact) return byContact;
  }
  const phone = normalizeSchedulePhone(context.phone);
  if (!phone) return undefined;
  return patients.find((patient) => normalizeSchedulePhone(patient.phone) === phone);
}
