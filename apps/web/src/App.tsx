import { Activity, Database, Server, ShieldCheck } from 'lucide-react';

const services = [
  { label: 'Frontend', value: 'React 18 + Vite', icon: Activity },
  { label: 'Backend', value: 'NestJS + Fastify', icon: Server },
  { label: 'Database', value: 'PostgreSQL + Prisma', icon: Database },
  { label: 'Security', value: 'JWT + tenant isolation', icon: ShieldCheck },
];

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero-card">
        <span className="eyebrow">IMDS CRM</span>
        <h1>Базовая платформа запущена</h1>
        <p>
          Monorepo подготовлен. Следующий модуль — авторизация, refresh-сессии,
          роли и мультитенантная изоляция данных.
        </p>

        <div className="service-grid">
          {services.map(({ label, value, icon: Icon }) => (
            <article key={label}>
              <Icon size={20} />
              <div>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
