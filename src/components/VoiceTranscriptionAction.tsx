import { useState } from 'react';
import type { ChatMessage } from '../services/callCenterChat';
import '../voice-transcription.css';

type Props = { message: ChatMessage };

type TranscriptResponse = {
  transcript?: string;
  error?: string;
  cached?: boolean;
};

function isAudio(message: ChatMessage) {
  const mime = String(message.attachmentMimeType || '').toLowerCase();
  const name = String(message.attachmentName || '').toLowerCase();
  return mime.startsWith('audio/') || /\.(ogg|opus|mp3|m4a|wav|webm)$/.test(name);
}

export default function VoiceTranscriptionAction({ message }: Props) {
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  if (!message.hasAttachment || !isAudio(message)) return null;

  const transcribe = async () => {
    if (transcript) {
      setOpen((value) => !value);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/callcenter/messages/${encodeURIComponent(message.id)}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await response.text();
      let payload: TranscriptResponse = {};
      try { payload = body ? JSON.parse(body) as TranscriptResponse : {}; } catch { payload = { error: body }; }
      if (!response.ok || !payload.transcript) throw new Error(payload.error || `HTTP ${response.status}`);
      setTranscript(payload.transcript);
      setOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return <div className="voice-transcription">
    <button type="button" onClick={() => void transcribe()} disabled={loading}>
      {loading ? 'Расшифровываем…' : transcript ? (open ? 'Скрыть расшифровку' : 'Показать расшифровку') : error ? 'Повторить расшифровку' : 'Расшифровать голосовое'}
    </button>
    {open && (transcript || error) && <div className={error ? 'voice-transcription-result error' : 'voice-transcription-result'}>{error || transcript}</div>}
  </div>;
}
