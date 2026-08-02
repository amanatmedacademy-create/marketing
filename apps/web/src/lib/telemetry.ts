type TelemetryEvent = {
  eventId: string;
  sessionId: string;
  eventName: string;
  occurredAt: string;
  route?: string;
  moduleKey?: string;
  moduleName?: string;
  moduleOwnerProductKey?: string;
  featureKey?: string;
  outcome?: 'neutral' | 'success' | 'failure';
  presenceStatus?: 'active' | 'idle' | 'offline' | 'closed';
  activeSecondsDelta?: number;
  idleSecondsDelta?: number;
  appVersion?: string;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
  properties?: Record<string, string | number | boolean | null>;
};

const endpoint = import.meta.env.VITE_IMDS_TELEMETRY_ENDPOINT?.trim();
const sourceKey = import.meta.env.VITE_IMDS_TELEMETRY_SOURCE_KEY?.trim();
const writeKey = import.meta.env.VITE_IMDS_TELEMETRY_WRITE_KEY?.trim();
const enabled = Boolean(endpoint && sourceKey && writeKey && import.meta.env.VITE_IMDS_TELEMETRY_ENABLED === 'true');
const sessionId = crypto.randomUUID();
let lastActivityAt = Date.now();
let lastHeartbeatAt = Date.now();
let stopped = false;
const queue: TelemetryEvent[] = [];

function route(): string {
  return window.location.pathname;
}

function deviceType(): 'desktop' | 'mobile' | 'tablet' {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1100) return 'tablet';
  return 'desktop';
}

function enqueue(event: Omit<TelemetryEvent, 'eventId' | 'sessionId' | 'occurredAt' | 'appVersion' | 'deviceType'>): void {
  if (!enabled || stopped) return;
  queue.push({
    ...event,
    eventId: crypto.randomUUID(),
    sessionId,
    occurredAt: new Date().toISOString(),
    appVersion: import.meta.env.VITE_APP_VERSION || '0.1.0',
    deviceType: deviceType(),
  });
  if (queue.length >= 20) void flush();
}

async function flush(): Promise<void> {
  if (!enabled || !queue.length) return;
  const events = queue.splice(0, 100);
  try {
    const response = await fetch(endpoint!, {
      method: 'POST',
      keepalive: true,
      headers: {
        'content-type': 'application/json',
        'x-imds-source-key': sourceKey!,
        'x-imds-write-key': writeKey!,
        'x-imds-request-id': crypto.randomUUID(),
        'x-imds-sdk-version': 'marketing-web-1.0.0',
      },
      body: JSON.stringify({ requestId: crypto.randomUUID(), events }),
    });
    if (!response.ok) queue.unshift(...events.slice(-100));
  } catch {
    queue.unshift(...events.slice(-100));
  }
}

function heartbeat(): void {
  const now = Date.now();
  const elapsedSeconds = Math.max(0, Math.min(300, Math.round((now - lastHeartbeatAt) / 1000)));
  const active = document.visibilityState === 'visible' && now - lastActivityAt <= 60_000;
  enqueue({
    eventName: 'session_heartbeat',
    route: route(),
    presenceStatus: active ? 'active' : 'idle',
    activeSecondsDelta: active ? elapsedSeconds : 0,
    idleSecondsDelta: active ? 0 : elapsedSeconds,
  });
  lastHeartbeatAt = now;
  void flush();
}

export const telemetry = {
  start(): void {
    if (!enabled) return;
    enqueue({ eventName: 'session_started', route: route(), presenceStatus: 'active' });
    enqueue({ eventName: 'page_viewed', route: route(), presenceStatus: 'active' });
    for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
      window.addEventListener(eventName, () => { lastActivityAt = Date.now(); }, { passive: true });
    }
    window.addEventListener('popstate', () => enqueue({ eventName: 'page_viewed', route: route(), presenceStatus: 'active' }));
    window.addEventListener('online', () => void flush());
    window.addEventListener('pagehide', () => {
      enqueue({ eventName: 'session_heartbeat', route: route(), presenceStatus: 'offline' });
      void flush();
    });
    window.setInterval(heartbeat, 30_000);
    window.setInterval(() => void flush(), 10_000);
  },
  module(moduleKey: string, moduleName: string, moduleOwnerProductKey = 'imds-marketing'): void {
    enqueue({ eventName: 'module_opened', route: route(), moduleKey, moduleName, moduleOwnerProductKey, presenceStatus: 'active' });
  },
  feature(moduleKey: string, featureKey: string, outcome: 'neutral' | 'success' | 'failure' = 'neutral'): void {
    enqueue({ eventName: 'feature_used', route: route(), moduleKey, featureKey, outcome, presenceStatus: 'active' });
  },
  stop(): void {
    if (!enabled || stopped) return;
    enqueue({ eventName: 'session_ended', route: route(), presenceStatus: 'closed' });
    stopped = true;
    void flush();
  },
};

export function startMarketingTelemetry(): void {
  telemetry.start();
}
