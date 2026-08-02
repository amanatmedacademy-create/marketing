import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <span>404</span>
          <h1>Раздел не найден</h1>
          <p>Маршрут отсутствует в реестре модулей.</p>
        </div>
      </div>
      <Link className="primary-link" to="/dashboard">Вернуться на дашборд</Link>
    </section>
  );
}
