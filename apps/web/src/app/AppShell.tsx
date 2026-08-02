import { NavLink, Outlet } from 'react-router-dom';
import { platformModules } from '@imds/contracts';

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <span>IMDS</span>
          <strong>Marketing</strong>
        </header>

        <nav aria-label="Модули платформы">
          {platformModules.map((module) => (
            <NavLink
              key={module.id}
              to={module.path}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <span>{module.title}</span>
              <small>Этап {module.phase}</small>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <strong>Чистый модульный каркас</strong>
            <span>Legacy-код не перенесён</span>
          </div>
          <span className="environment">Foundation</span>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
