import { useEffect } from 'react';
import { authFetch } from '../services/auth';

export default function BinotelOAuthReturnHandler() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') || '';
    if (!state.startsWith('binotel:')) return;

    const code = params.get('code') || '';
    const providerError = params.get('error_description') || params.get('error_message') || params.get('error') || '';
    const target = new URL('/integrations', window.location.origin);

    if (providerError) {
      target.searchParams.set('binotel', 'error');
      target.searchParams.set('message', providerError.slice(0, 300));
      window.location.replace(target.toString());
      return;
    }

    if (!code) {
      target.searchParams.set('binotel', 'error');
      target.searchParams.set('message', 'Binotel OAuth не вернул authorization code');
      window.location.replace(target.toString());
      return;
    }

    void authFetch('/api/telephony/providers/binotel/oauth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
    }).then(async (response) => {
      const raw = await response.text();
      let payload: { error?: string } = {};
      try { payload = raw ? JSON.parse(raw) as { error?: string } : {}; } catch { payload = { error: raw }; }
      if (!response.ok) throw new Error(payload.error || raw || `HTTP ${response.status}`);
      target.searchParams.set('binotel', 'connected');
      window.location.replace(target.toString());
    }).catch((error) => {
      target.searchParams.set('binotel', 'error');
      target.searchParams.set('message', (error instanceof Error ? error.message : String(error)).slice(0, 300));
      window.location.replace(target.toString());
    });
  }, []);

  return null;
}
