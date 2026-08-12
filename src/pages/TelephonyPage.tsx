import { Activity, Cable, ShieldCheck } from 'lucide-react';
import TelephonyDialer from '../components/TelephonyDialer';
import Calls from './Calls';
import PhoneWorkspacePage from './PhoneWorkspacePage';
import '../telephony-page.css';

export default function TelephonyPage() {
  return (
    <div className="telephony-v3">
      <header className="telephony-v3__header">
        <div className="telephony-v3__title">
          <span>IMDS COMMUNICATIONS</span>
          <h1>Телефония</h1>
          <p>Единое рабочее место оператора: линия, пациент, звонок, AI, запись, follow-up и контроль качества.</p>
        </div>
        <div className="telephony-v3__principles" aria-label="Возможности телефонии">
          <span><Activity size={15}/> Live</span>
          <span><Cable size={15}/> Multi-provider ready</span>
          <span><ShieldCheck size={15}/> Записи защищены</span>
        </div>
      </header>

      <TelephonyDialer />

      <section className="telephony-v3__operations" aria-label="Оперативная телефония">
        <PhoneWorkspacePage />
      </section>

      <section className="telephony-v3__journal" aria-label="История звонков и контроль качества">
        <Calls />
      </section>
    </div>
  );
}
