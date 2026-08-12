import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Delete, PhoneCall, RefreshCw, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { telephonyApi, type TelephonyLine, type TelephonyStatus } from '../services/telephony';

const keypad = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
] as const;

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits ? `+${digits.slice(0, 15)}` : '';
}

function editablePhone(value: string): string {
  const cleaned = value.replace(/[^\d+()\-\s]/g, '').slice(0, 24);
  const leadingPlus = cleaned.trimStart().startsWith('+');
  return `${leadingPlus ? '+' : ''}${cleaned.replace(/\+/g, '')}`;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('7')) return value;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

function providerLabel(provider?: string | null): string {
  if (!provider) return 'Телефония';
  const labels: Record<string, string> = { zadarma: 'Zadarma', binotel: 'Binotel', asterisk: 'Asterisk', sip: 'SIP' };
  return labels[provider.toLowerCase()] || provider;
}

function fallbackLines(status: TelephonyStatus | null): TelephonyLine[] {
  if (!status?.configured) return [];
  if (status.lines?.length) return status.lines;
  return [{
    id: status.extension || status.provider || 'default',
    name: status.extension ? `Линия ${status.extension}` : 'Основная линия',
    provider: status.provider,
    extension: status.extension,
    mode: status.mode,
    configured: true,
  }];
}

export default function TelephonyDialer() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<TelephonyStatus | null>(null);
  const [selectedLine, setSelectedLine] = useState('');
  const [phone, setPhone] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [message, setMessage] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    try {
      const next = await telephonyApi.status();
      setStatus(next);
      const lines = fallbackLines(next);
      setSelectedLine((current) => lines.some((line) => line.id === current) ? current : lines[0]?.id || '');
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
    setPhone(normalized ? formatPhone(normalized) : editablePhone(contextualPhone));
    setMessage('Номер подставлен из CRM-сделки.');
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.telephony-dialer__number input')?.focus());
  }, [params]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ phone?: string }>).detail;
      const next = detail?.phone || '';
      if (!next) return;
      const normalized = normalizePhone(next);
      setPhone(normalized ? formatPhone(normalized) : editablePhone(next));
      setMessage('');
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('.telephony-dialer__number input')?.focus();
      });
    };
    window.addEventListener('imds:telephony-dial', handler);
    return () => window.removeEventListener('imds:telephony-dial', handler);
  }, []);

  const lines = useMemo(() => fallbackLines(status), [status]);
  const currentLine = lines.find((line) => line.id === selectedLine) || lines[0] || null;
  const normalized = normalizePhone(phone);
  const canCall = normalized.replace(/\D/g, '').length >= 10 && Boolean(status?.configured) && !calling;

  const updatePhone = (value: string) => {
    setPhone(editablePhone(value));
    setMessage('');
  };

  const appendDigit = (digit: string) => {
    if (digit === '*' || digit === '#') return;
    const digits = phone.replace(/\D/g, '');
    updatePhone(`${digits ? '+' : ''}${digits}${digit}`);
  };

  const removeDigit = () => {
    const digits = phone.replace(/\D/g, '').slice(0, -1);
    updatePhone(digits ? `+${digits}` : '');
  };

  const startCall = async () => {
    if (!canCall) return;
    setCalling(true);
    setMessage('');
    try {
      const result = await telephonyApi.startCall(normalized, currentLine?.id);
      setPhone(formatPhone(normalized));
      setMessage(result.mode === 'callback'
        ? `Вызов отправлен. Ответьте на линии ${result.extension || currentLine?.extension || 'АТС'}, затем IMDS соединит с ${formatPhone(normalized)}.`
        : `Вызов на ${formatPhone(normalized)} запущен.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCalling(false);
    }
  };

  return <section className={`telephony-dialer ${expanded ? 'is-expanded' : ''}`} aria-label="Набор номера">
    <div className="telephony-dialer__line">
      <div className={`telephony-dialer__dot ${status?.configured ? 'is-online' : ''}`} />
      <div>
        <span>Исходящая линия</span>
        <strong>{loading ? 'Проверяем…' : currentLine ? `${currentLine.name} · ${providerLabel(currentLine.provider)}` : 'Не подключена'}</strong>
      </div>
      <select aria-label="Исходящая линия" value={selectedLine} onChange={(event) => setSelectedLine(event.target.value)} disabled={lines.length < 2}>
        {!lines.length && <option value="">Линия не подключена</option>}
        {lines.map((line) => <option key={line.id} value={line.id}>{line.name} · {providerLabel(line.provider)}</option>)}
      </select>
    </div>

    <div className="telephony-dialer__number">
      <span>Номер телефона</span>
      <div>
        <input
          inputMode="tel"
          autoComplete="tel"
          spellCheck={false}
          value={phone}
          onChange={(event) => updatePhone(event.target.value)}
          onBlur={() => normalized && setPhone(formatPhone(normalized))}
          onKeyDown={(event) => { if (event.key === 'Enter') void startCall(); }}
          placeholder="+7 701 000 00 00"
          aria-label="Номер телефона для звонка"
        />
        <button type="button" className="telephony-dialer__erase" onClick={removeDigit} disabled={!phone || calling} title="Удалить цифру"><Delete size={17}/></button>
      </div>
    </div>

    <button type="button" className="telephony-dialer__keypad-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span>Клавиатура</span><ChevronDown size={17}/>
    </button>

    <button type="button" className="telephony-dialer__call" disabled={!canCall} onClick={() => void startCall()}>
      {calling ? <RefreshCw className="spin" size={19}/> : <PhoneCall size={19}/>}<span>{calling ? 'Соединяем…' : 'Позвонить'}</span>
    </button>

    <a className="telephony-dialer__settings" href="/integrations" title="Настройки телефонии"><Settings2 size={18}/></a>

    {expanded && <div className="telephony-dialer__keypad">
      {keypad.map(([digit, letters]) => <button key={digit} type="button" onClick={() => appendDigit(digit)} disabled={calling}><strong>{digit}</strong>{letters && <small>{letters}</small>}</button>)}
    </div>}

    {message && <div className="telephony-dialer__message">{message}</div>}
  </section>;
}
