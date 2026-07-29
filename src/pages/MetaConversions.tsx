import { Activity, AlertTriangle, DatabaseZap, FlaskConical, ListChecks, Send, Settings2, ShieldCheck } from 'lucide-react';

const sections = [
  { title: 'Обзор', text: 'Состояние Dataset, токена, очереди и качества передачи.', icon: Activity },
  { title: 'События', text: 'Lead, Contact, QualifiedLead, Schedule, Purchase и пользовательские события.', icon: Send },
  { title: 'Правила событий', text: 'Связь стадий CRM и МИС с событиями Meta без изменения кода.', icon: ListChecks },
  { title: 'Очередь', text: 'Повторные отправки, идемпотентность и Dead Letter Queue.', icon: DatabaseZap },
  { title: 'Диагностика', text: 'Ошибки Graph API, дубли, задержки и качество идентификаторов.', icon: AlertTriangle },
  { title: 'Тестовые события', text: 'Проверка payload через Meta Test Events до запуска в production.', icon: FlaskConical },
  { title: 'Конфиденциальность', text: 'Фильтрация медицинских и чувствительных данных перед отправкой.', icon: ShieldCheck },
  { title: 'Настройки', text: 'Dataset ID, Pixel ID, токены, Graph API и маршрутизация филиалов.', icon: Settings2 },
] as const;

const plannedEvents = [
  ['Lead', 'Новый лид создан', 'Запланировано'],
  ['Contact', 'С клиентом установлен контакт', 'Запланировано'],
  ['QualifiedLead', 'Лид квалифицирован', 'Запланировано'],
  ['Schedule', 'Пациент записан на приём', 'Запланировано'],
  ['AppointmentArrived', 'Пациент пришёл в клинику', 'Custom event'],
  ['Purchase', 'Подтверждена оплата курса', 'Запланировано'],
] as const;

export default function MetaConversions() {
  return <div className="stack">
    <div className="heading">
      <span>Meta Conversions API</span>
      <h1>Серверные конверсии Meta</h1>
      <p>Отдельный модуль для web-, CRM-, офлайн- и messaging-событий. Сейчас создан каркас интерфейса; отправка в Meta ещё не включена.</p>
    </div>

    <div className="metrics">
      <article className="metric"><span>Режим</span><strong>Проектирование</strong><small>Production-отправка отключена</small></article>
      <article className="metric"><span>Dataset</span><strong>Не настроен</strong><small>Нужен Dataset или Pixel ID</small></article>
      <article className="metric"><span>Очередь</span><strong>0</strong><small>Таблицы событий ещё не созданы</small></article>
      <article className="metric"><span>Ошибки</span><strong>0</strong><small>Отправка ещё не запускалась</small></article>
    </div>

    <section className="panel">
      <h2>Разделы модуля</h2>
      <div className="cards">
        {sections.map(({ title, text, icon: Icon }) => <article className="integration" key={title}>
          <div><Icon size={22}/></div>
          <h2>{title}</h2>
          <p>{text}</p>
          <span className="badge">В разработке</span>
        </article>)}
      </div>
    </section>

    <section className="panel">
      <h2>Планируемая событийная воронка</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Событие</th><th>Триггер</th><th>Статус</th></tr></thead>
          <tbody>{plannedEvents.map(([eventName, trigger, status]) => <tr key={eventName}>
            <td><b>{eventName}</b></td>
            <td>{trigger}</td>
            <td><span className="badge">{status}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="panel">
      <h2>Следующий технический этап</h2>
      <p className="note">Создать универсальный Event Hub, таблицы Supabase, privacy filter, identity resolution, очередь, retry-механику и адаптер Meta Conversions API. До утверждения ТЗ реальные данные пациентов в Meta не отправляются.</p>
    </section>
  </div>;
}
