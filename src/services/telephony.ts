export interface TelephonyStatus {
  provider: 'zadarma';
  configured: boolean;
  extension: string | null;
  mode: 'callback';
  credentialScope?: 'clinic' | 'default-clinic-fallback' | 'unconfigured';
  capabilities: string[];
}

export interface TelephonyCallResponse {
  ok: boolean;
  provider: 'zadarma';
  mode: 'callback';
  extension: string;
  phone: string;
  result?: unknown;
}

export interface TelephonyWebRtcKeyResponse {
  provider: 'zadarma';
  sip: string;
  key: string | null;
}

export interface TelephonyTranscriptionResponse {
  ok: boolean;
  transcript: string;
  reusedTranscript?: boolean;
  analysis?: unknown;
  analysisError?: string;
  analysisSkipped?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/telephony${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const text = await response.text();
  if (!response.ok) {
    try {
      const payload = text ? JSON.parse(text) as { error?: string } : {};
      throw new Error(payload.error || text || `Telephony request failed: ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message !== text) throw error;
      throw new Error(text || `Telephony request failed: ${response.status}`);
    }
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export const telephonyApi = {
  status: () => request<TelephonyStatus>('/status'),
  startCall: (phone: string) => request<TelephonyCallResponse>('/calls', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  }),
  transcribe: (callId: string) => request<TelephonyTranscriptionResponse>(`/calls/${encodeURIComponent(callId)}/transcribe`, {
    method: 'POST',
    body: '{}',
  }),
  webRtcKey: () => request<TelephonyWebRtcKeyResponse>('/webrtc-key'),
  test: () => request<{ ok: boolean; provider: 'zadarma'; balance?: unknown }>('/test', {
    method: 'POST',
    body: '{}',
  }),
};
