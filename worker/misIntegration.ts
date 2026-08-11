import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

type MisEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
};

type CredentialRow = {
  id?: string;
  company_id: string;
  encrypted_payload: string;
  iv: string;
  config_summary: JsonRecord;
  status: string;
  last_error?: string | null;
  last_verified_at?: string | null;
  updated_at: string;
};

type MisCredentials = {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader?: string;
  healthPath?: string;
  branchesPath?: string;
  doctorsPath?: string;
  schedulesPath?: string;
  patientsPath?: string;
  appointmentsPath?: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const rows = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(record) : Array.isArray(record(value).items) ? (record(value).items as unknown[]).map(record) : [];
const role = (request: Request) => request.headers.get('x-amanat-auth-role') || '';
const isAdmin = (request: Request) => role(request) === 'administrator';

function encryptionSecret(env: MisEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}
function bytesToBase64(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> { const binary = atob(value); const out = new Uint8Array(new ArrayBuffer(binary.length)); for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i); return out; }
async function cryptoKey(secret: string): Promise<CryptoKey> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)); return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
async function encrypt(payload: JsonRecord, secret: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await cryptoKey(secret); const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload))); return { encrypted_payload: bytesToBase64(new Uint8Array(data)), iv: bytesToBase64(iv) }; }
async function decrypt(row: CredentialRow, secret: string): Promise<JsonRecord> { const key = await cryptoKey(secret); const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(row.iv) }, key, base64ToBytes(row.encrypted_payload)); return record(JSON.parse(new TextDecoder().decode(data))); }

async function db<T>(env: MisEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...init.headers } });
  const body = await response.text();
  if (!response.ok) throw new Error(`MIS database ${response.status}: ${body.slice(0, 900)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function company(env: MisEnv): Promise<string> { return resolveCompanyId(env); }
async function credentialRow(env: MisEnv, companyId: string): Promise<CredentialRow | null> { const list = await db<CredentialRow[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.mis&select=*&limit=1`); return list[0] || null; }
async function credentials(env: MisEnv, companyId: string): Promise<MisCredentials | null> { const row = await credentialRow(env, companyId); if (!row) return null; return await decrypt(row, encryptionSecret(env)) as unknown as MisCredentials; }

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('MIS base URL должен использовать HTTPS');
  return url.toString().replace(/\/$/, '');
}
function publicCredential(row: CredentialRow | null) {
  if (!row) return { configured: false };
  const summary = record(row.config_summary);
  return { configured: true, status: row.status, values: record(summary.values), secretFields: record(summary.secretFields), lastVerifiedAt: row.last_verified_at || null, lastError: row.last_error || null, updatedAt: row.updated_at };
}

