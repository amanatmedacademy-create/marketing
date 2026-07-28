import app from './index';
import { handleAnalytics } from './analytics';
import type { Env, WorkerExecutionContext, WorkerScheduledController } from './integrations';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const analytics = await handleAnalytics(request, env, url);
      if (analytics) return analytics;
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Analytics error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return app.fetch(request, env);
  },

  async scheduled(controller: WorkerScheduledController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    await app.scheduled(controller, env, ctx);
  },
};
