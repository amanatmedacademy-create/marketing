import { routeRequest } from './router';

export interface Env {
  APP_ENV?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return routeRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
