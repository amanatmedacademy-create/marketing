import { useState } from 'react';
import { MessageCircle, Phone, X } from 'lucide-react';
import CloudTelephonyIntegrationPanel from './CloudTelephonyIntegrationPanel';
import WabaEmbeddedSignup from './WabaEmbeddedSignup';

type CloudProvider = 'binotel' | 'sipuni';

const providers = [
  {
    id: 'wazzup',
    title: 'Wazzup',
    mark: 'W',
    description: 'WhatsApp, Instagram и другие мессенджеры с привязкой переписки к карточке лида.',
    capabilities: ['WhatsApp', 'Instagram', 'История сообщений'],
    icon: MessageCircle,
    enabled: false,
  },
  {
    id: 'binotel',
    title: 'Binotel',
    mark: 'B',
    description: 'Входящие и исходящие звонки, записи разговоров и события телефонии.',
    capabilities: ['Звонки', 'Записи разговоров', 'Пропущенные'],
    icon: Phone,
    enabled: true,
  },
  {
    id: 'sipuni',
    title: 'Sipuni',
    mark: 'S',
    description: 'Виртуальная АТС, статусы звонков, записи и аналитика работы менеджеров.',
    capabilities: ['Виртуальная АТС', 'Статусы звонков', 'Аналитика'],
    icon: Phone,
    enabled: true,
  },
] as const;

export default function CommunicationIntegrations() {
  const [selectedProvider, setSelectedProvider] = useState<CloudProvider | null>(null);

  return <>
    <section className="integration-catalog-section communication-integrations">
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

        {providers.map(({ id, title, mark, description, capabilities, icon: Icon, enabled }) => <article className={`integration-catalog-card integration-tone-${id} integration-state-disconnected`} key={id}>
          <div className="integration-card-top">
            <span className="integration-card-logo"><Icon size={20}/><b>{mark}</b></span>
            <em>{enabled ? 'Доступно' : 'Не подключено'}</em>
          </div>
          <strong>{title}</strong>
          <p>{description}</p>
          <div className="integration-card-tags">{capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
          {enabled
            ? <button type="button" onClick={() => setSelectedProvider(id as CloudProvider)}>Подключить</button>
            : <button type="button" disabled title="Подключение будет доступно после добавления API-конфигурации">Подключение готовится</button>}
        </article>)}
      </div>
    </section>

    {selectedProvider && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProvider(null); }}>
      <section className="iv2-modal iv2-modal--workspace" role="dialog" aria-modal="true" aria-label={`Настройка ${selectedProvider === 'binotel' ? 'Binotel' : 'Sipuni'}`}>
        <header className="iv2-workspace-head">
          <div>
            <h2>{selectedProvider === 'binotel' ? 'Binotel / Телефония' : 'Sipuni / Телефония'}</h2>
            <p>Подключение доступно для выбранного филиала.</p>
          </div>
          <button type="button" onClick={() => setSelectedProvider(null)} aria-label="Закрыть"><X size={20}/></button>
        </header>
        <div className="iv2-workspace-body">
          <CloudTelephonyIntegrationPanel provider={selectedProvider}/>
        </div>
      </section>
    </div>}
  </>;
}