async function saveCredentials(request: Request, env: MisEnv, companyId: string) {
  if (!isAdmin(request)) return json({ error: 'Настройки МИС доступны только администратору' }, 403);
  const incoming = record(await request.json().catch(() => ({})));
  const existing = await credentialRow(env, companyId);
  let stored: JsonRecord = {};
  if (existing) { try { stored = await decrypt(existing, encryptionSecret(env)); } catch { stored = {}; } }
  const baseUrl = normalizeBaseUrl(text(incoming.baseUrl) || text(stored.baseUrl));
  const apiKey = text(incoming.apiKey) || text(stored.apiKey);
  if (!baseUrl || !apiKey) return json({ error: 'Заполните base URL и API key/token МИС' }, 400);
  const payload: JsonRecord = {
    baseUrl,
    apiKey,
    apiKeyHeader: text(incoming.apiKeyHeader) || text(stored.apiKeyHeader) || 'Authorization',
    healthPath: text(incoming.healthPath) || text(stored.healthPath) || '/health',
    branchesPath: text(incoming.branchesPath) || text(stored.branchesPath) || '/branches',
    doctorsPath: text(incoming.doctorsPath) || text(stored.doctorsPath) || '/doctors',
    schedulesPath: text(incoming.schedulesPath) || text(stored.schedulesPath) || '/schedules',
    patientsPath: text(incoming.patientsPath) || text(stored.patientsPath) || '/patients',
    appointmentsPath: text(incoming.appointmentsPath) || text(stored.appointmentsPath) || '/appointments',
  };
  const encrypted = await encrypt(payload, encryptionSecret(env));
  const summary = { values: { baseUrl, apiKeyHeader: payload.apiKeyHeader, healthPath: payload.healthPath }, secretFields: { apiKey: true } };
  const write = { provider: 'mis', company_id: companyId, user_id: null, ...encrypted, config_summary: summary, status: 'configured', last_error: null, updated_at: new Date().toISOString() };
  const result = existing?.id
    ? await db<CredentialRow[]>(env, `integration_credentials?id=eq.${encodeURIComponent(existing.id)}&company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(write) })
    : await db<CredentialRow[]>(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(write) });
  await ensureSettings(env, companyId);
  return json({ ok: true, credential: publicCredential(result[0]) });
}

async function ensureSettings(env: MisEnv, companyId: string) {
  await db(env, 'mis_settings?on_conflict=company_id', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ company_id: companyId }) });
}
async function readSettings(env: MisEnv, companyId: string): Promise<JsonRecord> { await ensureSettings(env, companyId); const list = await db<JsonRecord[]>(env, `mis_settings?company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`); return list[0] || {}; }

function authHeaders(config: MisCredentials): HeadersInit {
  const name = config.apiKeyHeader || 'Authorization';
  const value = name.toLowerCase() === 'authorization' && !/^bearer\s/i.test(config.apiKey) ? `Bearer ${config.apiKey}` : config.apiKey;
  return { accept: 'application/json', 'content-type': 'application/json', [name]: value };
}
function endpoint(config: MisCredentials, path: string): string { return `${config.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`; }
async function misFetch(config: MisCredentials, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(endpoint(config, path), { ...init, headers: { ...authHeaders(config), ...init.headers } });
  const raw = await response.text();
  let payload: unknown = null; try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) throw new Error(`MIS ${response.status}: ${typeof payload === 'string' ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`);
  return payload;
}

async function updateVerification(env: MisEnv, companyId: string, ok: boolean, error?: unknown) {
  await db(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.mis`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: ok ? 'connected' : 'error', last_verified_at: new Date().toISOString(), last_error: ok ? null : error instanceof Error ? error.message : String(error || 'MIS connection failed') }) });
}

