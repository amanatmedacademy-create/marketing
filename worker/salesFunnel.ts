// Compatibility entrypoint. The active sales funnel implementation now uses
// crm_pipelines, crm_pipeline_stages and crm_deals as its source of truth.
export { handleSalesFunnelV2 as handleSalesFunnel } from './salesFunnelV2';
