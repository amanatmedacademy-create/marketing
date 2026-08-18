// Compatibility entrypoint. The active sales funnel implementation uses
// crm_pipelines, crm_pipeline_stages and crm_deals in the VPS PostgreSQL database.
export { handleSalesFunnelV2 as handleSalesFunnel } from './salesFunnelV2';
