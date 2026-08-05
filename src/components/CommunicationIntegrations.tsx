import { MessageCircle, Phone } from 'lucide-react';
import WabaEmbeddedSignup from './WabaEmbeddedSignup';

const providers = [
  {
    id: 'wazzup',
    title: 'Wazzup',
    mark: 'W',
    description: 'WhatsApp, Instagram и другие мессенджеры с привязкой переписки к карточке лида.',
    capabilities: ['WhatsApp', 'Instagram', 'История сообщений'],
    icon: MessageCircle,
  },
  {
    id: 'binotel',
    title: 'Binotel',
    mark: 'B',
    description: 'Входящие и исходящие звонки, записи разговоров и события телефонии.',
    capabilities: ['Звонки', 'Записи разговоров', 'Пропущенные'],
    icon: Phone,
  },
  {
    id: 'sipuni',
    title: 'Sipuni',
    mark: 'S',
    description: 'Виртуальная АТС, статусы звонков, записи и аналитика работы менеджеров.',
    capabilities: ['Виртуальная АТС', 'Статусы звонков', 'Аналитика'],
    icon: Phone,
  },
] as const;

export default function CommunicationIntegrations() {
  return <section className="integration-catalog-section communication-integrations">
    <div className="connections-section__head">
      <div>
        <h2>Коммуникации и телефония</h2>
        <p>Прямой WhatsApp Business API, агрегаторы мессенджеров и телефония</p>
      </div>
    </div>
    <div className="integration-catalog-grid">
      <article className="integration-catalog-card integration-tone-waba integration-state-disconnected">
        <div className="integration-card-top">
          <span className="integration-card-logo"><MessageCircle size={20}/><b>WA</b></span>
          <em>Отдельное подключение</em>
        </div>
        <strong>WhatsApp Business API</strong>
        <p>Прямая интеграция WABA через Meta Embedded Signup без Wazzup и других посредников.</p>
        <div className="integration-card-tags"><span>WABA</span><span>Cloud API</span><span>Facebook Embedded Signup</span></div>
        <WabaEmbeddedSignup />
      </article>

      {providers.map(({ id, title, mark, description, capabilities, icon: Icon }) => <article className={`integration-catalog-card integration-tone-${id} integration-state-disconnected`} key={id}>
        <div className="integration-card-top">
          <span className="integration-card-logo"><Icon size={20}/><b>{mark}</b></span>
          <em>Не подключено</em>
        </div>
        <strong>{title}</strong>
        <p>{description}</p>
        <div className="integration-card-tags">{capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
        <button type="button" disabled title="Подключение будет доступно после добавления API-конфигурации">Подключение готовится</button>
      </article>)}
    </div>
  </section>;
}
