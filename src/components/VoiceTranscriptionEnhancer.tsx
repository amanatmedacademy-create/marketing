import { useEffect } from 'react';

const BUTTON_CLASS = 'voice-transcription-trigger';
const RESULT_CLASS = 'voice-transcription-result';
const STYLE_ID = 'voice-transcription-enhancer-styles';

function messageIdFromAttachment(link: HTMLAnchorElement): string {
  const match = link.getAttribute('href')?.match(/\/api\/callcenter\/attachments\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function isAudioAttachment(link: HTMLAnchorElement): boolean {
  const small = link.querySelector('small')?.textContent?.toLowerCase() || '';
  return small.includes('audio/') || /\.(ogg|opus|mp3|m4a|wav|webm)(?:\s|$)/i.test(link.textContent || '');
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .voice-transcription-wrap{margin-top:8px;display:flex;flex-direction:column;gap:7px;align-items:flex-start}
    .${BUTTON_CLASS}{border:0;border-radius:8px;padding:7px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;background:rgba(37,99,235,.12);color:#1d4ed8}
    .${BUTTON_CLASS}:hover{background:rgba(37,99,235,.18)}
    .${BUTTON_CLASS}:disabled{cursor:wait;opacity:.65}
    .${RESULT_CLASS}{max-width:100%;white-space:pre-wrap;background:rgba(15,23,42,.06);border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.45;color:inherit}
    .${RESULT_CLASS}[data-error="true"]{background:rgba(220,38,38,.08);color:#b91c1c}
  `;
  document.head.appendChild(style);
}

async function transcribe(button: HTMLButtonElement, messageId: string, result: HTMLDivElement) {
  button.disabled = true;
  button.textContent = 'Расшифровываем…';
  result.hidden = true;
  result.dataset.error = 'false';
  try {
    const response = await fetch(`/api/callcenter/messages/${encodeURIComponent(messageId)}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await response.text();
    let payload: { transcript?: string; error?: string; cached?: boolean } = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: body }; }
    if (!response.ok || !payload.transcript) throw new Error(payload.error || `HTTP ${response.status}`);
    result.textContent = payload.transcript;
    result.hidden = false;
    button.textContent = payload.cached ? 'Показать расшифровку' : 'Расшифровано';
    button.disabled = false;
    button.onclick = () => { result.hidden = !result.hidden; };
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
    result.dataset.error = 'true';
    result.hidden = false;
    button.textContent = 'Повторить расшифровку';
    button.disabled = false;
  }
}

function enhanceAudioMessages() {
  document.querySelectorAll<HTMLAnchorElement>('.inbox-message .inbox-attachment').forEach((link) => {
    if (link.dataset.voiceTranscriptionReady === 'true' || !isAudioAttachment(link)) return;
    const messageId = messageIdFromAttachment(link);
    if (!messageId) return;

    const wrap = document.createElement('div');
    wrap.className = 'voice-transcription-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = 'Расшифровать голосовое';
    const result = document.createElement('div');
    result.className = RESULT_CLASS;
    result.hidden = true;
    button.onclick = () => void transcribe(button, messageId, result);
    wrap.append(button, result);
    link.insertAdjacentElement('afterend', wrap);
    link.dataset.voiceTranscriptionReady = 'true';
  });
}

export default function VoiceTranscriptionEnhancer() {
  useEffect(() => {
    ensureStyles();
    enhanceAudioMessages();
    const observer = new MutationObserver(enhanceAudioMessages);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
