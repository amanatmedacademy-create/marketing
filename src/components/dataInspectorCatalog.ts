export type InspectorKnowledge = {
  sources?: string[];
  fields?: string[];
  technical?: string[];
  lineage?: string[];
};

const ROUTE_KNOWLEDGE: Array<{ match: (path: string) => boolean; data: InspectorKnowledge }> = [
  {
    match: (path) => path === '/' || path === '/analytics',
    data: {
      sources: ['Supabase · marketing_leads', 'Supabase · marketing_ads', 'Supabase · marketing_dashboard_daily', 'IMDS Analytics Worker'],
      fields: ['lead_created_at', 'is_target', 'appointment_at', 'arrived_at', 'sold_at', 'sale_amount', 'spend', 'impressions', 'reach', 'clicks', 'campaign_id', 'adset_id', 'ad_id'],
      technical: ['/api/analytics/overview', 'Tables: marketing_leads, marketing_ads, marketing_dashboard_daily, marketing_scoring_settings', 'Tenant filter: current company', 'Attribution priority: ad_id → adset_id → campaign_id → unattributed'],
      lineage: ['Meta/TikTok + CRM', 'marketing_ads + marketing_leads', 'IMDS Analytics Worker', 'Dashboard / Analytics'],
    },
  },
  {
    match: (path) => path === '/leads' || path === '/customers',
    data: {
      sources: ['Supabase · marketing_leads', 'Call Center workspace', 'Sales Funnel workspace', 'Calls'],
      fields: ['id', 'name', 'phone', 'email', 'source', 'platform', 'campaign', 'stage', 'next_action', 'first_contact_at', 'updated_at'],
      technical: ['/api/leads', '/api/callcenter/workspace', '/api/calls', '/api/funnel/workspace', 'Primary CRM table: marketing_leads', 'Tenant filter: current company'],
      lineage: ['Lead source / CRM', 'marketing_leads', 'CRM enrichment', 'Leads / Customer 360'],
    },
  },
  {
    match: (path) => path.startsWith('/pipeline'),
    data: {
      sources: ['IMDS Sales Funnel', 'Supabase CRM'],
      fields: ['pipeline_id', 'stage_id', 'marketing_lead_id', 'manager_user_id', 'priority', 'amount', 'status', 'next_action_at', 'won_at', 'lost_at'],
      technical: ['/api/funnel/workspace', '/api/funnel/leads/:id/move', '/api/funnel/pipelines', '/api/funnel/stages', 'Tenant filter: current company'],
      lineage: ['marketing_leads', 'Sales Funnel workspace', 'Stage / ownership rules', 'Pipeline board'],
    },
  },
  {
    match: (path) => path === '/chat',
    data: {
      sources: ['marketing_conversations', 'marketing_messages', 'marketing_leads', 'marketing_users', 'sales_funnel_leads'],
      fields: ['conversation.id', 'lead_id', 'channel', 'status', 'assigned_user_id', 'unread_count', 'message.direction', 'message.status', 'external_message_id', 'read_at'],
      technical: ['/api/callcenter/workspace', '/api/callcenter/threads/:id/messages', '/api/callcenter/threads/:id/read', 'Tables: marketing_conversations, marketing_messages, marketing_leads, marketing_users, sales_funnel_leads', 'Attachments bucket: marketing-chat-attachments', 'Tenant filter: current company'],
      lineage: ['WhatsApp / Instagram / Web', 'marketing_messages + conversations', 'Call Center API', 'Unified Inbox'],
    },
  },
  {
    match: (path) => path === '/calls',
    data: {
      sources: ['IMDS Calls', 'CRM leads'],
      fields: ['lead_id', 'operator_user_id', 'call_status', 'scheduled_at', 'duration_seconds', 'appointment_created', 'next_action', 'quality_score'],
      technical: ['/api/calls', '/api/calls/operators', 'Tenant filter: current company'],
      lineage: ['Call event', 'Calls dataset', 'Operator/lead aggregation', 'Calls module'],
    },
  },
  {
    match: (path) => path === '/advertising',
    data: {
      sources: ['Meta Marketing API', 'TikTok Ads API', 'Supabase · marketing_ads', 'IMDS CRM'],
      fields: ['account_id', 'campaign_id', 'adset_id', 'ad_id', 'status', 'impressions', 'reach', 'clicks', 'spend', 'leads', 'sales', 'revenue'],
      technical: ['/api/ads', '/api/ads/currencies', '/api/exchange-rates', 'Table: marketing_ads', 'Currency normalization before cost metrics', 'Tenant filter: current company'],
      lineage: ['Ad platforms', 'marketing_ads', 'Currency + CRM attribution', 'Ads Manager'],
    },
  },
  {
    match: (path) => path === '/integrations' || path === '/google',
    data: {
      sources: ['Provider APIs', 'Encrypted integration credentials', 'Integration runs'],
      fields: ['provider', 'status', 'updatedAt', 'lastVerifiedAt', 'lastError', 'configured'],
      technical: ['/api/integrations/status', '/api/integrations/config', '/api/integrations/test/:provider', '/api/integrations/sync', '/api/integrations/meta/catalog', '/api/integrations/meta/selection', '/api/integrations/meta/backfill', 'Secrets are never displayed in Data Inspector'],
      lineage: ['Provider API', 'Encrypted tenant credential', 'IMDS integration worker', 'Integration status / synced data'],
    },
  },
  {
    match: (path) => path === '/attribution',
    data: {
      sources: ['marketing_leads', 'marketing_ads', 'UTM / click identifiers'],
      fields: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'campaign_id', 'adset_id', 'ad_id', 'fbclid', 'gclid', 'ttclid', 'yclid', 'vk_click_id'],
      technical: ['/api/analytics/overview', 'Attribution priority: ad_id → adset_id → campaign_id', 'Unmatched leads remain unattributed', 'Tenant filter: current company'],
      lineage: ['UTM / click id', 'marketing_leads', 'Ad identity matching', 'Attributed CRM result'],
    },
  },
];

