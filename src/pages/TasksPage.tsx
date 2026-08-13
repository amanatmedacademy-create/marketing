import { useMemo,useState } from 'react';
import { CalendarDays,GitBranch,LayoutDashboard } from 'lucide-react';
import TasksCorePage from './TasksCorePage';
import TaskPhase2Workspace from './TaskPhase2Workspace';
import '../task-phase2.css';

type PhaseView='core'|'calendar'|'relations';

function initialView():PhaseView{
  const value=new URLSearchParams(window.location.search).get('taskView');
  return value==='calendar'||value==='relations'?value:'core';
}

export default function TasksPage(){
  const [view,setView]=useState<PhaseView>(initialView);
  const tabs=useMemo(()=>[
    {id:'core' as const,label:'Рабочий центр',icon:LayoutDashboard},
    {id:'calendar' as const,label:'Календарь',icon:CalendarDays},
    {id:'relations' as const,label:'Связи и повторы',icon:GitBranch},
  ],[]);
  const change=(next:PhaseView)=>{
    setView(next);
    const url=new URL(window.location.href);
    if(next==='core')url.searchParams.delete('taskView');else url.searchParams.set('taskView',next);
    window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  };
  return <div className="task-phase-shell">
    <nav className="task-phase-nav" aria-label="Дополнительные режимы задач">
      {tabs.map(item=>{const Icon=item.icon;return <button key={item.id} className={view===item.id?'active':''} onClick={()=>change(item.id)}><Icon size={16}/>{item.label}</button>;})}
    </nav>
    {view==='core'?<TasksCorePage/>:<TaskPhase2Workspace mode={view}/>} 
  </div>;
}
