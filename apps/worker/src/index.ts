interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  Object.entries(securityHeaders).forEach(([key, value]) => secured.headers.set(key, value));
  return secured;
}

function assertSupabase(env: Env): asserts env is Env & {
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID: string;
} {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEFAULT_COMPANY_ID) {
    throw new Error('Supabase environment is not configured');
  }
}

async function supabaseRest<T>(
  env: Env,
  table: string,
  query: string,
  init: RequestInit = {},
): Promise<T> {
  assertSupabase(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function getDashboard(env: Env) {
  assertSupabase(env);
  const companyFilter = `company_id=eq.${env.DEFAULT_COMPANY_ID}`;
  const [deals, tasks, stages] = await Promise.all([
    supabaseRest<Array<{ amount: number | string; status: string }>>(
      env,
      'deals',
      `select=amount,status&${companyFilter}`,
    ),
    supabaseRest<Array<{ status: string }>>(env, 'tasks', `select=status&${companyFilter}`),
    supabaseRest<Array<{ id: string; name: string; position: number }>>(
      env,
      'pipeline_stages',
      `select=id,name,position&${companyFilter}&order=position.asc`,
    ),
  ]);

  const openDeals = deals.filter((deal) => deal.status === 'open');
  const amountInWork = openDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length;

  return {
    metrics: {
      amountInWork,
      newDeals: openDeals.length,
      openTasks,
      unansweredConversations: 0,
    },
    stages,
  };
}

async function getDeals(env: Env) {
  assertSupabase(env);
  return supabaseRest(
    env,
    'deals',
    `select=id,title,contact_name,phone,amount,status,stage_id,source,created_at&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=created_at.desc`,
  );
}

async function routeApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json({ environment: env.APP_ENV, supabaseConfigured: Boolean(env.SUPABASE_URL) });
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard') {
    return json(await getDashboard(env));
  }

  if (request.method === 'GET' && url.pathname === '/api/deals') {
    return json(await getDeals(env));
  }

  return json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        return withSecurityHeaders(
          json({
            status: 'ok',
            service: 'imds-crm-edge',
            environment: env.APP_ENV,
            timestamp: new Date().toISOString(),
          }),
        );
      }

      if (url.pathname.startsWith('/api/')) {
        return withSecurityHeaders(await routeApi(request, env));
      }

      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      return withSecurityHeaders(
        json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          },
          { status: 500 },
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
