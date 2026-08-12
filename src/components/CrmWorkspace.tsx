import { NavLink, Outlet } from 'react-router-dom';
import { UserRoundSearch, UsersRound, Workflow } from 'lucide-react';

type CrmWorkspaceProps = {
  canView: (moduleId: string) => boolean;
};

const tabs = [
  { to: '/leads', label: 'Лиды', icon: UsersRound, moduleId: 'crm.leads' },
  { to: '/customers', label: 'Клиенты', icon: UserRoundSearch, moduleId: 'crm.leads' },
  { to: '/pipeline', label: 'Сделки', icon: Workflow, moduleId: 'crm.pipeline' },
] as const;

export default function CrmWorkspace({ canView }: CrmWorkspaceProps) {
  const visibleTabs = tabs.filter((tab) => canView(tab.moduleId));

  return <section className="crm-workspace">
    <header className="crm-workspace__header">
      <div>
        <span className="crm-workspace__eyebrow">CRM</span>
        <h1>Клиенты и продажи</h1>
        <p>Лиды, карточки клиентов и сделки — в одном рабочем пространстве.</p>
      </div>
      <span className="crm-workspace__principle">Без дублирования модулей</span>
    </header>

    <nav className="crm-workspace__tabs" aria-label="CRM разделы">
      {visibleTabs.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to}>
        <Icon size={17}/>
        <span>{label}</span>
      </NavLink>)}
    </nav>

    <div className="crm-workspace__content">
      <Outlet/>
    </div>
  </section>;
}
