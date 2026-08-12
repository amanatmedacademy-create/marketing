import Calls from './Calls';
import PhoneWorkspacePage from './PhoneWorkspacePage';
import '../telephony-page.css';

export default function TelephonyPage() {
  return (
    <div className="telephony-module">
      <header className="telephony-module__header">
        <div>
          <span>КОММУНИКАЦИИ</span>
          <h1>Телефония</h1>
          <p>
            Линия, пациент, AI, запись, история звонков и контроль качества
            в одном рабочем пространстве.
          </p>
        </div>
      </header>

      <section
        className="telephony-module__workspace"
        aria-label="Рабочая телефония"
      >
        <PhoneWorkspacePage />
      </section>

      <section
        className="telephony-module__journal"
        aria-label="История звонков и контроль качества"
      >
        <Calls />
      </section>
    </div>
  );
}
