import { useState } from 'react';
import { BarChart3, Headphones, Radio } from 'lucide-react';
import TelephonyDialer from '../components/TelephonyDialer';
import TelephonyManagementWorkspace from '../components/TelephonyManagementWorkspace';
import TelephonyOperatorWorkspace from '../components/TelephonyOperatorWorkspace';
import '../telephony-page.css';
import '../telephony-layout-hotfix.css';
import '../telephony-data-inspector-fix.css';
import '../telephony-management-filters.css';
import '../telephony-keypad-overlay-fix.css';

type TelephonyMode = 'operator' | 'supervisor' | 'analytics';

export default function TelephonyPage() {
  const [mode, setMode] = useState<TelephonyMode>('operator');

  return (
    <div className="telephony-v5">
      <div className="telephony-v5__toolbar">
        <TelephonyDialer />
        <div className="telephony-v5__modes" aria-label="Режимы телефонии">
          <button type="button" className={mode === 'operator' ? 'active' : ''} onClick={() => setMode('operator')}><Headphones size={13}/>Оператор</button>
          <button type="button" className={mode === 'supervisor' ? 'active' : ''} onClick={() => setMode('supervisor')}><Radio size={13}/>Supervisor</button>
          <button type="button" className={mode === 'analytics' ? 'active' : ''} onClick={() => setMode('analytics')}><BarChart3 size={13}/>Аналитика</button>
        </div>
      </div>
      {mode === 'operator' ? <TelephonyOperatorWorkspace /> : <TelephonyManagementWorkspace mode={mode} />}
    </div>
  );
}
