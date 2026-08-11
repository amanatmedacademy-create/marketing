type Row = Record<string, unknown>;

export interface ClinicScreenResponseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const accepted = (value: unknown): boolean => value === true || ['true', '1', 'yes', 'on'].includes(text(value).toLowerCase());
const phoneDigits = (value: unknown): string => text(value).replace(/\D/g, '');

function headers(env: ClinicScreenResponseEnv): Headers {
  const value = new Headers();
  value.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  value.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  value.set('accept', 'application/json');
  return value;
}

async function db<T>(env: ClinicScreenResponseEnv, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, {
    headers: headers(env),
    cache: 'no-store',
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${raw.slice(0, 1200)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function option(id: string, title: string, description?: string, enabled = true): Row {
  return { id, title, ...(description ? { description } : {}), ...(enabled ? {} : { enabled: false }) };
}

function serviceOptions(): Row[] {
  return [
    option('consultation', 'Консультация'),
    option('diagnostics', 'Диагностика'),
    option('repeat', 'Повторный приём'),
    option('other', 'Другое'),
  ];
}

function localDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function dateTitle(date: string): string {
  return new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', weekday: 'short', day: '2-digit', month: 'short' })
    .format(new Date(`${date}T12:00:00+05:00`));
}

function timeTitle(iso: string): string {
  return new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function timeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number);
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00+05:00`).getUTCDay();
}

function isoAt(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`;
}

function overlaps(start: Date, end: Date, row: Row): boolean {
  const rowStart = new Date(text(row.starts_at));
  const rowEnd = new Date(text(row.ends_at));
  if (!Number.isFinite(rowStart.getTime()) || !Number.isFinite(rowEnd.getTime())) return false;
  return start < rowEnd && end > rowStart;
}

function overlapsScheduleBreak(startMinute: number, endMinute: number, schedule: Row): boolean {
  const rawStart = text(schedule.break_start);
  const rawEnd = text(schedule.break_end);
  if (!rawStart || !rawEnd) return false;
  const breakStart = timeParts(rawStart);
  const breakEnd = timeParts(rawEnd);
  const breakStartMinute = breakStart.hour * 60 + breakStart.minute;
  const breakEndMinute = breakEnd.hour * 60 + breakEnd.minute;
  return startMinute < breakEndMinute && endMinute > breakStartMinute;
}

async function branches(env: ClinicScreenResponseEnv, companyId: string): Promise<Row[]> {
  return db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,name,address&order=sort_order.asc,name.asc`);
}

async function doctors(env: ClinicScreenResponseEnv, companyId: string, branchId: string): Promise<Row[]> {
  if (!branchId) return [];
  return db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&active=eq.true&select=id,name,specialty&order=sort_order.asc,name.asc`);
}

async function slots(env: ClinicScreenResponseEnv, companyId: string, doctorId: string): Promise<Array<{ id: string; date: string; title: string; enabled: boolean }>> {
  if (!doctorId) return [];
  const schedules = await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&active=eq.true&select=weekday,start_time,end_time,break_start,break_end,slot_minutes&order=weekday.asc,start_time.asc`);
  if (!schedules.length) return [];

  const now = new Date();
  const today = localDate(now.toISOString());
  const base = new Date(`${today}T12:00:00Z`);
  const dates = Array.from({ length: 21 }, (_, index) => {
    const value = new Date(base);
    value.setUTCDate(value.getUTCDate() + index);
    return value.toISOString().slice(0, 10);
  });
  const rangeStart = `${dates[0]}T00:00:00+05:00`;
  const rangeEnd = `${dates[dates.length - 1]}T23:59:59+05:00`;
  const [booked, blocks] = await Promise.all([
    db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&status=in.(BOOKED,CONFIRMED,ARRIVED)&starts_at=lt.${encodeURIComponent(rangeEnd)}&ends_at=gt.${encodeURIComponent(rangeStart)}&select=starts_at,ends_at`),
    db<Row[]>(env, `waba_clinic_schedule_blocks?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&starts_at=lt.${encodeURIComponent(rangeEnd)}&ends_at=gt.${encodeURIComponent(rangeStart)}&select=starts_at,ends_at`).catch(() => []),
  ]);
  const output: Array<{ id: string; date: string; title: string; enabled: boolean }> = [];

  for (const date of dates) {
    for (const schedule of schedules.filter((item) => Number(item.weekday) === weekday(date))) {
      const start = timeParts(text(schedule.start_time));
      const end = timeParts(text(schedule.end_time));
      const duration = Math.max(5, Number(schedule.slot_minutes) || 30);
      let cursor = start.hour * 60 + start.minute;
      const endMinutes = end.hour * 60 + end.minute;
      while (cursor + duration <= endMinutes) {
        const id = isoAt(date, Math.floor(cursor / 60), cursor % 60);
        const instant = new Date(id);
        const slotEnd = new Date(instant.getTime() + duration * 60_000);
        const occupied = booked.some((row) => overlaps(instant, slotEnd, row));
        const blocked = blocks.some((row) => overlaps(instant, slotEnd, row));
        const onBreak = overlapsScheduleBreak(cursor, cursor + duration, schedule);
        if (instant.getTime() > now.getTime() + 15 * 60 * 1000 && !occupied && !blocked && !onBreak) {
          output.push({ id, date, title: timeTitle(id), enabled: true });
          if (output.length >= 80) return output;
        }
        cursor += duration;
      }
    }
  }
  return output;
}

