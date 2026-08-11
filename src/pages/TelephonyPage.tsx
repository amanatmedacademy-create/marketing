import { History, PhoneCall } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Calls from './Calls';
import PhoneWorkspacePage from './PhoneWorkspacePage';
import '../telephony-page.css';

type TelephonyTab = 'workspace' | 'calls';

const tabs: Array<{ id: TelephonyTab; label: string; description: string; icon: typeof PhoneCall }> = [
  {
    id: 'workspace',
    label: 'Рабочее место',
    description: 'Текущий звонок, пациент, история и запись',
    icon: PhoneCall,
  },
  {
    id: 'calls',
    label: 'Журнал звонков',
    description: 'История, записи, AI-контроль и аналитика',
    icon: History,
  },
];

export default function TelephonyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: TelephonyTab = searchParams.get('tab') === 'calls' ? 'calls' : 'workspace';

  const selectTab = (tab: TelephonyTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return <div className="telephony-module">
    <header className="telephony-module__header">
      <div>
        <span>КОММУНИКАЦИИ</span>
        <h1>Телефония</h1>
        <p>Единый модуль для текущих звонков, истории, записей разговоров, AI-контроля и исходящих вызовов.</p>
      </div>
      <div className="telephony-module__status"><PhoneCall size={18}/><span>Единый модуль</span></div>
    </header>

    <nav className="telephony-module__tabs" aria-label="Разделы телефонии">
      {tabs.map(({ id, label, description, icon: Icon }) => <button
        key={id}
        type="button"
        className={activeTab === id ? 'active' : ''}
        onClick={() => selectTab(id)}
        aria-current={activeTab === id ? 'page' : undefined}
      >
        <Icon size={17}/>
        <span><strong>{label}</strong><small>{description}</small></span>
      </button>)}
    </nav>

    <section className="telephony-module__content">
      {activeTab === 'workspace' ? <PhoneWorkspacePage/> : <Calls/>}
    </section>
  </div>;
}
