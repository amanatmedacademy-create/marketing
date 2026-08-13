// Compatibility entrypoint. The active sales funnel implementation now uses
// crm_pipelines, crm_pipeline_stages and crm_deals as its source of truth.
// PATCH requests go through a guard that preserves omitted pipeline/stage fields
// and cleans stale marketing_leads.crm_deal_id links when a deal is relinked.
export { handleSalesFunnelWithPatchGuard as handleSalesFunnel } from './salesFunnelPatchGuard';