const TITLE_KNOWLEDGE: Array<{ aliases: string[]; data: InspectorKnowledge }> = [
  {
    aliases: ['roas'],
    data: { technical: ['Formula source fields: crm_revenue + spend', 'Advertising spend is normalized to display currency before final KPI'], lineage: ['marketing_ads', 'Spend normalization', 'CRM revenue join', 'ROAS'] },
  },
  {
    aliases: ['romi'],
    data: { technical: ['Formula source fields: revenue + spend'], lineage: ['marketing_ads + CRM', 'Revenue/spend aggregation', 'ROMI formula', 'ROMI'] },
  },
  {
    aliases: ['cpl'],
    data: { technical: ['Formula source fields: spend + crm_leads'], lineage: ['marketing_ads + marketing_leads', 'Attribution', 'spend / leads', 'CPL'] },
  },
  {
    aliases: ['неатрибутированные'],
    data: { technical: ['A lead is unattributed when ad_id, adset_id and campaign_id cannot be uniquely resolved against advertising rows'], lineage: ['marketing_leads', 'Identity resolution', 'No unique ad match', 'Unattributed leads'] },
  },
  {
    aliases: ['непрочитано', 'непрочитанные'],
    data: { technical: ['Field: marketing_conversations.unread_count', 'Read action: PATCH /api/callcenter/threads/:id/read'], lineage: ['Inbound message', 'marketing_messages', 'conversation unread_count', 'Unread badge'] },
  },
];

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function resolveInspectorKnowledge(pathname: string, title: string): InspectorKnowledge {
  const route = ROUTE_KNOWLEDGE.find((entry) => entry.match(pathname))?.data || {};
  const normalizedTitle = normalize(title);
  const titleKnowledge = TITLE_KNOWLEDGE.find((entry) => entry.aliases.some((alias) => normalizedTitle === alias || normalizedTitle.includes(alias)))?.data || {};
  return {
    sources: titleKnowledge.sources || route.sources,
    fields: titleKnowledge.fields || route.fields,
    technical: [...(route.technical || []), ...(titleKnowledge.technical || [])],
    lineage: titleKnowledge.lineage || route.lineage,
  };
}
