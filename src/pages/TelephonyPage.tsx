import { Activity, BarChart3, Headphones, Radio } from 'lucide-react';
import TelephonyDialer from '../components/TelephonyDialer';
import TelephonyOperatorWorkspace from '../components/TelephonyOperatorWorkspace';
import '../telephony-page.css';

export default function TelephonyPage() {
  return (
    <div className="telephony-v4">
      <header className="telephony-v4__header">
        <div className="telephony-v4__title">
          <span>IMDS COMMUNICATIONS</span>
          <h1>Телефония</h1>
          <p>Рабочее место оператора: очередь, пациент, единая история коммуникаций, звонок, AI, запись и follow-up.</p>
        </div>
        <div className="telephony-v4__modes" aria-label="Режимы телефонии">
          <span className="active"><Headphones size={15}/> Оператор</span>
          <span title="Supervisor Live будет отдельным рабочим режимом"><Radio size={15}/> Supervisor</span>
          <span title="Аналитика звонков будет отдельным рабочим режимом"><BarChart3 size={15}/> Аналитика</span>
          <span><Activity size={15}/> Live</span>
        </div>
      </header>

      <TelephonyDialer />
      <TelephonyOperatorWorkspace />
    </div>
  );
}
