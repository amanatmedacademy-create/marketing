import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Delete,
  Headphones,
  Minus,
  PhoneCall,
  Search,
  Settings,
  Sparkles,
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
  if (!(error instanceof Error)) return String(error);
  try { return (JSON.parse(error.message) as { error?: string }).error || error.message; }
  catch { return error.message; }
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

type DialState = 'idle' | 'ready' | 'calling';

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
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerMinimized, setDialerMinimized] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);

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

  const filtered = useMemo(() => calls.filter((call) => {
    const matchesOperator = operator === 'Все операторы' || (call.operator_name || 'Не назначен') === operator;
    const haystack = [call.client_name, call.client_phone, call.operator_name, call.source, call.call_result, call.loss_reason, call.summary]
      .filter(Boolean).join(' ').toLowerCase();
    return matchesOperator && haystack.includes(query.trim().toLowerCase());
  }), [calls, operator, query]);

  const totals = useMemo(() => {
    const scoredCalls = calls.filter((call) => call.quality_score != null && Number.isFinite(Number(call.quality_score)));
    return {
      calls: calls.length,
      appointments: calls.filter((call) => call.appointment_created).length,
      averageScore: scoredCalls.length
        ? scoredCalls.reduce((sum, call) => sum + Number(call.quality_score), 0) / scoredCalls.length
        : null,
      scoredCalls: scoredCalls.length,
      noNextAction: calls.filter((call) => !call.next_action).length,
    };
  }, [calls]);

  const refreshCall = async (callId: string) => {
    const rows = await marketingApi.calls({ limit: 500 });
    setCalls(rows);
    const refreshed = rows.find((item) => item.id === callId) || null;
    setSelected(refreshed);
    return refreshed;
  };

  const analyzeCall = async (call: MarketingCall) => {
    if (analyzingId || transcribingId) return;
    setAnalyzingId(call.id);
    setAnalysisMessage(null);
    try {
      const response = await fetch(`/api/growth/calls/${encodeURIComponent(call.id)}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const raw = await response.text();
      let payload: { error?: string; call?: MarketingCall } = {};
      try { payload = raw ? JSON.parse(raw) as typeof payload : {}; } catch { payload = { error: raw }; }
      if (!response.ok || !payload.call) throw new Error(payload.error || `HTTP ${response.status}`);
      setCalls((items) => items.map((item) => item.id === call.id ? payload.call as MarketingCall : item));
      setSelected(payload.call);
      setAnalysisMessage(`AI-анализ завершён${payload.call.ai_confidence != null ? ` · уверенность ${Number(payload.call.ai_confidence).toFixed(0)}%` : ''}.`);
    } catch (reason) {
      setAnalysisMessage(errorText(reason));
    } finally {
      setAnalyzingId(null);
    }
  };

  const transcribeCall = async (call: MarketingCall) => {
    if (transcribingId || analyzingId) return;
    setTranscribingId(call.id);
    setAnalysisMessage(null);
    try {
      const result = await telephonyApi.transcribe(call.id);
      const refreshed = await refreshCall(call.id);
      if (result.analysisError) {
        setAnalysisMessage(`Расшифровка готова. AI-анализ не завершён: ${result.analysisError}`);
      } else if (result.analysisSkipped) {
        setAnalysisMessage(`Расшифровка готова. ${result.analysisSkipped}`);
      } else {
        setAnalysisMessage(`Расшифровка и AI-анализ завершены${refreshed?.ai_confidence != null ? ` · уверенность ${Number(refreshed.ai_confidence).toFixed(0)}%` : ''}.`);
      }
    } catch (reason) {
      setAnalysisMessage(errorText(reason));
      await refreshCall(call.id).catch(() => null);
    } finally {
      setTranscribingId(null);
    }
  };

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
      setDialMessage('Zadarma не настроена для выбранной клиники. Подключите её в разделе «Интеграции».');
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

  const selectForDial = (call: MarketingCall) => {
    setSelected(call);
    openDialer(call.client_phone || '');
  };

  const filtersActive = Boolean(query.trim()) || operator !== 'Все операторы';

  return <div className="calls-page">
    <div className="calls-heading">
      <div><span>QUALITY CONTROL</span><h1>Звонки</h1><p>Внутренняя телефония, история разговоров и контроль качества.</p></div>
      <div className="calls-heading-actions">
        <button type="button" className="calls-open-dialer" onClick={() => openDialer()}><PhoneCall/> Звонилка</button>
        <div className="calls-filters">
          <label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, телефон, оператор, причина"/></label>
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
        <article><Headphones/><span>Средняя оценка</span><strong>{totals.averageScore == null ? '—' : totals.averageScore.toFixed(1)}</strong><small>{totals.scoredCalls ? `из 100 · оценено ${totals.scoredCalls}` : 'Нет оценённых звонков'}</small></article>
        <article><Clock3/><span>Без следующего действия</span><strong>{number(totals.noNextAction)}</strong></article>
      </section>

      <section className="calls-layout">
        <div className="calls-list-panel">
          <header><strong>Звонки</strong><span>{filtersActive ? `${filtered.length} из ${calls.length}` : filtered.length}</span></header>
          <div className="calls-list">
            {filtered.length === 0 && <div className="calls-empty">Нет звонков по выбранным фильтрам.</div>}
            {filtered.map((call) => <button type="button" key={call.id} className={selected?.id === call.id ? 'active' : ''} onClick={() => { setSelected(call); setAnalysisMessage(null); }} onDoubleClick={() => selectForDial(call)}>
              <div><strong>{call.client_name || call.client_phone || 'Клиент не указан'}</strong><span>{call.client_name && call.client_phone ? call.client_phone : call.operator_name || 'Оператор не назначен'}</span></div>
              <div><b>{call.quality_score == null ? '—' : Number(call.quality_score).toFixed(0)}</b><small>{duration(call.duration_seconds)}</small></div>
              <p>{call.summary || call.call_result || 'Нет резюме'}</p>
              <footer><span>{dateTime(call.started_at)}</span><em className={call.appointment_created ? 'success' : ''}>{call.appointment_created ? 'Записан' : call.loss_reason || (call.ai_analysis_status === 'completed' ? 'AI разобран' : call.transcription_status === 'completed' ? 'Расшифрован' : 'Без результата')}</em></footer>
            </button>)}
          </div>
        </div>

        <div className="call-detail">
          {!selected ? <div className="calls-empty">Выберите звонок.</div> : <>
            <header>
              <div><span>{dateTime(selected.started_at)}</span><h2>{selected.client_name || selected.client_phone || 'Клиент не указан'}</h2><p>{selected.client_name && selected.client_phone ? `${selected.client_phone} · ` : ''}{selected.operator_name || 'Оператор не назначен'} · {duration(selected.duration_seconds)}</p></div>
              <div className="call-detail-actions">
                <button type="button" disabled={!selected.client_phone} onClick={() => selectForDial(selected)}><PhoneCall/> Набрать</button>
                {!selected.transcript && <button
                  type="button"
                  disabled={transcribingId === selected.id || analyzingId === selected.id || selected.call_status !== 'COMPLETED' || !(selected.recording_url || selected.pbx_call_id || selected.recording_external_id)}
                  onClick={() => void transcribeCall(selected)}
                  title={selected.call_status !== 'COMPLETED'
                    ? 'Нужен завершённый звонок'
                    : !(selected.recording_url || selected.pbx_call_id || selected.recording_external_id)
                      ? 'Zadarma ещё не передала идентификатор записи'
                      : 'Получить запись, расшифровать и запустить AI Call Intelligence'}
                ><Sparkles/> {transcribingId === selected.id ? 'Расшифровка…' : 'Транскрибировать + AI'}</button>}
                {selected.transcript && <button type="button" disabled={analyzingId === selected.id || transcribingId === selected.id || selected.call_status !== 'COMPLETED'} onClick={() => void analyzeCall(selected)} title={selected.call_status !== 'COMPLETED' ? 'Нужен завершённый звонок' : 'Запустить AI Call Intelligence'}><Sparkles/> {analyzingId === selected.id ? 'Анализ…' : selected.ai_analysis_status === 'completed' ? 'Переанализировать' : 'AI анализ'}</button>}
                <strong>{selected.quality_score == null ? '—' : `${Number(selected.quality_score).toFixed(0)}/100`}</strong>
              </div>
            </header>
            {analysisMessage && <div className={selected.ai_analysis_status === 'completed' || selected.transcription_status === 'completed' ? 'calls-state' : 'calls-state calls-state--error'}>{analysisMessage}</div>}
            {selected.transcription_status === 'failed' && selected.transcription_error && <div className="calls-state calls-state--error">Транскрипция: {selected.transcription_error}</div>}
            {selected.ai_analysis_status === 'failed' && selected.ai_analysis_error && <div className="calls-state calls-state--error">AI: {selected.ai_analysis_error}</div>}
            {(selected.recording_url || selected.pbx_call_id || selected.recording_external_id) && selected.call_status === 'COMPLETED' && <audio controls preload="none" src={`/api/telephony/calls/${encodeURIComponent(selected.id)}/recording`}/>} 
            <section className="call-chain"><span>{selected.source || 'Источник не указан'}</span><i>→</i><span>{selected.campaign_id || 'Кампания не указана'}</span><i>→</i><span>{selected.ad_id || 'Объявление не указано'}</span><i>→</i><span>{selected.appointment_created ? 'Запись' : 'Без записи'}</span></section>
            <div className="call-detail-grid">
              <section><h3>Результат</h3><dl><div><dt>Итог</dt><dd>{selected.call_result || '—'}</dd></div><div><dt>Следующее действие</dt><dd>{selected.next_action || '—'}</dd></div><div><dt>Причина потери</dt><dd>{selected.loss_reason || '—'}</dd></div><div><dt>Дата записи</dt><dd>{dateTime(selected.appointment_at)}</dd></div></dl></section>
              <section><h3>Содержание</h3><dl><div><dt>Причина обращения</dt><dd>{selected.request_reason || '—'}</dd></div><div><dt>Боль пациента</dt><dd>{selected.patient_pain || '—'}</dd></div><div><dt>Возражения</dt><dd>{selected.objections?.length ? selected.objections.join(', ') : '—'}</dd></div><div><dt>Резюме</dt><dd>{selected.summary || '—'}</dd></div></dl></section>
            </div>
            <section className="call-quality"><h3>Контроль качества{selected.ai_analysis_status === 'completed' ? ` · AI ${selected.ai_confidence == null ? '' : `${Number(selected.ai_confidence).toFixed(0)}%`}` : ''}</h3><div><label>Выявил боль {yesNo(selected.detected_pain)}</label><label>Задал вопросы {yesNo(selected.asked_questions)}</label><label>Презентовал ценность {yesNo(selected.presented_value)}</label><label>Отработал возражение {yesNo(selected.handled_objection)}</label><label>Предложил время {yesNo(selected.offered_specific_time)}</label><label>Подтвердил запись {yesNo(selected.confirmed_appointment)}</label><label>Назвал следующий шаг {yesNo(selected.stated_next_step)}</label><label>Запланировал дожим {yesNo(selected.follow_up_planned)}</label></div></section>
            <section className="call-text"><h3>Нарушения</h3><p>{selected.script_violations?.length ? selected.script_violations.join(' · ') : 'Нарушений не зафиксировано'}</p></section>
            <section className="call-text"><h3>Расшифровка</h3><p>{selected.transcript || (selected.transcription_status === 'processing' ? 'Расшифровка выполняется…' : 'Расшифровка отсутствует')}</p></section>
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
        <select className="phone-line-select" aria-label="Исходящая линия" value={telephony?.configured ? 'zadarma' : 'not-connected'} disabled>
          {telephony?.configured
            ? <option value="zadarma">Zadarma · линия {telephony.extension}</option>
            : <option value="not-connected">Линия не подключена</option>}
        </select>

        <div className="phone-number-screen">
          <small>{dialState === 'calling' ? 'Отправляем callback…' : 'Введите номер'}</small>
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
          <button type="button" onClick={removeDigit} disabled={!dialNumber || dialState === 'calling'} title="Удалить цифру"><Delete/></button>
        </div>

        <div className="phone-keypad">{keypad.map(([digit, letters]) => <button type="button" key={digit} disabled={dialState === 'calling'} onClick={() => appendDigit(digit)}><strong>{digit}</strong>{letters && <small>{letters}</small>}</button>)}</div>

        <div className="phone-call-controls">
          <button type="button" className="phone-start-call" disabled={dialState === 'idle' || dialState === 'calling'} onClick={() => void startCall()} title="Отправить callback через Zadarma"><PhoneCall/></button>
          <a className="phone-settings" href="/integrations" title="Настройки телефонии"><Settings/></a>
        </div>

        <div className="phone-call-status"><span>{dialState === 'calling' ? 'Запрос в Zadarma' : dialNumber ? formatPhone(normalizePhone(dialNumber)) : 'Номер не выбран'}</span><small>{telephony?.configured ? `Callback · линия ${telephony.extension}` : 'Телефония не настроена для выбранной клиники'}</small></div>

        {dialMessage && <div className="phone-dialer-message"><span>{dialMessage}</span>{!telephony?.configured && <a href="/integrations">Подключить</a>}</div>}

        <div className="phone-recent-numbers">
          <header><strong>Недавние</strong><span>{Math.min(calls.length, 3)}</span></header>
          {calls.slice(0, 3).map((call) => <button type="button" key={call.id} disabled={!call.client_phone} onClick={() => openDialer(call.client_phone)}><span>{call.client_name || call.client_phone || 'Без контакта'}</span><small>{call.client_name && call.client_phone ? call.client_phone : call.operator_name || 'Не назначен'}</small></button>)}
          {!calls.length && <p>История пока пуста.</p>}
        </div>
      </div>}
    </section>}
  </div>;
}