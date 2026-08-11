import Calls from './Calls';
import PhoneWorkspacePage from './PhoneWorkspacePage';
import '../telephony-page.css';

export default function TelephonyPage() {
  return <div className="telephony-module">
    <header className="telephony-module__header">
      <div>
        <span>КОММУНИКАЦИИ</span>
        <h1>Телефония</h1>
        <p>Единое рабочее пространство: линия, пациент, AI, запись, история звонков и контроль качества.</p>
      </div>
    </header>

    <section className="telephony-module__workspace" aria-label="Рабочая телефония">
      <PhoneWorkspacePage/>
    </section>

    <section className="telephony-module__journal" aria-label="История звонков и контроль качества">
      <div className="telephony-module__section-head">
        <div>
          <span>ИСТОРИЯ И КОНТРОЛЬ</span>
          <h2>Звонки</h2>
        </div>
      </div>
      <Calls/>
    </section>
  </div>;
}
