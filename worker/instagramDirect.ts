import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;

type InstagramCandidate = {
  instagramAccountId: string;
  username: string;
  name: string;
  pageId: string;
  pageName: string;
  pageAccessToken: string;
};

type InstagramCredential = InstagramCandidate & {
  companyId: string;
  graphVersion: string;
};

export interface InstagramDirectEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  INSTAGRAM_OAUTH_REDIRECT_URI?: string;
  INSTAGRAM_OAUTH_SCOPES?: string;
  INSTAGRAM_SUBSCRIBED_FIELDS?: string;
}

const PROVIDER = 'instagram';
const STATE_COOKIE = 'imds_instagram_oauth_state';
const DEFAULT_REDIRECT_URI = 'https://marketing.amanat-med-academy.workers.dev/api/integrations/instagram/callback';
const DEFAULT_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_metadata,instagram_basic,instagram_manage_messages';
const DEFAULT_SUBSCRIBED_FIELDS = 'messages,messaging_postbacks,message_reactions,messaging_seen';
const OAUTH_TTL_MS = 10 * 60 * 1000;

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number(value || 0) || 0;
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function graphVersion(value?: string): string {
  const version = text(value) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
}

function appOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function integrationRedirect(request: Request, params: Record<string, string>): Response {
  const url = new URL('/integrations', appOrigin(request));
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
}

function dbHeaders(env: InstagramDirectEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: InstagramDirectEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = dbHeaders(env, init.headers);
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Instagram Supabase ${response.status}: ${body.slice(0, 1800)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return base64ToBytes(padded);
}

async function hmac(secret: string, value: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
}

async function signedState(state: string, companyId: string, userId: string, secret: string): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ state, companyId, userId, issuedAt: Date.now() })));
  return `${payload}.${base64Url(new Uint8Array(await hmac(secret, payload)))}`;
}

async function verifyState(cookieValue: string, expectedState: string, secret: string): Promise<{ companyId: string; userId: string } | null> {
  const [payload, signature] = decodeURIComponent(cookieValue || '').split('.');
  if (!payload || !signature) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, base64UrlBytes(signature), new TextEncoder().encode(payload));
  if (!valid) return null;
  let state: Row = {};
  try { state = record(JSON.parse(new TextDecoder().decode(base64UrlBytes(payload)))); } catch { return null; }
  const issuedAt = number(state.issuedAt);
  if (!issuedAt || Date.now() - issuedAt > OAUTH_TTL_MS) return null;
  if (!secureEqual(text(state.state), expectedState)) return null;
  const companyId = text(state.companyId);
  const userId = text(state.userId);
  return companyId && userId ? { companyId, userId } : null;
}

function cookie(request: Request, name: string): string {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function encryptionSecret(env: InstagramDirectEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

async function encryptionKey(env: InstagramDirectEnv): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret(env)));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(env: InstagramDirectEnv, payload: Row): Promise<{ encryptedPayload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptPayload(env: InstagramDirectEnv, row: Row): Promise<Row> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(text(row.iv)) },
    await encryptionKey(env),
    base64ToBytes(text(row.encrypted_payload)),
  );
  return record(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function graphJson(url: string, accessToken?: string, init: RequestInit = {}): Promise<Row> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const body = await response.text();
  let payload: Row = {};
  try { payload = record(body ? JSON.parse(body) : {}); } catch { payload = { raw: body }; }
  if (!response.ok || payload.error) throw new Error(`Meta Graph ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
  return payload;
}

async function credentialRow(env: InstagramDirectEnv, companyId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${PROVIDER}&select=*&limit=1`);
  return rows[0] || null;
}

