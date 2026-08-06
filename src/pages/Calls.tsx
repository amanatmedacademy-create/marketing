import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Headphones, PhoneCall, Search, XCircle } from 'lucide-react';
import { marketingApi, type MarketingCall, type MarketingCallOperatorSummary } from '../services/api';
import '../calls.css';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const clientName = (call: MarketingCall) => call.client_name?.trim() || 'Без имени';
const clientPhone = (call: MarketingCall) => call.client_phone?.trim() || 'Телефон не указан';

function yesNo(value?: boolean | null) {
  if (value === true) return <span className="call-check call-check--yes"><CheckCircle2 size={14}/> Да</span>;
  if (value === false) return <span className="call-check call-check--no"><XCircle size={14}/> Нет</span>;
  return <span className="call-check">—</span>;
}

export default function Calls() {
  const [calls, setCalls] = useState<MarketingCall[]>([]);
  const [operators, setOperators] = useState<MarketingCallOperatorSummary[]>([]);
  const [selected, setSelected] = useState<MarketingCall | null>(null);
  const [query, setQuery] = useState('');
  const [operator, setOperator] = useState('Все операторы');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => calls.filter((call) => {
    const matchesOperator = operator === 'Все операторы' || (call.operator_name || 'Не назначен') === operator;
    const haystack = [
      call.client_name,
      call.client_phone,
      call.operator_name,
      call.source,
      call.call_result,
      call.loss_reason,
      call.summary,
    ].filter(Boolean).join(' ').toLowerCase();
    return matchesOperator && haystack.includes(query.trim().toLowerCase());
  }), [calls, operator, query]);

  const totals = useMemo(() => ({
    calls: calls.length,
    appointments: calls.filter((call) => call.appointment_created).length,
    averageScore: calls.length ? calls.reduce((sum, call) => sum + Number(call.quality_score || 0), 0) / calls.length : 0,
    noNextAction: calls.filter((call) => !call.next_action).length,
  }), [calls]);

  return <div className="calls-page">
    <div className="calls-heading">
      <div><span>QUALITY CONTROL</span><h1>Звонки</h1><p>Только данные, влияющие на запись, приход и продажу.</p></div>
      <div className="calls-filters">
        <label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, телефон, оператор, причина"/></label>
        <select value={operator} onChange={(event) => setOperator(event.target.value)}><option>Все операторы</option>{operators.map((row) => <option key={row.operator_name}>{row.operator_name}</option>)}</select>
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
            {filtered.map((call) => <button type="button" key={call.id} className={selected?.id === call.id ? 'active' : ''} onClick={() => setSelected(call)}>
              <div><strong>{clientName(call)}</strong><span>{clientPhone(call)}</span></div>
              <div><span>{call.operator_name || 'Оператор не назначен'}</span><div><b>{call.quality_score == null ? '—' : Number(call.quality_score).toFixed(0)}</b><small>{duration(call.duration_seconds)}</small></div></div>
              <p>{call.summary || call.call_result || call.next_action || 'Нет резюме'}</p>
              <footer><span>{dateTime(call.scheduled_at || call.started_at)}</span><em className={call.appointment_created ? 'success' : ''}>{call.appointment_created ? 'Записан' : call.call_result || call.loss_reason || 'Без результата'}</em></footer>
            </button>)}
          </div>
        </div>

        <div className="call-detail">
          {!selected ? <div className="calls-empty">Выберите звонок.</div> : <>
            <header><div><span>{dateTime(selected.scheduled_at || selected.started_at)}</span><h2>{clientName(selected)}</h2><p>{clientPhone(selected)} · {selected.operator_name || 'Оператор не назначен'} · {duration(selected.duration_seconds)}</p></div><strong>{selected.quality_score == null ? '—' : `${Number(selected.quality_score).toFixed(0)}/100`}</strong></header>
            {selected.recording_url && <audio controls preload="none" src={selected.recording_url}/>} 
            <section className="call-chain"><span>{selected.source || 'Источник не указан'}</span><i>→</i><span>{selected.channel || 'Канал не указан'}</span><i>→</i><span>{selected.campaign_id || 'Кампания'}</span><i>→</i><span>{selected.appointment_created ? 'Запись' : selected.call_result || 'Без записи'}</span></section>
            <div className="call-detail-grid">
              <section><h3>Клиент и результат</h3><dl><div><dt>Имя клиента</dt><dd>{clientName(selected)}</dd></div><div><dt>Номер телефона</dt><dd>{clientPhone(selected)}</dd></div><div><dt>Итог</dt><dd>{selected.call_result || '—'}</dd></div><div><dt>Следующее действие</dt><dd>{selected.next_action || '—'}</dd></div><div><dt>Причина потери</dt><dd>{selected.loss_reason || '—'}</dd></div><div><dt>Дата записи</dt><dd>{dateTime(selected.appointment_at)}</dd></div></dl></section>
              <section><h3>Содержание</h3><dl><div><dt>Причина обращения</dt><dd>{selected.request_reason || '—'}</dd></div><div><dt>Боль пациента</dt><dd>{selected.patient_pain || '—'}</dd></div><div><dt>Возражения</dt><dd>{selected.objections?.length ? selected.objections.join(', ') : '—'}</dd></div><div><dt>Резюме</dt><dd>{selected.summary || '—'}</dd></div></dl></section>
            </div>
            <section className="call-quality"><h3>Контроль качества</h3><div><label>Выявил боль {yesNo(selected.detected_pain)}</label><label>Задал вопросы {yesNo(selected.asked_questions)}</label><label>Презентовал ценность {yesNo(selected.presented_value)}</label><label>Отработал возражение {yesNo(selected.handled_objection)}</label><label>Предложил время {yesNo(selected.offered_specific_time)}</label><label>Подтвердил запись {yesNo(selected.confirmed_appointment)}</label><label>Назвал следующий шаг {yesNo(selected.stated_next_step)}</label><label>Запланировал дожим {yesNo(selected.follow_up_planned)}</label></div></section>
            <section className="call-text"><h3>Нарушения</h3><p>{selected.script_violations?.length ? selected.script_violations.join(' · ') : 'Нарушений не зафиксировано'}</p></section>
            <section className="call-text"><h3>Расшифровка</h3><p>{selected.transcript || 'Расшифровка отсутствует'}</p></section>
          </>}
        </div>
      </section>
    </>}
  </div>;
}