function availabilityError(trigger: string, service: string, branchId: string, doctorId: string, selectedDate: string, branchCount: number, doctorCount: number, dateCount: number, timeCount: number): string {
  if (trigger === 'service_selected' && service && !branchCount) return 'Для записи пока нет активных филиалов.';
  if (trigger === 'branch_selected' && branchId && !doctorCount) return 'В выбранном филиале пока нет доступных врачей.';
  if (trigger === 'doctor_selected' && doctorId && !dateCount) return 'У выбранного врача нет свободных слотов на ближайшие 21 день.';
  if (trigger === 'date_selected' && selectedDate && !timeCount) return 'На эту дату свободного времени нет.';
  return '';
}

async function appointmentScreen(env: ClinicScreenResponseEnv, companyId: string, data: Row): Promise<Row> {
  const trigger = text(data.trigger);
  const service = text(data.service);
  const branchId = text(data.branch);
  const doctorId = text(data.doctor);
  const selectedDate = text(data.date);
  const branchRows = await branches(env, companyId);
  const doctorRows = branchId ? await doctors(env, companyId, branchId) : [];
  const slotRows = doctorId ? await slots(env, companyId, doctorId) : [];
  const dates = [...new Set(slotRows.map((item) => item.date))];
  const times = selectedDate ? slotRows.filter((item) => item.date === selectedDate) : [];

  return {
    screen: 'APPOINTMENT',
    data: {
      service: serviceOptions(),
      branch: branchRows.map((row) => option(text(row.id), text(row.name), text(row.address) || undefined)),
      is_branch_enabled: Boolean(service && branchRows.length),
      doctor: doctorRows.map((row) => option(text(row.id), text(row.name), text(row.specialty) || undefined)),
      is_doctor_enabled: Boolean(service && branchId && doctorRows.length),
      date: dates.map((value) => option(value, dateTitle(value))),
      is_date_enabled: Boolean(service && branchId && doctorId && dates.length),
      time: times.map((item) => option(item.id, item.title, undefined, item.enabled)),
      is_time_enabled: Boolean(service && branchId && doctorId && selectedDate && times.length),
      error_message: availabilityError(trigger, service, branchId, doctorId, selectedDate, branchRows.length, doctorRows.length, dates.length, times.length),
    },
  };
}

async function summaryScreen(env: ClinicScreenResponseEnv, companyId: string, data: Row): Promise<Row> {
  const branchId = text(data.branch);
  const doctorId = text(data.doctor);
  const [branchRows, doctorRows] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?id=eq.${encodeURIComponent(branchId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,name,address&limit=1`),
    db<Row[]>(env, `waba_clinic_doctors?id=eq.${encodeURIComponent(doctorId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,name,specialty&limit=1`),
  ]);
  const branch = branchRows[0] || {};
  const doctor = doctorRows[0] || {};
  const when = text(data.time) ? new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(text(data.time))) : text(data.date);
  return {
    screen: 'SUMMARY',
    data: {
      appointment: `${text(branch.name) || 'Филиал'}${text(branch.address) ? ` · ${text(branch.address)}` : ''}\n${text(doctor.name) || 'Врач'}${text(doctor.specialty) ? ` · ${text(doctor.specialty)}` : ''}\n${when}`,
      details: `Имя: ${text(data.name)}\nТелефон: ${text(data.phone)}${text(data.comment) ? `\nКомментарий: ${text(data.comment)}` : ''}`,
      service: text(data.service),
      branch: branchId,
      doctor: doctorId,
      date: text(data.date),
      time: text(data.time),
      name: text(data.name),
      phone: text(data.phone),
      comment: text(data.comment),
      error_message: '',
    },
  };
}

export async function handleClinicScreenResponse(env: ClinicScreenResponseEnv, companyId: string, body: Row): Promise<Row | null> {
  const action = text(body.action).toLowerCase();
  const screen = text(body.screen).toUpperCase();
  const data = record(body.data);

  if (data.error) {
    console.warn('WhatsApp Flow client error', { companyId, screen, error: data.error });
    return { data: { acknowledged: true } };
  }

  if (action === 'init') return appointmentScreen(env, companyId, data);
  if (action !== 'data_exchange') return null;

  if (screen === 'APPOINTMENT') return appointmentScreen(env, companyId, data);
  if (screen === 'DETAILS') {
    if (!text(data.name) || !text(data.phone) || !text(data.service) || !text(data.branch) || !text(data.doctor) || !text(data.time)) {
      return { screen: 'DETAILS', data: { ...data, error_message: 'Заполните обязательные поля и выберите время записи.' } };
    }
    if (phoneDigits(data.phone).length < 10) {
      return { screen: 'DETAILS', data: { ...data, error_message: 'Проверьте номер телефона пациента.' } };
    }
    return summaryScreen(env, companyId, data);
  }
  if (screen === 'SUMMARY' && !accepted(data.terms)) {
    return { screen: 'SUMMARY', data: { ...data, error_message: 'Подтвердите согласие на обработку данных для создания записи.' } };
  }
  return null;
}

export function normalizeClinicBookingData(data: Row): Row {
  return {
    ...data,
    branch_id: text(data.branch_id) || text(data.branch),
    doctor_id: text(data.doctor_id) || text(data.doctor),
    slot_id: text(data.slot_id) || text(data.time),
  };
}
