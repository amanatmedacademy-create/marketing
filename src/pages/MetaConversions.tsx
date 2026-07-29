import {
  Activity,
  AlertTriangle,
  DatabaseZap,
  FlaskConical,
  ListChecks,
  Network,
  Send,
  Settings2,
  ShieldCheck,
} from 'lucide-react';

const sections = [
  { title: 'Обзор', text: 'Состояние всех каналов, очереди, ошибок и качества передачи.', icon: Activity },
  { title: 'События', text: 'Единый журнал web-, CRM-, offline- и messaging-событий.', icon: Send },
  { title: 'Правила', text: 'Связь стадий CRM и МИС с событиями рекламных платформ без изменения кода.', icon: ListChecks },
  { title: 'Маршрутизация', text: 'Выбор рекламных систем, кабинетов и datasets для каждого события.', icon: Network },
  { title: 'Очередь', text: 'Идемпотентность, повторные отправки, backoff и Dead Letter Queue.', icon: DatabaseZap },
  { title: 'Диагностика', text: 'Ошибки API, дубли, задержки, токены и качество идентификаторов.', icon: AlertTriangle },
  { title: 'Тестирование', text: 'Shadow mode и тестовые события до включения production-отправки.', icon: FlaskConical },
  { title: 'Конфиденциальность', text: 'Фильтрация медицинских и чувствительных данных перед отправкой.', icon: ShieldCheck },
  { title: 'Настройки', text: 'Токены, Pixel/Dataset/Conversion IDs, OAuth и права доступа.', icon: Settings2 },
] as const;

const platforms = [
  ['Meta', 'Conversions API', 'fbp, fbc, event_id', 'Не настроено'],
  ['TikTok', 'Events API', 'ttclid, event_id', 'Не настроено'],
  ['Google Ads', 'Enhanced Conversions / Offline', 'gclid, gbraid, wbraid, order_id', 'Не настроено'],
  ['Microsoft Ads', 'Offline Conversions / CAPI', 'msclkid', 'Не настроено'],
  ['LinkedIn', 'Conversions API', 'conversion rule, event ID', 'Не настроено'],
  ['Snapchat', 'Conversions API', 'sc_click_id, event ID', 'Не настроено'],
  ['Pinterest', 'Conversions API', 'click ID, event ID', 'Не настроено'],
] as const;

const plannedEvents = [
  ['LeadCreated', 'Новый лид создан', 'Meta · TikTok · Google · Microsoft · LinkedIn'],
  ['LeadQualified', 'Лид признан целевым', 'Meta · TikTok · Google · Microsoft · LinkedIn'],
  ['AppointmentScheduled', 'Пациент записан на приём', 'Meta · TikTok · Google · Microsoft'],
  ['AppointmentArrived', 'Пациент пришёл в клинику', 'Offline conversion'],
  ['DepositPaid', 'Подтверждён задаток', 'По правилам платформы'],
  ['Purchase', 'Подтверждена оплата курса', 'Все подключённые платформы'],
  ['Refund', 'Полный или частичный возврат', 'Корректировка или внутренняя сверка'],
] as const;

export default function MetaConversions() {
  return <div className="stack">
    <div className="heading">
      <span>Marketing Conversion Hub</span>
      <h1>Серверные конверсии</h1>
      <p>Единый модуль передачи web-, CRM-, offline- и messaging-событий во все поддерживаемые рекламные платформы. Production-отправка пока отключена.</p>
    </div>

    <div className="metrics">
      <article className="metric"><span>Режим</span><strong>Shadow</strong><small>Формирование без отправки</small></article>
      <article className="metric"><span>Платформы</span><strong>{platforms.length}</strong><small>Запланированные адаптеры</small></article>
      <article className="metric"><span>Очередь</span><strong>0</strong><small>Event Hub ещё не создан</small></article>
      <article className="metric"><span>Production</span><strong>Выключен</strong><small>Данные не отправляются</small></article>
    </div>

    <section className="panel">
      <h2>Поддерживаемые рекламные платформы</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Платформа</th><th>Серверный интерфейс</th><th>Ключевые идентификаторы</th><th>Статус</th></tr></thead>
          <tbody>{platforms.map(([platform, api, identifiers, status]) => <tr key={platform}>
            <td><b>{platform}</b></td>
            <td>{api}</td>
            <td><small>{identifiers}</small></td>
            <td><span className="badge">{status}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="panel">
      <h2>Разделы Conversion Hub</h2>
      <div className="cards">
        {sections.map(({ title, text, icon: Icon }) => <article className="integration" key={title}>
          <div><Icon size={22}/></div>
          <h2>{title}</h2>
          <p>{text}</p>
          <span className="badge">Каркас</span>
        </article>)}
      </div>
    </section>

    <section className="panel">
      <h2>Единая событийная модель</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Внутреннее событие</th><th>Триггер</th><th>Назначение</th></tr></thead>
          <tbody>{plannedEvents.map(([eventName, trigger, destination]) => <tr key={eventName}>
            <td><b>{eventName}</b></td>
            <td>{trigger}</td>
            <td>{destination}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="panel">
      <h2>Архитектура</h2>
      <p className="note">Источники → Event Ingestion → Privacy Filter → Identity Resolution → Policy Engine → Queue → адаптеры Meta, TikTok, Google, Microsoft, LinkedIn, Snapchat и Pinterest → диагностика и сверка. Медицинские данные, диагнозы и жалобы не передаются.</p>
    </section>
  </div>;
}
