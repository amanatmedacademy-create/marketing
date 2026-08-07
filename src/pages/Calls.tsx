import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Delete,
  Headphones,
  Mic,
  MicOff,
  Minus,
  PhoneCall,
  PhoneOff,
  Search,
  Settings,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';
import { marketingApi, type MarketingCall, type MarketingCallOperatorSummary } from '../services/api';
import { telephonyApi, type TelephonyStatus } from '../services/telephony';
import '../calls.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits ? `+${digits.slice(0, 15)}` : '';
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('7')) return value;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

function editablePhone(value: string): string {
  const cleaned = value.replace(/[^\d+()\-\s]/g, '').slice(0, 24);
  const hasLeadingPlus = cleaned.trimStart().startsWith('+');
  const withoutExtraPlus = cleaned.replace(/\+/g, '');
  return `${hasLeadingPlus ? '+' : ''}${withoutExtraPlus}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function yesNo(value?: boolean | null) {
  if (value === true) return <span className="call-check call-check--yes"><CheckCircle2 size={14}/> Да</span>;
  if (value === false) return <span className="call-check call-check--no"><XCircle size={14}/> Нет</span>;
  return <span className="call-check">—</span>;
}

const keypad = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
] as const;

type DialState = 'idle' | 'ready' | 'calling' | 'active';

export default function Calls() {
  const [calls, setCalls] = useState<MarketingCall[]>([]);
  const [operators, setOperators] = useState<MarketingCallOperatorSummary[]>([]);
  const [selected, setSelected] = useState<MarketingCall | null>(null);
  const [query, setQuery] = useState('');
  const [operator, setOperator] = useState('Все операторы');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [telephony, setTelephony] = useState<TelephonyStatus | null>(null);
  const [dialNumber, setDialNumber] = useState('');
  const [dialState, setDialState] = useState<DialState>('idle');
  const [dialMessage, setDialMessage] = useState('');
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerMinimized, setDialerMinimized] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([marketingApi.calls({ limit: 500 }), marketingApi.callOperators()])
      .then(([callRows, operatorRows]) => {
        if (!active) return;
        setCalls(callRows);
        setOperators(operatorRows);
        setSelected(callRows[0] || null);
        setError(null);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'))
      .finally(() => active && setLoading(false));
    telephonyApi.status()
      .then((status) => { if (active) setTelephony(status); })
      .catch(() => { if (active) setTelephony(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (dialState !== 'active') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [dialState]);

  const filtered = useMemo(() => calls.filter((call) => {
    const matchesOperator = operator === 'Все операторы' || (call.operator_name || 'Не назначен') === operator;
    const haystack = [call.client_phone, call.operator_name, call.source, call.call_result, call.loss_reason, call.summary].filter(Boolean).join(' ').toLowerCase();
    return matchesOperator && haystack.includes(query.trim().toLowerCase());
  }), [calls, operator, query]);

  const totals = useMemo(() => ({
    calls: calls.length,
    appointments: calls.filter((call) => call.appointment_created).length,
    averageScore: calls.length ? calls.reduce((sum, call) => sum + Number(call.quality_score || 0), 0) / calls.length : 0,
    noNextAction: calls.filter((call) => !call.next_action).length,
  }), [calls]);

  const updateDialNumber = (value: string) => {
    const next = editablePhone(value);
    setDialNumber(next);
    setDialState(next.replace(/\D/g, '').length >= 10 ? 'ready' : 'idle');
    setDialMessage('');
  };

  const appendDigit = (digit: string) => {
    if (digit === '*' || digit === '#') return;
    const current = dialNumber.replace(/\D/g, '');
    updateDialNumber(`${current ? '+' : ''}${current}${digit}`);
  };

  const removeDigit = () => {
    const next = dialNumber.replace(/\D/g, '').slice(0, -1);
    updateDialNumber(next ? `+${next}` : '');
  };

  const openDialer = (phone?: string | null) => {
    if (phone) updateDialNumber(formatPhone(normalizePhone(phone)));
    else updateDialNumber('');
    setDialerOpen(true);
    setDialerMinimized(false);
  };

  const closeDialer = () => {
    setDialerOpen(false);
    setDialerMinimized(false);
    setDialMessage('');
  };

  const startCall = async () => {
    const normalized = normalizePhone(dialNumber);
    if (normalized.replace(/\D/g, '').length < 10) return;
    setDialNumber(formatPhone(normalized));
    if (!telephony?.configured) {
      setDialMessage('Zadarma пока не настроена. Добавьте API key, API secret и внутренний номер АТС в Cloudflare.');
      setDialState('ready');
      return;
    }
    setDialState('calling');
    setDialMessage('Отправляем вызов в Zadarma…');
    try {
      const result = await telephonyApi.startCall(normalized);
      setDialMessage(`Вызов отправлен. Ответьте на линии ${result.extension}, затем Zadarma соединит вас с ${formatPhone(normalized)}.`);
      setDialState('ready');
    } catch (reason) {
      setDialMessage(errorText(reason));
      setDialState('ready');
    }
  };

  const endCall = () => {
    setDialState('ready');
    setElapsed(0);
    setMuted(false);
  };

  const selectForDial = (call: MarketingCall) => {
    setSelected(call);
    openDialer(call.client_phone || '');
  };

  return <div className="calls-page">
    <div className="calls-heading">
      <div><span>QUALITY CONTROL</span><h1>Звонки</h1><p>Внутренняя телефония, история разговоров и контроль качества.</p></div>
      <div className="calls-heading-actions">
        <button type="button" className="calls-open-dialer" onClick={() => openDialer()}><PhoneCall/> Звонилка</button>
        <div className="calls-filters">
          <label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Телефон, оператор, причина"/></label>
          <select value={operator} onChange={(event) => setOperator(event.target.value)}><option>Все операторы</option>{operators.map((row) => <option key={row.operator_name}>{row.operator_name}</option>)}</select>
        </div>
      </div>
    </div>

    {loading && <div className="calls-state">Загружаем звонки…</div>}
    {error && <div className="calls-state calls-state--error">{error}</div>}
    {!loading && !error && <>
      <section className="calls-metrics">
        <article><PhoneCall/><span>Звонки</span><strong>{number(totals.calls)}</strong></article>
        <article><CheckCircle2/><span>Записи</span><strong>{number(totals.appointments)}</strong><small>{percent(totals.appointments, totals.calls)}</small></article>
        <article><Headphones/><span>Средняя оценка</span><strong>{totals.averageScore.toFixed(1)}</strong><small>из 100</small></article>
        <article><Clock3/><span>Без следующего действия</span><strong>{number(totals.noNextAction)}</strong></article>
      </section>

      <section className="calls-layout">
        <div className="calls-list-panel">
          <header><strong>Все звонки</strong><span>{filtered.length}</span></header>
          <div className="calls-list">
            {filtered.length === 0 && <div className="calls-empty">Нет звонков по выбранным фильтрам.</div>}
            {filtered.map((call) => <button type="button" key={call.id} className={selected?.id === call.id ? 'active' : ''} onClick={() => setSelected(call)} onDoubleClick={() => selectForDial(call)}>
              <div><strong>{call.client_phone || 'Телефон не указан'}</strong><span>{call.operator_name || 'Не назначен'}</span></div>
              <div><b>{call.quality_score == null ? '—' : Number(call.quality_score).toFixed(0)}</b><small>{duration(call.duration_seconds)}</small></div>
              <p>{call.summary || call.call_result || 'Нет резюме'}</p>
              <footer><span>{dateTime(call.started_at)}</span><em className={call.appointment_created ? 'success' : ''}>{call.appointment_created ? 'Записан' : call.loss_reason || 'Без результата'}</em></footer>
            </button>)}
          </div>
        </div>

        <div className="call-detail">
          {!selected ? <div className="calls-empty">Выберите звонок.</div> : <>
            <header><div><span>{dateTime(selected.started_at)}</span><h2>{selected.client_phone || 'Телефон не указан'}</h2><p>{selected.operator_name || 'Оператор не назначен'} · {duration(selected.duration_seconds)}</p></div><div className="call-detail-actions"><button type="button" onClick={() => selectForDial(selected)}><PhoneCall/> Набрать</button><strong>{selected.quality_score == null ? '—' : `${Number(selected.quality_score).toFixed(0)}/100`}</strong></div></header>
            {selected.recording_url && <audio controls preload="none" src={selected.recording_url}/>} 
            <section className="call-chain"><span>{selected.source || 'Источник не указан'}</span><i>→</i><span>{selected.campaign_id || 'Кампания'}</span><i>→</i><span>{selected.ad_id || 'Объявление'}</span><i>→</i><span>{selected.appointment_created ? 'Запись' : 'Без записи'}</span></section>
            <div className="call-detail-grid">
              <section><h3>Результат</h3><dl><div><dt>Итог</dt><dd>{selected.call_result || '—'}</dd></div><div><dt>Следующее действие</dt><dd>{selected.next_action || '—'}</dd></div><div><dt>Причина потери</dt><dd>{selected.loss_reason || '—'}</dd></div><div><dt>Дата записи</dt><dd>{dateTime(selected.appointment_at)}</dd></div></dl></section>
              <section><h3>Содержание</h3><dl><div><dt>Причина обращения</dt><dd>{selected.request_reason || '—'}</dd></div><div><dt>Боль пациента</dt><dd>{selected.patient_pain || '—'}</dd></div><div><dt>Возражения</dt><dd>{selected.objections?.length ? selected.objections.join(', ') : '—'}</dd></div><div><dt>Резюме</dt><dd>{selected.summary || '—'}</dd></div></dl></section>
            </div>
            <section className="call-quality"><h3>Контроль качества</h3><div><label>Выявил боль {yesNo(selected.detected_pain)}</label><label>Задал вопросы {yesNo(selected.asked_questions)}</label><label>Презентовал ценность {yesNo(selected.presented_value)}</label><label>Отработал возражение {yesNo(selected.handled_objection)}</label><label>Предложил время {yesNo(selected.offered_specific_time)}</label><label>Подтвердил запись {yesNo(selected.confirmed_appointment)}</label><label>Назвал следующий шаг {yesNo(selected.stated_next_step)}</label><label>Запланировал дожим {yesNo(selected.follow_up_planned)}</label></div></section>
            <section className="call-text"><h3>Нарушения</h3><p>{selected.script_violations?.length ? selected.script_violations.join(' · ') : 'Нарушений не зафиксировано'}</p></section>
            <section className="call-text"><h3>Расшифровка</h3><p>{selected.transcript || 'Расшифровка отсутствует'}</p></section>
          </>}
        </div>
      </section>
    </>}

    {dialerOpen && <section className={`phone-dialer-widget ${dialerMinimized ? 'minimized' : ''}`} aria-label="Телефонная звонилка">
      <header className="phone-dialer-header">
        <div className="phone-dialer-speaker" aria-hidden="true"/>
        <div><Smartphone/><span><strong>IMDS Phone</strong><small>{telephony?.configured ? 'Zadarma подключена' : 'Линия не настроена'}</small></span></div>
        <nav>
          <button type="button" title={dialerMinimized ? 'Развернуть' : 'Свернуть'} onClick={() => setDialerMinimized((value) => !value)}><Minus/></button>
          <button type="button" title="Закрыть" onClick={closeDialer}><X/></button>
        </nav>
      </header>

      {!dialerMinimized && <div className="phone-dialer-body">
        <select className="phone-line-select" aria-label="Исходящая линия" value={telephony?.configured ? 'zadarma' : 'not-connected'} readOnly>
          {telephony?.configured
            ? <option value="zadarma">Zadarma · линия {telephony.extension}</option>
            : <option value="not-connected">Линия не подключена</option>}
        </select>

        <div className="phone-number-screen">
          <small>{dialState === 'active' ? duration(elapsed) : dialState === 'calling' ? 'Отправляем вызов…' : 'Введите номер'}</small>
          <input
            inputMode="tel"
            autoComplete="tel"
            spellCheck={false}
            value={dialNumber}
            onChange={(event) => updateDialNumber(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => {
              const normalized = normalizePhone(dialNumber);
              if (normalized) setDialNumber(formatPhone(normalized));
            }}
            placeholder="+7 701 000 00 00"
            aria-label="Номер телефона"
          />
          <button type="button" onClick={removeDigit} disabled={!dialNumber} title="Удалить цифру"><Delete/></button>
        </div>

        <div className="phone-keypad">{keypad.map(([digit, letters]) => <button type="button" key={digit} onClick={() => appendDigit(digit)}><strong>{digit}</strong>{letters && <small>{letters}</small>}</button>)}</div>

        <div className="phone-call-controls">
          <button type="button" className="phone-mute" disabled={dialState !== 'active'} onClick={() => setMuted((value) => !value)} title="Микрофон">{muted ? <MicOff/> : <Mic/>}</button>
          {dialState !== 'active'
            ? <button type="button" className="phone-start-call" disabled={dialState === 'idle' || dialState === 'calling'} onClick={() => void startCall()} title="Позвонить"><PhoneCall/></button>
            : <button type="button" className="phone-end-call" onClick={endCall} title="Завершить"><PhoneOff/></button>}
          <a className="phone-settings" href="/integrations" title="Настройки телефонии"><Settings/></a>
        </div>

        <div className="phone-call-status"><span>{dialState === 'calling' ? 'Запрос в Zadarma' : dialNumber ? formatPhone(normalizePhone(dialNumber)) : 'Номер не выбран'}</span><small>{telephony?.configured ? `Callback · ${telephony.extension}` : 'Телефония не настроена'}</small></div>

        {dialMessage && <div className="phone-dialer-message"><span>{dialMessage}</span>{!telephony?.configured && <a href="/integrations">Подключить</a>}</div>}

        <div className="phone-recent-numbers">
          <header><strong>Недавние</strong><span>{Math.min(calls.length, 3)}</span></header>
          {calls.slice(0, 3).map((call) => <button type="button" key={call.id} onClick={() => openDialer(call.client_phone)}><span>{call.client_phone || 'Без номера'}</span><small>{call.operator_name || 'Не назначен'}</small></button>)}
          {!calls.length && <p>История пока пуста.</p>}
        </div>
      </div>}
    </section>}
  </div>;
}
