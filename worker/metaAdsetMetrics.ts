import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : value == null ? null : String(value);
const number = (value: unknown): number => { const parsed = Number(String(value ?? 0).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(parsed) ? parsed : 0; };
const list = (value?: string) => (value || '').split(',').map(item => item.trim().replace(/^act_/, '')).filter(Boolean);

function action(actions: unknown, names: string[]): number {
  if (!Array.isArray(actions)) return 0;
  const accepted = new Set(names);
  return actions.reduce((sum, item) => { const row = record(item); return accepted.has(String(row.action_type || '')) ? sum + number(row.value) : sum; }, 0);
}

async function supabase(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function graph(url: string): Promise<JsonRecord> {
  const response = await fetch(url);
  const payload = record(await response.json());
  if (!response.ok || payload.error) throw new Error(`Meta Graph API: ${response.status} ${JSON.stringify(payload.error || payload)}`);
  return payload;
}

async function fetchAll(url: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 100; page += 1) {
    const payload = await graph(next);
    if (Array.isArray(payload.data)) rows.push(...payload.data.map(record));
    next = text(record(payload.paging).next);
  }
  return rows;
}

function dateRange(url: URL) {
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') || new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

export async function handleMetaAdsetMetrics(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/analytics/meta-adsets' && request.method === 'GET') {
    const { from, to } = dateRange(url);
    const account = url.searchParams.get('account');
    const filters = [`report_date=gte.${from}`, `report_date=lte.${to}`];
    if (account) filters.push(`account_id=eq.${encodeURIComponent(account)}`);
    const response = await supabase(env, `marketing_meta_adset_metrics?select=*&${filters.join('&')}&order=report_date.desc&limit=50000`);
    const body = await response.text();
    if (!response.ok) throw new Error(`Read Meta ad set metrics: ${response.status} ${body}`);
    return new Response(body || '[]', { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  if (url.pathname !== '/api/integrations/meta/adsets/sync' || request.method !== 'POST') return null;
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION) throw new Error('Meta integration credentials are missing');
  const accountIds = list(env.META_AD_ACCOUNT_IDS);
  if (!accountIds.length) throw new Error('META_AD_ACCOUNT_IDS is empty');
  const { from, to } = dateRange(url);
  const output: JsonRecord[] = [];

  for (const accountId of accountIds) {
    const base = `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;
    const adsetFields = ['id','name','status','campaign_id','daily_budget','lifetime_budget','optimization_goal','targeting','created_time','updated_time'].join(',');
    const adsets = await fetchAll(`${base}/act_${accountId}/adsets?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}&fields=${encodeURIComponent(adsetFields)}&limit=500`);
    const details = new Map(adsets.map(item => [String(item.id), item]));

    const fields = [
      'account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','objective','optimization_goal',
      'reach','impressions','frequency','cpm','clicks','unique_clicks','ctr','unique_ctr','cpc','inline_link_clicks',
      'unique_inline_link_clicks','unique_inline_link_click_ctr','cost_per_inline_link_click','spend','actions','cost_per_action_type',
      'video_30_sec_watched_actions','video_avg_time_watched_actions','video_p25_watched_actions','video_p50_watched_actions',
      'video_p75_watched_actions','video_p95_watched_actions','date_start','date_stop'
    ].join(',');
    const params = new URLSearchParams({
      access_token: env.META_ACCESS_TOKEN,
      level: 'adset',
      fields,
      time_increment: '1',
      time_range: JSON.stringify({ since: from, until: to }),
      limit: '500',
    });
    const insights = await fetchAll(`${base}/act_${accountId}/insights?${params}`);

    for (const item of insights) {
      const adsetId = String(item.adset_id || '');
      if (!adsetId) continue;
      const detail = details.get(adsetId) || {};
      const targeting = record(detail.targeting);
      const impressions = number(item.impressions);
      const linkClicks = number(item.inline_link_clicks);
      const lpv = action(item.actions, ['landing_page_view']);
      const conversations = action(item.actions, ['onsite_conversion.messaging_conversation_started_7d','onsite_conversion.messaging_conversation_started']);
      const results = action(item.actions, ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead','onsite_conversion.messaging_conversation_started_7d']);
      const spend = number(item.spend);
      const video3s = action(item.actions, ['video_view']);
      const budget = number(detail.daily_budget || detail.lifetime_budget) / 100;
      output.push({
        report_date: String(item.date_start || to).slice(0, 10), account_id: accountId, account_name: text(item.account_name),
        campaign_id: text(item.campaign_id), campaign_name: text(item.campaign_name), adset_id: adsetId, adset_name: text(item.adset_name),
        status: text(detail.status), objective: text(item.objective), performance_goal: text(item.optimization_goal || detail.optimization_goal),
        result_indicator: results ? 'result' : null, results, result_rate: impressions ? results * 100 / impressions : 0,
        cost_per_result: results ? spend / results : 0, spend, adset_budget: budget || null,
        budget_type: detail.daily_budget ? 'DAILY' : detail.lifetime_budget ? 'LIFETIME' : null,
        reach: number(item.reach), impressions, views: impressions, frequency: number(item.frequency), cpm: number(item.cpm),
        clicks: number(item.clicks), unique_clicks: number(item.unique_clicks), ctr: number(item.ctr), unique_ctr: number(item.unique_ctr), cpc: number(item.cpc),
        link_clicks: linkClicks, unique_link_clicks: number(item.unique_inline_link_clicks), unique_link_ctr: number(item.unique_inline_link_click_ctr), link_cpc: number(item.cost_per_inline_link_click),
        app_landing_page_views: 0, website_landing_page_views: lpv, landing_page_views: lpv,
        landing_page_view_cost: lpv ? spend / lpv : 0, landing_page_view_ratio: linkClicks ? lpv * 100 / linkClicks : 0,
        messaging_welcome_views: action(item.actions, ['onsite_conversion.messaging_welcome_message_view']),
        engagement_cost: number(item.cost_per_inline_post_engagement),
        instagram_profile_visits: action(item.actions, ['instagram_profile_visit']), instagram_follows: action(item.actions, ['instagram_follow']),
        post_comments: action(item.actions, ['comment']), post_shares: action(item.actions, ['post']), post_saves: action(item.actions, ['post_save']),
        messaging_conversations_started: conversations, messaging_replies_7d: action(item.actions, ['onsite_conversion.messaging_conversation_replied_7d']),
        messaging_conversation_cost: conversations ? spend / conversations : 0,
        video_3s_plays: video3s, video_3s_cost: video3s ? spend / video3s : 0, video_3s_rate: impressions ? video3s * 100 / impressions : 0,
        video_avg_time: action(item.video_avg_time_watched_actions, ['video_view']),
        video_p25: action(item.video_p25_watched_actions, ['video_view']), video_p50: action(item.video_p50_watched_actions, ['video_view']),
        video_p75: action(item.video_p75_watched_actions, ['video_view']), video_p95: action(item.video_p95_watched_actions, ['video_view']),
        custom_audiences: Array.isArray(targeting.custom_audiences) ? targeting.custom_audiences : [],
        excluded_custom_audiences: Array.isArray(targeting.excluded_custom_audiences) ? targeting.excluded_custom_audiences : [],
        adset_created_at: text(detail.created_time), adset_updated_at: text(detail.updated_time), initial_results: results,
        initial_result_indicator: results ? 'result' : null, raw: { insight: item, adset: detail }, synced_at: new Date().toISOString(),
      });
    }
  }

  if (output.length) {
    const response = await supabase(env, 'marketing_meta_adset_metrics?on_conflict=account_id,adset_id,report_date', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(output),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Write Meta ad set metrics: ${response.status} ${body}`);
  }

  return new Response(JSON.stringify({ ok: true, from, to, rows: output.length }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