async function mapping(env: MisEnv, companyId: string, type: string, externalId: string): Promise<JsonRecord | null> { const list = await db<JsonRecord[]>(env, `mis_entity_mappings?company_id=eq.${encodeURIComponent(companyId)}&entity_type=eq.${encodeURIComponent(type)}&external_id=eq.${encodeURIComponent(externalId)}&select=*&limit=1`); return list[0] || null; }
async function saveMapping(env: MisEnv, companyId: string, type: string, externalId: string, localId: string, metadata: JsonRecord = {}) { await db(env, 'mis_entity_mappings?on_conflict=company_id,entity_type,external_id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ company_id: companyId, entity_type: type, external_id: externalId, local_id: localId, metadata, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); }
async function localId(env: MisEnv, companyId: string, type: string, externalId: string): Promise<string | null> { const item = await mapping(env, companyId, type, externalId); return item ? text(item.local_id) || null : null; }

async function upsertOne(env: MisEnv, table: string, companyId: string, type: string, externalId: string, payload: JsonRecord): Promise<string> {
  const found = await localId(env, companyId, type, externalId);
  if (found) {
    const list = await db<JsonRecord[]>(env, `${table}?id=eq.${encodeURIComponent(found)}&company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }) });
    if (list[0]?.id) return text(list[0].id);
  }
  const list = await db<JsonRecord[]>(env, table, { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, ...payload }) });
  const id = text(list[0]?.id);
  if (!id) throw new Error(`MIS ${type}: local id not returned`);
  await saveMapping(env, companyId, type, externalId, id);
  return id;
}

function ext(item: JsonRecord): string { return text(item.id) || text(item.external_id) || text(item.externalId); }
function bool(value: unknown, fallback = true): boolean { return typeof value === 'boolean' ? value : value == null ? fallback : ['1','true','yes','y','да'].includes(String(value).toLowerCase()); }
function status(value: unknown): string { const raw = text(value).toUpperCase(); return ['BOOKED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'].includes(raw) ? raw : 'BOOKED'; }

async function syncBranches(env: MisEnv, companyId: string, config: MisCredentials, enabled: boolean) {
  if (!enabled) return 0; const list = rows(await misFetch(config, config.branchesPath || '/branches')); let count = 0;
  for (const item of list) { const id = ext(item); if (!id || !text(item.name)) continue; const local = await upsertOne(env, 'waba_clinic_branches', companyId, 'branch', id, { name: text(item.name), address: text(item.address) || null, active: bool(item.active), sort_order: Number(item.sort_order ?? item.sortOrder ?? 0) || 0 }); await saveMapping(env, companyId, 'branch', id, local, { vendor: 'generic_rest' }); count += 1; }
  return count;
}
async function syncDoctors(env: MisEnv, companyId: string, config: MisCredentials, enabled: boolean) {
  if (!enabled) return 0; const list = rows(await misFetch(config, config.doctorsPath || '/doctors')); let count = 0;
  for (const item of list) { const id = ext(item), branchExternal = text(item.branch_id ?? item.branchId); const branchId = branchExternal ? await localId(env, companyId, 'branch', branchExternal) : null; if (!id || !branchId || !text(item.name)) continue; const local = await upsertOne(env, 'waba_clinic_doctors', companyId, 'doctor', id, { branch_id: branchId, name: text(item.name), specialty: text(item.specialty) || null, active: bool(item.active), sort_order: Number(item.sort_order ?? item.sortOrder ?? 0) || 0 }); await saveMapping(env, companyId, 'doctor', id, local); count += 1; }
  return count;
}
async function syncSchedules(env: MisEnv, companyId: string, config: MisCredentials, enabled: boolean) {
  if (!enabled) return 0; const list = rows(await misFetch(config, config.schedulesPath || '/schedules')); let count = 0;
  for (const item of list) { const id = ext(item), doctorExternal = text(item.doctor_id ?? item.doctorId); const doctorId = doctorExternal ? await localId(env, companyId, 'doctor', doctorExternal) : null; const weekday = Number(item.weekday); if (!id || !doctorId || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue; const local = await upsertOne(env, 'waba_clinic_schedules', companyId, 'schedule', id, { doctor_id: doctorId, weekday, start_time: text(item.start_time ?? item.startTime), end_time: text(item.end_time ?? item.endTime), slot_minutes: Math.max(5, Math.min(240, Number(item.slot_minutes ?? item.slotMinutes ?? 30) || 30)), active: bool(item.active) }); await saveMapping(env, companyId, 'schedule', id, local); count += 1; }
  return count;
}
async function syncPatients(env: MisEnv, companyId: string, config: MisCredentials, enabled: boolean) {
  if (!enabled) return 0; const list = rows(await misFetch(config, config.patientsPath || '/patients')); let count = 0;
  for (const item of list) { const id = ext(item); if (!id || !text(item.name)) continue; const local = await upsertOne(env, 'clinic_patients', companyId, 'patient', id, { external_id: id, name: text(item.name), phone: text(item.phone), email: text(item.email) || null, source_system: 'mis', last_visit_at: text(item.last_visit_at ?? item.lastVisitAt) || null, next_visit_at: text(item.next_visit_at ?? item.nextVisitAt) || null, metadata: { mis: item } }); await saveMapping(env, companyId, 'patient', id, local); count += 1; }
  return count;
}
async function syncAppointments(env: MisEnv, companyId: string, config: MisCredentials, enabled: boolean) {
  if (!enabled) return 0; const list = rows(await misFetch(config, config.appointmentsPath || '/appointments')); let count = 0;
  await db(env, 'rpc/set_config', { method: 'POST', body: JSON.stringify({ setting: 'imds.mis_inbound', value: 'true', is_local: true }) }).catch(() => null);
  for (const item of list) {
    const id = ext(item), branchExternal = text(item.branch_id ?? item.branchId), doctorExternal = text(item.doctor_id ?? item.doctorId), patientExternal = text(item.patient_id ?? item.patientId);
    const branchId = await localId(env, companyId, 'branch', branchExternal), doctorId = await localId(env, companyId, 'doctor', doctorExternal), patientId = patientExternal ? await localId(env, companyId, 'patient', patientExternal) : null;
    const startsAt = text(item.starts_at ?? item.startsAt), endsAt = text(item.ends_at ?? item.endsAt);
    if (!id || !branchId || !doctorId || !startsAt || !endsAt) continue;
    const patient = patientId ? (await db<JsonRecord[]>(env, `clinic_patients?id=eq.${encodeURIComponent(patientId)}&company_id=eq.${encodeURIComponent(companyId)}&select=name,phone&limit=1`))[0] : null;
    const local = await upsertOne(env, 'waba_clinic_appointments', companyId, 'appointment', id, { branch_id: branchId, doctor_id: doctorId, patient_id: patientId, starts_at: startsAt, ends_at: endsAt, patient_name: text(item.patient_name ?? item.patientName) || text(patient?.name) || 'Пациент', phone: text(item.phone) || text(patient?.phone), status: status(item.status), source: 'MIS', metadata: { mis_external_id: id, mis: item } });
    await saveMapping(env, companyId, 'appointment', id, local); count += 1;
  }
  return count;
}

async function runPull(env: MisEnv, companyId: string) {
  const config = await credentials(env, companyId); if (!config) throw new Error('МИС credentials не настроены');
  const settings = await readSettings(env, companyId); if (settings.enabled !== true) return { skipped: true, reason: 'mis_disabled' };
  const created = await db<JsonRecord[]>(env, 'mis_sync_runs', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, vendor: text(settings.vendor) || 'generic_rest', mode: 'pull', status: 'running' }) });
  const runId = text(created[0]?.id);
  try {
    const counts = {
      branches: await syncBranches(env, companyId, config, settings.sync_branches !== false),
      doctors: await syncDoctors(env, companyId, config, settings.sync_doctors !== false),
      schedules: await syncSchedules(env, companyId, config, settings.sync_schedules !== false),
      patients: await syncPatients(env, companyId, config, settings.sync_patients !== false),
      appointments: await syncAppointments(env, companyId, config, settings.sync_appointments !== false),
    };
    const now = new Date().toISOString();
    await db(env, `mis_sync_runs?id=eq.${encodeURIComponent(runId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'success', counts, finished_at: now }) });
    await db(env, `mis_settings?company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ last_sync_at: now, last_success_at: now, last_error: null, updated_at: now }) });
    return { ok: true, counts };
  } catch (error) {
    const now = new Date().toISOString(); const message = error instanceof Error ? error.message : String(error);
    if (runId) await db(env, `mis_sync_runs?id=eq.${encodeURIComponent(runId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', error: message, finished_at: now }) }).catch(() => null);
    await db(env, `mis_settings?company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ last_sync_at: now, last_error: message, updated_at: now }) }).catch(() => null);
    throw error;
  }
}

async function pushOutbox(env: MisEnv, companyId: string) {
  const config = await credentials(env, companyId); if (!config) throw new Error('МИС credentials не настроены');
  const settings = await readSettings(env, companyId); if (settings.enabled !== true || settings.push_appointments !== true) return { skipped: true, reason: 'push_disabled' };
  const pending = await db<JsonRecord[]>(env, `mis_outbox?company_id=eq.${encodeURIComponent(companyId)}&status=eq.pending&available_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=created_at.asc&limit=50`);
  let sent = 0, failed = 0;
  for (const item of pending) {
    const outboxId = text(item.id), appointmentId = text(item.appointment_id);
    try {
      await db(env, `mis_outbox?id=eq.${encodeURIComponent(outboxId)}&company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'processing', attempts: Number(item.attempts || 0) + 1, updated_at: new Date().toISOString() }) });
      const appointment = (await db<JsonRecord[]>(env, `waba_clinic_appointments?id=eq.${encodeURIComponent(appointmentId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`))[0];
      if (!appointment) throw new Error('Appointment not found');
      const extAppointment = await mapping(env, companyId, 'appointment', appointmentId);
      const payload = { id: extAppointment ? text(extAppointment.external_id) : undefined, local_id: appointmentId, starts_at: appointment.starts_at, ends_at: appointment.ends_at, patient_name: appointment.patient_name, phone: appointment.phone, status: appointment.status };
      const method = text(item.action) === 'cancel' ? 'PATCH' : 'POST';
      await misFetch(config, config.appointmentsPath || '/appointments', { method, body: JSON.stringify(payload) });
      await db(env, `mis_outbox?id=eq.${encodeURIComponent(outboxId)}&company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }) }); sent += 1;
    } catch (error) {
      await db(env, `mis_outbox?id=eq.${encodeURIComponent(outboxId)}&company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }) }).catch(() => null); failed += 1;
    }
  }
  return { ok: failed === 0, sent, failed };
}