async function writeCredential(
  env: InstagramDirectEnv,
  companyId: string,
  payload: Row,
  status: string,
  summary: Row,
  error: string | null = null,
): Promise<void> {
  const current = await credentialRow(env, companyId);
  const encrypted = await encryptPayload(env, payload);
  const row = {
    company_id: companyId,
    user_id: null,
    provider: PROVIDER,
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: summary,
    status,
    last_error: error,
    last_verified_at: status === 'connected' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (current?.id) {
    await db<Row[]>(env, `integration_credentials?id=eq.${encodeURIComponent(text(current.id))}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, { method: 'PATCH', body: JSON.stringify(row) });
  } else {
    await db<Row[]>(env, 'integration_credentials?select=id', { method: 'POST', body: JSON.stringify(row) });
  }
}

async function deleteCredential(env: InstagramDirectEnv, companyId: string): Promise<void> {
  await db<unknown>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${PROVIDER}`, {
    method: 'DELETE', headers: { prefer: 'return=minimal' },
  });
}

async function connectedCredential(env: InstagramDirectEnv, companyId: string): Promise<InstagramCredential> {
  const row = await credentialRow(env, companyId);
  if (!row || text(row.status) !== 'connected') throw new Error('Instagram Direct для клиники не подключён');
  const payload = await decryptPayload(env, row);
  const instagramAccountId = text(payload.instagramAccountId);
  const pageAccessToken = text(payload.pageAccessToken);
  const pageId = text(payload.pageId);
  if (!instagramAccountId || !pageAccessToken || !pageId) throw new Error('Instagram credential повреждён');
  return {
    companyId,
    instagramAccountId,
    pageAccessToken,
    pageId,
    pageName: text(payload.pageName),
    username: text(payload.username),
    name: text(payload.name),
    graphVersion: graphVersion(text(payload.graphVersion) || env.META_GRAPH_VERSION),
  };
}

async function findCredentialByInstagramAccount(env: InstagramDirectEnv, accountId: string): Promise<InstagramCredential | null> {
  const rows = await db<Row[]>(env, `integration_credentials?user_id=is.null&provider=eq.${PROVIDER}&status=eq.connected&select=company_id,encrypted_payload,iv&limit=500`);
  for (const row of rows) {
    try {
      const payload = await decryptPayload(env, row);
      if (text(payload.instagramAccountId) !== accountId) continue;
      return {
        companyId: text(row.company_id),
        instagramAccountId: accountId,
        pageAccessToken: text(payload.pageAccessToken),
        pageId: text(payload.pageId),
        pageName: text(payload.pageName),
        username: text(payload.username),
        name: text(payload.name),
        graphVersion: graphVersion(text(payload.graphVersion) || env.META_GRAPH_VERSION),
      };
    } catch (error) {
      console.error('Unable to decrypt Instagram credential', error);
    }
  }
  return null;
}

async function subscribePage(env: InstagramDirectEnv, candidate: InstagramCandidate, version: string): Promise<void> {
  const fields = text(env.INSTAGRAM_SUBSCRIBED_FIELDS) || DEFAULT_SUBSCRIBED_FIELDS;
  const body = new URLSearchParams({ subscribed_fields: fields });
  await graphJson(`https://graph.facebook.com/${version}/${encodeURIComponent(candidate.pageId)}/subscribed_apps`, candidate.pageAccessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

async function finalizeCandidate(env: InstagramDirectEnv, companyId: string, candidate: InstagramCandidate): Promise<{ subscribed: boolean; warning?: string }> {
  const version = graphVersion(env.META_GRAPH_VERSION);
  let subscribed = false;
  let warning = '';
  try {
    await subscribePage(env, candidate, version);
    subscribed = true;
  } catch (error) {
    warning = error instanceof Error ? error.message : String(error);
    console.error('Instagram webhook subscription failed', error);
  }
  await writeCredential(env, companyId, { ...candidate, graphVersion: version }, 'connected', {
    values: {
      instagramAccountId: candidate.instagramAccountId,
      username: candidate.username,
      name: candidate.name,
      pageId: candidate.pageId,
      pageName: candidate.pageName,
      webhookSubscription: subscribed ? 'automatic' : 'manual_required',
    },
    secretFields: { pageAccessToken: true },
  });
  return { subscribed, ...(warning ? { warning } : {}) };
}

async function startOAuth(request: Request, env: InstagramDirectEnv): Promise<Response> {
  const appId = text(env.META_APP_ID);
  const appSecret = text(env.META_APP_SECRET);
  if (!appId || !appSecret) return json({ error: 'META_APP_ID или META_APP_SECRET не настроены' }, 503);
  const companyId = text(env.CURRENT_COMPANY_ID);
  const userId = text(request.headers.get('x-amanat-auth-user'));
  if (!companyId || !userId) return json({ error: 'Выберите клинику для Instagram Direct' }, 409);
  await resolveCompanyId(env, userId);
  const state = crypto.randomUUID().replace(/-/g, '');
  const redirectUri = text(env.INSTAGRAM_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: text(env.INSTAGRAM_OAUTH_SCOPES) || DEFAULT_SCOPES,
  });
  return json({
    ok: true,
    authorizationUrl: `https://www.facebook.com/${graphVersion(env.META_GRAPH_VERSION)}/dialog/oauth?${params}`,
    redirectUri,
  }, 200, {
    'set-cookie': `${STATE_COOKIE}=${encodeURIComponent(await signedState(state, companyId, userId, appSecret))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
}

async function exchangeCode(env: InstagramDirectEnv, code: string, redirectUri: string): Promise<string> {
  const version = graphVersion(env.META_GRAPH_VERSION);
  const params = new URLSearchParams({
    client_id: text(env.META_APP_ID),
    client_secret: text(env.META_APP_SECRET),
    redirect_uri: redirectUri,
    code,
  });
  const initial = await graphJson(`https://graph.facebook.com/${version}/oauth/access_token?${params}`);
  const shortToken = text(initial.access_token);
  if (!shortToken) throw new Error('Meta не вернула access token');
  try {
    const longParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: text(env.META_APP_ID),
      client_secret: text(env.META_APP_SECRET),
      fb_exchange_token: shortToken,
    });
    const long = await graphJson(`https://graph.facebook.com/${version}/oauth/access_token?${longParams}`);
    return text(long.access_token) || shortToken;
  } catch {
    return shortToken;
  }
}

async function loadCandidates(env: InstagramDirectEnv, userToken: string): Promise<InstagramCandidate[]> {
  const version = graphVersion(env.META_GRAPH_VERSION);
  const fields = encodeURIComponent('id,name,access_token,instagram_business_account{id,username,name}');
  const payload = await graphJson(`https://graph.facebook.com/${version}/me/accounts?fields=${fields}&limit=100`, userToken);
  const pages = Array.isArray(payload.data) ? payload.data.map(record) : [];
  return pages.flatMap((page): InstagramCandidate[] => {
    const instagram = record(page.instagram_business_account);
    const instagramAccountId = text(instagram.id);
    const pageAccessToken = text(page.access_token);
    const pageId = text(page.id);
    if (!instagramAccountId || !pageAccessToken || !pageId) return [];
    return [{
      instagramAccountId,
      username: text(instagram.username),
      name: text(instagram.name),
      pageId,
      pageName: text(page.name),
      pageAccessToken,
    }];
  });
}

async function oauthCallback(request: Request, env: InstagramDirectEnv, url: URL): Promise<Response> {
  const appSecret = text(env.META_APP_SECRET);
  const state = text(url.searchParams.get('state'));
  const code = text(url.searchParams.get('code'));
  const metaError = text(url.searchParams.get('error_description')) || text(url.searchParams.get('error_message'));
  const clearCookie = `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  if (metaError) return integrationRedirect(request, { instagram: 'error', message: metaError });
  if (!appSecret || !state || !code) return integrationRedirect(request, { instagram: 'error', message: 'Instagram OAuth callback неполный' });
  const verified = await verifyState(cookie(request, STATE_COOKIE), state, appSecret);
  if (!verified) return integrationRedirect(request, { instagram: 'error', message: 'Instagram OAuth state недействителен или устарел' });
  try {
    await resolveCompanyId({ ...env, CURRENT_COMPANY_ID: verified.companyId }, verified.userId);
    const redirectUri = text(env.INSTAGRAM_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
    const userToken = await exchangeCode(env, code, redirectUri);
    const candidates = await loadCandidates(env, userToken);
    if (!candidates.length) {
      return new Response(null, {
        status: 302,
        headers: { location: new URL(`/integrations?instagram=error&message=${encodeURIComponent('Не найден Instagram Professional Account, связанный с доступной Facebook Page')}`, appOrigin(request)).toString(), 'set-cookie': clearCookie },
      });
    }
    if (candidates.length === 1) {
      const result = await finalizeCandidate(env, verified.companyId, candidates[0]);
      const target = new URL('/integrations', appOrigin(request));
      target.searchParams.set('instagram', 'connected');
      target.searchParams.set('username', candidates[0].username || candidates[0].instagramAccountId);
      if (!result.subscribed) target.searchParams.set('webhook', 'manual_required');
      return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': clearCookie } });
    }
    await writeCredential(env, verified.companyId, {
      pendingCandidates: candidates,
      graphVersion: graphVersion(env.META_GRAPH_VERSION),
    }, 'selection_required', {
      values: { candidateCount: String(candidates.length) },
      secretFields: { pendingCandidateTokens: true },
    });
    const target = new URL('/integrations', appOrigin(request));
    target.searchParams.set('instagram', 'select');
    target.searchParams.set('accounts', String(candidates.length));
    return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': clearCookie } });
  } catch (error) {
    const target = new URL('/integrations', appOrigin(request));
    target.searchParams.set('instagram', 'error');
    target.searchParams.set('message', error instanceof Error ? error.message : String(error));
    return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': clearCookie } });
  }
}

async function config(env: InstagramDirectEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env);
  const row = await credentialRow(env, companyId);
  if (!row) return json({ configured: false, connected: false, status: 'not_connected', candidates: [] });
  const summary = record(row.config_summary);
  let candidates: Row[] = [];
  if (text(row.status) === 'selection_required') {
    try {
      const payload = await decryptPayload(env, row);
      const pending = Array.isArray(payload.pendingCandidates) ? payload.pendingCandidates.map(record) : [];
      candidates = pending.map((candidate) => ({
        instagramAccountId: text(candidate.instagramAccountId),
        username: text(candidate.username),
        name: text(candidate.name),
        pageId: text(candidate.pageId),
        pageName: text(candidate.pageName),
      }));
    } catch (error) {
      console.error('Unable to read pending Instagram candidates', error);
    }
  }
  return json({
    configured: true,
    connected: text(row.status) === 'connected',
    status: text(row.status),
    values: record(summary.values),
    candidates,
    lastVerifiedAt: text(row.last_verified_at) || null,
    lastError: text(row.last_error) || null,
  });
}

async function selectCandidate(request: Request, env: InstagramDirectEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env, text(request.headers.get('x-amanat-auth-user')) || undefined);
  const row = await credentialRow(env, companyId);
  if (!row || text(row.status) !== 'selection_required') return json({ error: 'Нет Instagram аккаунтов для выбора' }, 409);
  const input = record(await request.json().catch(() => ({})));
  const selectedId = text(input.instagramAccountId);
  if (!selectedId) return json({ error: 'Выберите Instagram аккаунт' }, 400);
  const payload = await decryptPayload(env, row);
  const candidates = Array.isArray(payload.pendingCandidates) ? payload.pendingCandidates.map(record) : [];
  const selected = candidates.find((candidate) => text(candidate.instagramAccountId) === selectedId);
  if (!selected) return json({ error: 'Instagram аккаунт не найден среди доступных' }, 404);
  const result = await finalizeCandidate(env, companyId, {
    instagramAccountId: text(selected.instagramAccountId),
    username: text(selected.username),
    name: text(selected.name),
    pageId: text(selected.pageId),
    pageName: text(selected.pageName),
    pageAccessToken: text(selected.pageAccessToken),
  });
  return json({ ok: true, connected: true, instagramAccountId: selectedId, username: text(selected.username), subscribed: result.subscribed, warning: result.warning });
}

function instagramBody(message: Row): string {
  const body = text(message.text);
  if (body) return body;
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(record) : [];
  if (attachments.length) return `[Вложение${text(attachments[0].type) ? `: ${text(attachments[0].type)}` : ''}]`;
  if (message.is_deleted === true) return '[Сообщение удалено]';
  return '[Instagram сообщение]';
}

async function upsertLead(env: InstagramDirectEnv, credential: InstagramCredential, senderId: string, displayName: string, body: string, event: Row): Promise<Row> {
  const externalId = `instagram:${credential.companyId}:${senderId}`;
  const existing = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(credential.companyId)}&external_id=eq.${encodeURIComponent(externalId)}&select=*&order=updated_at.desc&limit=1`);
  const now = new Date().toISOString();
  const patch: Row = {
    company_id: credential.companyId,
    name: displayName || senderId,
    phone: text(existing[0]?.phone),
    source: 'Instagram Direct',
    platform: 'Meta',
    stage: text(existing[0]?.stage) || 'Новый',
    first_message: text(existing[0]?.first_message) || body,
    lead_created_at: text(existing[0]?.lead_created_at) || now,
    first_contact_at: text(existing[0]?.first_contact_at) || now,
    utm_source: 'instagram',
    utm_medium: 'direct_message',
    metadata: { ...record(existing[0]?.metadata), instagram_sender_id: senderId, instagram_account_id: credential.instagramAccountId, instagram_event: event },
    updated_at: now,
  };
  const rows = existing[0]?.id
    ? await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(text(existing[0].id))}&company_id=eq.${encodeURIComponent(credential.companyId)}&select=*`, { method: 'PATCH', body: JSON.stringify(patch) })
    : await db<Row[]>(env, 'marketing_leads?select=*', { method: 'POST', body: JSON.stringify({ ...patch, external_id: externalId }) });
  if (!rows[0]) throw new Error('Не удалось создать Instagram-лида');
  return rows[0];
}

async function ensureConversation(env: InstagramDirectEnv, credential: InstagramCredential, lead: Row, title: string): Promise<Row> {
  const leadId = text(lead.id);
  const existing = await db<Row[]>(env, `marketing_conversations?company_id=eq.${encodeURIComponent(credential.companyId)}&lead_id=eq.${encodeURIComponent(leadId)}&channel=eq.INSTAGRAM&archived_at=is.null&select=*&order=updated_at.desc&limit=1`);
  if (existing[0]) return existing[0];
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, 'marketing_conversations?select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: credential.companyId, lead_id: leadId, contact_id: leadId, title: title || 'Instagram Direct', phone: null, channel: 'INSTAGRAM', status: 'OPEN', unread_count: 0, last_message_at: now, created_at: now, updated_at: now }),
  });
  if (!rows[0]) throw new Error('Не удалось создать Instagram-диалог');
  return rows[0];
}

async function saveInbound(env: InstagramDirectEnv, credential: InstagramCredential, conversation: Row, event: Row, message: Row, senderId: string, senderName: string): Promise<boolean> {
  const messageId = text(message.mid);
  if (!messageId) return false;
  const duplicate = await db<Row[]>(env, `marketing_messages?company_id=eq.${encodeURIComponent(credential.companyId)}&external_message_id=eq.${encodeURIComponent(messageId)}&select=id&limit=1`);
  if (duplicate.length) return false;
  const sentAt = new Date(number(event.timestamp) || Date.now()).toISOString();
  await db<Row[]>(env, 'marketing_messages?select=id', {
    method: 'POST',
    body: JSON.stringify({
      company_id: credential.companyId,
      conversation_id: text(conversation.id),
      body: instagramBody(message),
      direction: 'INBOUND',
      sender_name: senderName || null,
      external_message_id: messageId,
      status: 'DELIVERED',
      sent_at: sentAt,
      metadata: { instagram: event, instagram_sender_id: senderId, instagram_account_id: credential.instagramAccountId },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(text(conversation.id))}&company_id=eq.${encodeURIComponent(credential.companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN', unread_count: number(conversation.unread_count) + 1 }),
  });
  return true;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  return Array.from(new Uint8Array(await hmac(secret, body)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function webhook(request: Request, env: InstagramDirectEnv, url: URL): Promise<Response> {
  if (request.method === 'GET') {
    const mode = text(url.searchParams.get('hub.mode'));
    const token = text(url.searchParams.get('hub.verify_token'));
    const challenge = text(url.searchParams.get('hub.challenge'));
    if (mode === 'subscribe' && text(env.META_WEBHOOK_VERIFY_TOKEN) && secureEqual(token, text(env.META_WEBHOOK_VERIFY_TOKEN))) return new Response(challenge, { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await request.text();
  if (text(env.META_APP_SECRET)) {
    const supplied = request.headers.get('x-hub-signature-256') || '';
    const expected = `sha256=${await hmacHex(text(env.META_APP_SECRET), body)}`;
    if (!supplied || !secureEqual(supplied, expected)) return json({ error: 'Invalid Meta signature' }, 401);
  }
  let payload: Row = {};
  try { payload = record(JSON.parse(body || '{}')); } catch { return json({ error: 'Invalid JSON payload' }, 400); }
  if (text(payload.object) !== 'instagram') return json({ ok: true, processed: 0 });
  let processed = 0;
  const entries = Array.isArray(payload.entry) ? payload.entry.map(record) : [];
  for (const entry of entries) {
    const entryAccountId = text(entry.id);
    const events = Array.isArray(entry.messaging) ? entry.messaging.map(record) : [];
    for (const event of events) {
      const sender = record(event.sender);
      const recipient = record(event.recipient);
      const senderId = text(sender.id);
      const accountId = text(recipient.id) || entryAccountId;
      const message = record(event.message);
      const messageId = text(message.mid);
      if (!senderId || !accountId || !messageId || message.is_echo === true) continue;
      const credential = await findCredentialByInstagramAccount(env, accountId);
      if (!credential) {
        console.error(`Instagram webhook account ${accountId} is not mapped to a clinic`);
        continue;
      }
      const senderName = text(sender.name) || text(sender.username) || senderId;
      const bodyText = instagramBody(message);
      const lead = await upsertLead(env, credential, senderId, senderName, bodyText, event);
      const conversation = await ensureConversation(env, credential, lead, senderName);
      if (await saveInbound(env, credential, conversation, event, message, senderId, senderName)) processed += 1;
    }
  }
  return json({ ok: true, processed });
}

async function outbound(request: Request, env: InstagramDirectEnv, threadId: string): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const conversations = await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&archived_at=is.null&select=*&limit=1`);
  const conversation = conversations[0];
  if (!conversation || text(conversation.channel).toUpperCase() !== 'INSTAGRAM') return null;
  const companyId = text(conversation.company_id);
  if (!companyId) return json({ error: 'У Instagram-диалога не определена клиника' }, 409);
  if (text(env.CURRENT_COMPANY_ID) && text(env.CURRENT_COMPANY_ID) !== companyId) return json({ error: 'Instagram-диалог принадлежит другой клинике' }, 403);
  const input = record(await request.clone().json().catch(() => ({})));
  const body = text(input.body);
  if (!body) return json({ error: 'Для Instagram Direct укажите текст сообщения' }, 400);
  const leadId = text(conversation.lead_id) || text(conversation.contact_id);
  if (!leadId) return json({ error: 'Instagram-диалог не связан с лидом' }, 409);
  const leads = await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=external_id,metadata&limit=1`);
  const lead = leads[0];
  if (!lead) return json({ error: 'Instagram-лид не найден' }, 404);
  const metadata = record(lead.metadata);
  const externalId = text(lead.external_id);
  const senderId = text(metadata.instagram_sender_id) || (externalId.startsWith(`instagram:${companyId}:`) ? externalId.slice(`instagram:${companyId}:`.length) : '');
  if (!senderId) return json({ error: 'Не найден Instagram Scoped ID клиента' }, 409);
  const credential = await connectedCredential(env, companyId);
  const result = await graphJson(`https://graph.facebook.com/${credential.graphVersion}/${encodeURIComponent(credential.instagramAccountId)}/messages`, credential.pageAccessToken, {
    method: 'POST',
    body: JSON.stringify({ recipient: { id: senderId }, message: { text: body } }),
  });
  const sentAt = new Date().toISOString();
  const externalMessageId = text(result.message_id) || text(result.id);
  const rows = await db<Row[]>(env, 'marketing_messages?select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: companyId,
      conversation_id: threadId,
      body,
      direction: 'OUTBOUND',
      sender_name: text(input.senderName) || 'Оператор',
      external_message_id: externalMessageId || null,
      status: 'SENT',
      sent_at: sentAt,
      read_at: sentAt,
      metadata: { instagram: result, instagram_sender_id: senderId, instagram_account_id: credential.instagramAccountId },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN' }),
  });
  return json(rows[0] || { ok: true }, 201);
}

export async function handleInstagramPublicRequest(request: Request, env: InstagramDirectEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/instagram/callback' && request.method === 'GET') return oauthCallback(request, env, url);
  if (url.pathname === '/api/webhooks/instagram' && ['GET', 'POST'].includes(request.method)) return webhook(request, env, url);
  return null;
}

export async function handleInstagramDirectRequest(request: Request, env: InstagramDirectEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/instagram/start' && request.method === 'POST') return startOAuth(request, env);
  if (url.pathname === '/api/integrations/instagram/config' && request.method === 'GET') return config(env);
  if (url.pathname === '/api/integrations/instagram/select' && request.method === 'POST') return selectCandidate(request, env);
  if (url.pathname === '/api/integrations/instagram/disconnect' && request.method === 'DELETE') {
    const companyId = await resolveCompanyId(env, text(request.headers.get('x-amanat-auth-user')) || undefined);
    await deleteCredential(env, companyId);
    return json({ ok: true });
  }
  const messageMatch = url.pathname.match(/^\/api\/callcenter\/threads\/([^/]+)\/messages$/);
  if (messageMatch) return outbound(request, env, decodeURIComponent(messageMatch[1]));
  return null;
}
