import { routeRequest } from './router';

export interface Env {
  APP_ENV?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return routeRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