export async function handleMisIntegration(request: Request, env: MisEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/integrations/mis')) return null;
  const companyId = await company(env);
  if (url.pathname === '/api/integrations/mis/status' && request.method === 'GET') {
    const [credential, settings, runs, outbox] = await Promise.all([
      credentialRow(env, companyId), readSettings(env, companyId),
      db<JsonRecord[]>(env, `mis_sync_runs?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=started_at.desc&limit=10`),
      db<JsonRecord[]>(env, `mis_outbox?company_id=eq.${encodeURIComponent(companyId)}&select=status&limit=500`),
    ]);
    const queue = outbox.reduce<Record<string, number>>((acc, item) => { const key = text(item.status) || 'unknown'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    return json({ credential: publicCredential(credential), settings, runs, queue });
  }
  if (url.pathname === '/api/integrations/mis/config') {
    if (request.method === 'PUT') return saveCredentials(request, env, companyId);
    if (request.method === 'DELETE') { if (!isAdmin(request)) return json({ error: 'Только администратор' }, 403); await db(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.mis`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }); await db(env, `mis_settings?company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ enabled: false, last_error: null, updated_at: new Date().toISOString() }) }); return json({ ok: true }); }
  }
  if (url.pathname === '/api/integrations/mis/settings' && request.method === 'PUT') {
    if (!isAdmin(request)) return json({ error: 'Только администратор' }, 403); const body = record(await request.json().catch(() => ({}))); await ensureSettings(env, companyId);
    const allowed: JsonRecord = {}; for (const key of ['enabled','pull_enabled','push_appointments','sync_branches','sync_doctors','sync_schedules','sync_patients','sync_appointments']) if (typeof body[key] === 'boolean') allowed[key] = body[key];
    allowed.updated_at = new Date().toISOString(); const result = await db<JsonRecord[]>(env, `mis_settings?company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(allowed) }); return json({ ok: true, settings: result[0] });
  }
  if (url.pathname === '/api/integrations/mis/test' && request.method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Только администратор' }, 403); try { const config = await credentials(env, companyId); if (!config) throw new Error('МИС credentials не настроены'); const result = await misFetch(config, config.healthPath || '/health'); await updateVerification(env, companyId, true); return json({ ok: true, result }); } catch (error) { await updateVerification(env, companyId, false, error); return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }
  if (url.pathname === '/api/integrations/mis/sync' && request.method === 'POST') { if (!isAdmin(request)) return json({ error: 'Только администратор' }, 403); try { return json(await runPull(env, companyId)); } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); } }
  if (url.pathname === '/api/integrations/mis/push' && request.method === 'POST') { if (!isAdmin(request)) return json({ error: 'Только администратор' }, 403); try { return json(await pushOutbox(env, companyId)); } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); } }
  return json({ error: 'Method not allowed' }, 405);
}
