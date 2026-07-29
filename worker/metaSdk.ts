type JsonRecord = Record<string, unknown>;

export interface MetaSdkEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
}

interface MetaAccount {
  id: string;
  account_id?: string;
  name?: string;
}

const json = (data: unknown, status