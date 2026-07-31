type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown };

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(payload?.error?.message ?? payload?.message ?? `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
