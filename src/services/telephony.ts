export interface TelephonyLine {
  id: string;
  name: string;
  provider: string;
  extension?: string | null;
  number?: string | null;
  mode?: string;
  configured?: boolean;
}

export interface TelephonyStatus {
  provider: string;
  providerLabel?: string;
  configured: boolean;
  extension: string | null;
  mode: string;
  credentialScope?: 'clinic' | 'default-clinic-fallback' | 'unconfigured' | string;
  capabilities: string[];
  lines?: TelephonyLine[];
}

export interface TelephonyCallResponse {
  ok: boolean;
  provider: string;
  mode: string;
  extension?: string;
  phone: string;
  marketingCallId?: string;
  correlationRequestId?: string;
  providerCallId?: string;
  result?: unknown;
}

export interface TelephonyWebRtcKeyResponse {
  provider: string;
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

export type TelephonyControlAction = 'mute' | 'unmute' | 'hold' | 'unhold' | 'transfer' | 'dtmf' | 'record' | 'hangup';

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
  startCall: (phone: string, lineId?: string) => request<TelephonyCallResponse>('/calls', {
    method: 'POST',
    body: JSON.stringify({ phone, ...(lineId ? { lineId } : {}) }),
  }),
  control: (callId: string, action: TelephonyControlAction, value?: string) => request<{ ok: boolean; provider: string; action: string }>(`/calls/${encodeURIComponent(callId)}/control`, {
    method: 'POST',
    body: JSON.stringify({ action, ...(value ? { value } : {}) }),
  }),
  transcribe: (callId: string) => request<TelephonyTranscriptionResponse>(`/calls/${encodeURIComponent(callId)}/transcribe`, {
    method: 'POST',
    body: '{}',
  }),
  webRtcKey: () => request<TelephonyWebRtcKeyResponse>('/webrtc-key'),
  test: () => request<{ ok: boolean; provider: string; balance?: unknown }>('/test', {
    method: 'POST',
    body: '{}',
  }),
};
