import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Clock3, Headphones, PhoneCall, RefreshCw, UserRoundCheck, UsersRound } from 'lucide-react';
import { marketingApi, type MarketingCall, type MarketingCallOperatorSummary } from '../services/api';

type Mode = 'supervisor' | 'analytics';

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function TelephonyManagementWorkspace({ mode }: { mode: Mode }) {
  const [calls, setCalls] = useState<MarketingCall[]>([]);
  const [operators, setOperators] = useState<MarketingCallOperatorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextCalls, nextOperators] = await Promise.all([
        marketingApi.calls({ limit: 500 }),
        marketingApi.callOperators(),
      ]);
      setCalls(nextCalls);
      setOperators(nextOperators);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => {
    const scored = calls.filter((call) => call.quality_score != null && Number.isFinite(Number(call.quality_score)));
    const completed = calls.filter((call) => call.call_status === 'COMPLETED');
    const appointments = calls.filter((call) => call.appointment_created);
    const followUps = calls.filter((call) => Boolean(call.next_action));
    const averageQuality = scored.length ? scored.reduce((sum, call) => sum + Number(call.quality_score), 0) / scored.length : null;
    const averageDuration = completed.length ? completed.reduce((sum, call) => sum + Number(call.duration_seconds || 0), 0) / completed.length : 0;
    return { completed: completed.length, appointments: appointments.length, followUps: followUps.length, averageQuality, averageDuration };
  }, [calls]);

  const recent = useMemo(() => [...calls].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()).slice(0, 12), [calls]);
  const sortedOperators = useMemo(() => [...operators].sort((a, b) => b.calls - a.calls), [operators]);

  return <section className={`telephony-management telephony-management--${mode}`}>
    <header className="telephony-management__head">
      <div>
        {mode === 'supervisor' ? <Headphones size={18}/> : <BarChart3 size={18}/>} 
        <div><strong>{mode === 'supervisor' ? 'Supervisor' : 'Аналитика телефонии'}</strong><small>{mode === 'supervisor' ? 'Контроль операторов и текущей нагрузки' : 'Фактические показатели звонков и качества'}</small></div>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/>Обновить</button>
    </header>

    {error && <div className="telephony-management__state telephony-management__state--error">{error}</div>}
    {loading && !calls.length ? <div className="telephony-management__state">Загружаем данные телефонии…</div> : <>
      <div className="telephony-management__kpis">
        <article><PhoneCall/><span>Звонки</span><strong>{number(calls.length)}</strong></article>
        <article><CheckCircle2/><span>Завершено</span><strong>{number(totals.completed)}</strong></article>
        <article><UserRoundCheck/><span>Записи</span><strong>{number(totals.appointments)}</strong><small>{percent(totals.appointments, totals.completed || calls.length)}</small></article>
        <article><Clock3/><span>Средняя длительность</span><strong>{Math.floor(totals.averageDuration / 60)}:{String(Math.round(totals.averageDuration) % 60).padStart(2, '0')}</strong></article>
        <article><BarChart3/><span>Средняя оценка</span><strong>{totals.averageQuality == null ? '—' : totals.averageQuality.toFixed(1)}</strong><small>{totals.averageQuality == null ? 'Нет оценённых звонков' : 'из 100'}</small></article>
      </div>

      {mode === 'supervisor' ? <div className="telephony-management__grid">
        <section className="telephony-management__panel">
          <header><UsersRound size={16}/><strong>Операторы</strong><span>{operators.length}</span></header>
          <div className="telephony-management__table">
            <div className="telephony-management__tr telephony-management__tr--head"><span>Оператор</span><span>Звонки</span><span>Записи</span><span>Качество</span><span>Без next action</span></div>
            {sortedOperators.map((operator) => <div className="telephony-management__tr" key={operator.operator_name}>
              <strong>{operator.operator_name || 'Не назначен'}</strong>
              <span>{number(operator.calls)}</span>
              <span>{number(operator.appointments)}</span>
              <span>{operator.average_quality_score == null ? '—' : Number(operator.average_quality_score).toFixed(1)}</span>
              <span>{number(operator.calls_without_next_action)}</span>
            </div>)}
            {!operators.length && <div className="telephony-management__empty">Нет данных по операторам.</div>}
          </div>
        </section>
        <section className="telephony-management__panel">
          <header><PhoneCall size={16}/><strong>Последние звонки</strong></header>
          <div className="telephony-management__recent">
            {recent.map((call) => <article key={call.id}><div><strong>{call.client_name || call.client_phone || 'Клиент'}</strong><small>{call.operator_name || 'Не назначен'} · {dateTime(call.started_at)}</small></div><span>{call.call_status || '—'}</span></article>)}
            {!recent.length && <div className="telephony-management__empty">История звонков пока пуста.</div>}
          </div>
        </section>
      </div> : <div className="telephony-management__grid telephony-management__grid--analytics">
        <section className="telephony-management__panel">
          <header><BarChart3 size={16}/><strong>Конверсия звонков</strong></header>
          <div className="telephony-management__analytics-list">
            <div><span>Запись после звонка</span><strong>{percent(totals.appointments, totals.completed || calls.length)}</strong></div>
            <div><span>Есть следующий шаг</span><strong>{percent(totals.followUps, calls.length)}</strong></div>
            <div><span>Звонки с AI-оценкой</span><strong>{percent(calls.filter((call) => call.quality_score != null).length, calls.length)}</strong></div>
            <div><span>Завершённые звонки</span><strong>{percent(totals.completed, calls.length)}</strong></div>
          </div>
        </section>
        <section className="telephony-management__panel">
          <header><UsersRound size={16}/><strong>Эффективность операторов</strong></header>
          <div className="telephony-management__operator-bars">
            {sortedOperators.slice(0, 10).map((operator) => <div key={operator.operator_name}><div><span>{operator.operator_name || 'Не назначен'}</span><strong>{number(operator.calls)} звонков</strong></div><progress max={Math.max(1, sortedOperators[0]?.calls || 1)} value={operator.calls}/></div>)}
            {!operators.length && <div className="telephony-management__empty">Нет данных для аналитики.</div>}
          </div>
        </section>
      </div>}
    </>}
  </section>;
}
