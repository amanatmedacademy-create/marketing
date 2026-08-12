import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRightLeft,
  ChevronDown,
  Circle,
  Grid3X3,
  MicOff,
  Pause,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { telephonyApi, type TelephonyLine, type TelephonyStatus } from '../services/telephony';

const keypad = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
] as const;

type ActiveCallDetail = {
  active: boolean;
  id?: string;
  name?: string;
  phone?: string;
  startedAt?: string;
};

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits ? `+${digits.slice(0, 15)}` : '';
}

function editableTarget(value: string): string {
  return value.replace(/[^\p{L}\d+()\-\s.]/gu, '').slice(0, 80);
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('7')) return value;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

function fallbackLines(status: TelephonyStatus | null): TelephonyLine[] {
  if (!status?.configured) return [];
  if (status.lines?.length) return status.lines;
  return [{
    id: status.extension || status.provider || 'default',
    name: status.extension ? `Линия ${status.extension}` : 'Основная',
    provider: status.provider,
    extension: status.extension,
    mode: status.mode,
    configured: true,
  }];
}

function elapsedLabel(startedAt?: string): string {
  if (!startedAt) return '00:00';
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '00:00';
  const total = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TelephonyDialer() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<TelephonyStatus | null>(null);
  const [selectedLine, setSelectedLine] = useState('');
  const [target, setTarget] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [message, setMessage] = useState('');
  const [activeCall, setActiveCall] = useState<ActiveCallDetail>({ active: false });
  const [, setClock] = useState(0);
  const keypadRef = useRef<HTMLDivElement>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const next = await telephonyApi.status();
      setStatus(next);
      const lines = fallbackLines(next);
      setSelectedLine((current) => lines.some((line) => line.id === current) ? current : lines[0]?.id || '');
      setMessage('');
    } catch (error) {
      setStatus(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  useEffect(() => {
    const contextualPhone = params.get('phone') || '';
    if (!contextualPhone) return;
    const normalized = normalizePhone(contextualPhone);
    setTarget(normalized ? formatPhone(normalized) : editableTarget(contextualPhone));
    setMessage('Номер подставлен из CRM-сделки.');
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.telephony-dialer__target')?.focus());
  }, [params]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ phone?: string }>).detail;
      const next = detail?.phone || '';
      if (!next) return;
      const normalized = normalizePhone(next);
      setTarget(normalized ? formatPhone(normalized) : editableTarget(next));
      setMessage('');
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('.telephony-dialer__target')?.focus();
      });
    };
    window.addEventListener('imds:telephony-dial', handler);
    return () => window.removeEventListener('imds:telephony-dial', handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => setActiveCall((event as CustomEvent<ActiveCallDetail>).detail || { active: false });
    window.addEventListener('imds:telephony-active-call', handler);
    return () => window.removeEventListener('imds:telephony-active-call', handler);
  }, []);

  useEffect(() => {
    if (!activeCall.active) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [activeCall.active]);

  useEffect(() => {
    if (!keypadOpen) return;
    const close = (event: MouseEvent) => {
      if (!keypadRef.current?.contains(event.target as Node)) setKeypadOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setKeypadOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [keypadOpen]);

  const lines = useMemo(() => fallbackLines(status), [status]);
  const currentLine = lines.find((line) => line.id === selectedLine) || lines[0] || null;
  const normalized = normalizePhone(target);
  const canCall = normalized.replace(/\D/g, '').length >= 10 && Boolean(status?.configured) && !calling;

  const appendDigit = (digit: string) => {
    if (digit === '*' || digit === '#') return;
    const digits = target.replace(/\D/g, '');
    setTarget(`${digits ? '+' : ''}${digits}${digit}`);
    setMessage('');
  };

  const startCall = async () => {
    if (!canCall) return;
    setCalling(true);
    setMessage('');
    try {
      const result = await telephonyApi.startCall(normalized, currentLine?.id);
      setTarget(formatPhone(normalized));
      setKeypadOpen(false);
      setMessage(result.mode === 'callback'
        ? `Вызов отправлен на линию ${currentLine?.name || result.extension || 'АТС'}.`
        : `Вызов на ${formatPhone(normalized)} запущен.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCalling(false);
    }
  };

  if (activeCall.active) {
    return <section className="telephony-active-bar" aria-label="Активный звонок">
      <div className="telephony-active-bar__identity">
        <span className="telephony-active-bar__timer"><i />{elapsedLabel(activeCall.startedAt)}</span>
        <div><strong>{activeCall.name || 'Активный звонок'}</strong><small>{formatPhone(activeCall.phone || '')}</small></div>
      </div>
      <div className="telephony-active-bar__controls" aria-label="Управление звонком">
        <button type="button" disabled title="Mute не поддерживается текущим backend"><MicOff size={16}/>Mute</button>
        <button type="button" disabled title="Hold не поддерживается текущим backend"><Pause size={16}/>Hold</button>
        <button type="button" disabled title="Transfer не поддерживается текущим backend"><ArrowRightLeft size={16}/>Transfer</button>
        <button type="button" disabled title="DTMF в активном звонке не поддерживается текущим backend"><Grid3X3 size={16}/>Keypad</button>
        <button type="button" disabled title="Управление записью не поддерживается текущим backend"><Circle size={15}/>Record</button>
        <button type="button" className="danger" disabled title="Завершение звонка из IMDS пока не поддерживается текущим backend"><PhoneOff size={16}/>Завершить</button>
      </div>
    </section>;
  }

  return <section className="telephony-dialer" aria-label="Набор номера">
    <div className="telephony-dialer__line-wrap">
      <span className={`telephony-dialer__dot ${status?.configured ? 'is-online' : ''}`} />
      <select
        aria-label="Исходящая линия"
        value={selectedLine}
        onChange={(event) => setSelectedLine(event.target.value)}
        disabled={lines.length < 2}
      >
        {!lines.length && <option value="">Не подключена</option>}
        {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
      </select>
      <ChevronDown size={14}/>
    </div>

    <input
      className="telephony-dialer__target"
      inputMode="tel"
      autoComplete="tel"
      spellCheck={false}
      value={target}
      onChange={(event) => { setTarget(editableTarget(event.target.value)); setMessage(''); }}
      onBlur={() => normalized && setTarget(formatPhone(normalized))}
      onKeyDown={(event) => { if (event.key === 'Enter') void startCall(); }}
      placeholder="Имя или номер телефона"
      aria-label="Имя или номер телефона"
    />

    <div className="telephony-dialer__keypad-anchor" ref={keypadRef}>
      <button type="button" className="telephony-dialer__icon-button" onClick={() => setKeypadOpen((value) => !value)} aria-expanded={keypadOpen} aria-label="Клавиатура"><Grid3X3 size={18}/></button>
      {keypadOpen && <div className="telephony-keypad-popover" role="dialog" aria-label="Цифровая клавиатура">
        {keypad.map(([digit, letters]) => <button key={digit} type="button" onClick={() => appendDigit(digit)} disabled={calling}>
          <strong>{digit}</strong>{letters && <small>{letters}</small>}
        </button>)}
      </div>}
    </div>

    <button type="button" className="telephony-dialer__call" disabled={!canCall} onClick={() => void startCall()}>
      {calling ? <RefreshCw className="spin" size={18}/> : <PhoneCall size={18}/>}<span>{calling ? 'Соединяем…' : 'Позвонить'}</span>
    </button>

    <a className="telephony-dialer__settings" href="/integrations" title="Настройки телефонии"><Settings2 size={17}/></a>
    {loading && <span className="telephony-dialer__loading">Проверяем линию…</span>}
    {message && <div className="telephony-dialer__message">{message}</div>}
  </section>;
}
