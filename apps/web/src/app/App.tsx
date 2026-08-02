import { Navigate, Route, Routes } from 'react-router-dom';
import { platformModules } from '@imds/contracts';
import { AppShell } from './AppShell';
import { ModulePage } from './ModulePage';
import { NotFoundPage } from './NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        {platformModules.map((module) => (
          <Route
            key={module.id}
            path={module.path.slice(1)}
            element={<ModulePage module={module} />}
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
