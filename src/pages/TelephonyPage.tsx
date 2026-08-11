import { useEffect } from 'react';
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

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.marketing-shell > main');
    if (scroller) scroller.scrollTop = 0;
  }, [activeTab]);

  const selectTab = (tab: TelephonyTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return <div className="telephony-module">
    <div className="telephony-module__chrome">
      <header className="telephony-module__header">
        <div>
          <span>КОММУНИКАЦИИ</span>
          <h1>Телефония</h1>
          <p>Текущие звонки, история, записи разговоров, AI-контроль и исходящие вызовы.</p>
        </div>
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
    </div>

    <section className="telephony-module__content">
      {activeTab === 'workspace' ? <PhoneWorkspacePage/> : <Calls/>}
    </section>
  </div>;
}
