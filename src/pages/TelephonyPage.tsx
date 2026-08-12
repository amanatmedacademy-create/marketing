import { BarChart3, Headphones, Radio } from 'lucide-react';
import TelephonyDialer from '../components/TelephonyDialer';
import TelephonyOperatorWorkspace from '../components/TelephonyOperatorWorkspace';
import '../telephony-page.css';

export default function TelephonyPage() {
  return (
    <div className="telephony-v5">
      <div className="telephony-v5__top">
        <div className="telephony-v5__modes" aria-label="Режимы телефонии">
          <button type="button" className="active"><Headphones size={14}/>Оператор</button>
          <button type="button" disabled title="Supervisor workspace будет отдельным режимом"><Radio size={14}/>Supervisor</button>
          <button type="button" disabled title="Analytics workspace будет отдельным режимом"><BarChart3 size={14}/>Аналитика</button>
        </div>
      </div>
      <TelephonyDialer />
      <TelephonyOperatorWorkspace />
    </div>
  );
}
