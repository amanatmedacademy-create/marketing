import { ArrowLeft, Files, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ContentStudio } from '../content/ContentStudio';
import { KanbanBoard } from '../deals/components/KanbanBoard';
import { useEntitlements } from './EntitlementsContext';

type RuntimeModule = {
  id: string;
  name: string;
  route: string;
  navigationLabel: string;
  navigationOrder: number;
  metadata: Record<string, unknown>;
};

function normalizePath(value: string) {
  const path = value.trim() || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function currentPath() {
  return normalizePath(window.location.pathname);
}

export function ProductShellRuntime({ children }: { children: ReactNode }) {
  const entitlements = useEntitlements();
  const [path, setPath] = useState(currentPath);

  const runtimeModules = useMemo<RuntimeModule[]>(() => entitlements.modules
    .filter((module) => Boolean(module.route) && (module.metadata?.source === 'imds-platform' || module.id === 'content.studio'))
    .map((module) => {
      const name = module.name ?? module.id;
      return {
        id: module.id,
        name,
        route: normalizePath(module.route ?? '/'),
        navigationLabel: module.navigationLabel ?? name,
        navigationOrder: module.navigationOrder ?? 1000,
        metadata: module.metadata ?? {},
      };
    })
    .sort((a, b) => a.navigationOrder - b.navigationOrder), [entitlements.modules]);

  const activeModule = runtimeModules.find((module) => module.route === path) ?? null;

  const navigate = (nextPath: string) => {
    const normalized = normalizePath(nextPath);
    if (normalized === currentPath()) return;
    window.history.pushState({}, '', normalized);
    setPath(normalized);
  };

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!entitlements.loading && path !== '/' && !activeModule && (path.startsWith('/crm/') || path.startsWith('/content/'))) {
      window.history.replaceState({}, '', '/');
      setPath('/');
    }
  }, [activeModule, entitlements.loading, path]);

  return <>
    {children}
    {!entitlements.loading && runtimeModules.length > 0 && <nav className="platform-shell-runtime-nav" aria-label="Подключённые модули">
      {runtimeModules.map((module) => {
        const Icon = module.id === 'content.studio' ? Files : Workflow;
        return <button
          key={module.id}
          type="button"
          className={activeModule?.id === module.id ? 'active' : ''}
          title={module.navigationLabel}
          aria-label={module.navigationLabel}
          onClick={() => navigate(module.route)}
        >
          <Icon size={18} />
        </button>;
      })}
    </nav>}

    {activeModule?.id === 'crm.kanban' && <section className="platform-module-surface" aria-label={activeModule.navigationLabel}>
      <header className="platform-module-header">
        <button type="button" onClick={() => navigate('/')}><ArrowLeft size={17} /> Назад в Marketing</button>
        <div>
          <strong>{activeModule.navigationLabel}</strong>
          <span>CRM Kanban · {String(activeModule.metadata.version ?? '1.0.0')}</span>
        </div>
        <small>{String(activeModule.metadata.healthStatus ?? 'healthy')}</small>
      </header>
      <main className="platform-module-content"><KanbanBoard /></main>
    </section>}

    {activeModule?.id === 'content.studio' && <section className="platform-module-surface" aria-label={activeModule.navigationLabel}>
      <header className="platform-module-header">
        <button type="button" onClick={() => navigate('/')}><ArrowLeft size={17} /> Назад в Marketing</button>
        <div>
          <strong>{activeModule.navigationLabel}</strong>
          <span>IMDS Content Studio · {String(activeModule.metadata.version ?? '1.0.0')}</span>
        </div>
        <small>active</small>
      </header>
      <main className="platform-module-content"><ContentStudio /></main>
    </section>}
  </>;
}
