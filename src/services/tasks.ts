import { authFetch } from './auth';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskTargetType = 'all' | 'position' | 'job_title' | 'user';
export type TaskAssignmentMode = 'shared' | 'individual';
export interface TaskStage { key:string; name:string; status:TaskStatus; }
export interface TaskWorkflow { key:string; name:string; stages:TaskStage[]; }
export interface TaskUser { id:string; name:string; email:string; jobTitle?:string|null; positionId?:string|null; positionName?:string|null; }
export interface TaskGroup { id:string; name:string; type:'position'|'job_title'; memberCount:number; }
export interface TaskTarget { id:string; targetType:TaskTargetType; targetValue?:string|null; targetLabel:string; }
export interface TaskExecution { id:string; userId:string; userName:string; status:TaskStatus; resultCode?:string|null; resultNote?:string|null; completedAt?:string|null; updatedAt:string; }
export interface TaskComment { id:string; userId:string; userName:string; body:string; createdAt:string; }
export interface TaskChecklistItem { id:string; title:string; isDone:boolean; sortOrder:number; }
export interface TaskWatcher { id:string; userId:string; userName:string; }
export interface TaskHistoryItem { id:string; actorId?:string|null; actorName:string; eventType:string; fromValue?:string|null; toValue?:string|null; meta?:Record<string,unknown>; createdAt:string; }
export interface WorkTask {
  id:string; title:string; description?:string|null; status:TaskStatus; stageKey:string; workflowKey:string; priority:TaskPriority;
  dueAt?:string|null; slaMinutes?:number|null; slaDueAt?:string|null; acceptedAt?:string|null; completedAt?:string|null;
  resultCode?:string|null; resultNote?:string|null; linkType?:string|null; linkId?:string|null; linkLabel?:string|null;
  createdAt:string; updatedAt:string; createdBy?:string|null; createdByName?:string|null; assignmentMode:TaskAssignmentMode;
  targets:TaskTarget[]; executions:TaskExecution[]; comments?:TaskComment[]; checklist?:TaskChecklistItem[]; watchers?:TaskWatcher[]; history?:TaskHistoryItem[];
}
export interface TaskTemplate { id:string; name:string; description?:string|null; workflowKey:string; priority:TaskPriority; dueOffsetMinutes?:number|null; slaMinutes?:number|null; assignmentMode:TaskAssignmentMode; targets:Array<{targetType:TaskTargetType;targetValue?:string;targetLabel:string}>; checklist:string[]; linkType?:string|null; builtin:boolean; }
export interface TaskAutomationRule { id:string; key:string; name:string; description?:string|null; enabled:boolean; config:Record<string,unknown>; lastRunAt?:string|null; }
export interface TaskAnalyticsSummary { total:number; open:number; done:number; overdue:number; slaBreached:number; averageCompletionHours:number|null; }
export interface TaskAnalytics { summary:TaskAnalyticsSummary; byUser:Array<{userId:string;userName:string;open:number;overdue:number;done:number}>; byWorkflow:Array<{workflowKey:string;open:number;done:number;overdue:number}>; }

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`/api/tasks${path}`,{...init,headers:{'content-type':'application/json',...init?.headers}});
  const body=await response.text(); const contentType=response.headers.get('content-type')||'';
  if(!response.ok){if(contentType.includes('application/json')){try{const parsed=JSON.parse(body) as {error?:string};throw new Error(parsed.error||`Tasks API ${response.status}`);}catch(error){if(error instanceof Error)throw error;}}throw new Error(body||`Tasks API ${response.status}`);}
  if(!body)return null as T; if(!contentType.includes('application/json'))throw new Error(`Tasks API returned ${contentType||'non-JSON response'}`); return JSON.parse(body) as T;
}

export const tasksApi={
  bootstrap:()=>request<{users:TaskUser[];groups:TaskGroup[];workflows:TaskWorkflow[]}>('/bootstrap'),
  list:(scope='all',workflow='')=>request<{tasks:WorkTask[]}>(`?scope=${encodeURIComponent(scope)}${workflow?`&workflow=${encodeURIComponent(workflow)}`:''}`),
  get:(id:string)=>request<{task:WorkTask}>(`/${encodeURIComponent(id)}`),
  create:(payload:Record<string,unknown>)=>request<{task:WorkTask}>('',{method:'POST',body:JSON.stringify(payload)}),
  update:(id:string,payload:Record<string,unknown>)=>Object.keys(payload).length===1&&Object.prototype.hasOwnProperty.call(payload,'dueAt')
    ? request<{task:WorkTask}>('/suite/postpone',{method:'POST',body:JSON.stringify({taskId:id,dueAt:payload.dueAt})}).then(async result=>result.task?{task:result.task}:request<{task:WorkTask}>(`/${encodeURIComponent(id)}`))
    : request<{task:WorkTask}>(`/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  updateExecution:(taskId:string,status:TaskStatus,resultCode?:string,resultNote?:string)=>request<{task:WorkTask}>(`/${encodeURIComponent(taskId)}/execution`,{method:'PATCH',body:JSON.stringify({status,resultCode,resultNote})}),
  comment:(taskId:string,body:string)=>request<{task:WorkTask}>(`/${encodeURIComponent(taskId)}/comments`,{method:'POST',body:JSON.stringify({body})}),
  addChecklist:(taskId:string,title:string)=>request<{task:WorkTask}>(`/${encodeURIComponent(taskId)}/checklist`,{method:'POST',body:JSON.stringify({title})}),
  toggleChecklist:(taskId:string,itemId:string,isDone:boolean)=>request<{task:WorkTask}>(`/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`,{method:'PATCH',body:JSON.stringify({isDone})}),
  next:()=>request<{taskId:string|null;reused?:boolean}>('/suite/next',{method:'POST'}),
  templates:()=>request<{templates:TaskTemplate[]}>('/suite/templates'),
  createTemplate:(payload:Record<string,unknown>)=>request<{template:TaskTemplate}>('/suite/templates',{method:'POST',body:JSON.stringify(payload)}),
  deleteTemplate:(id:string)=>request<{template:TaskTemplate}>(`/suite/templates/${encodeURIComponent(id)}`,{method:'DELETE'}),
  analytics:()=>request<TaskAnalytics>('/suite/analytics'),
  automations:()=>request<{rules:TaskAutomationRule[]}>('/suite/automations'),
  updateAutomation:(key:string,payload:Record<string,unknown>)=>request<{rule:TaskAutomationRule}>('/suite/automations',{method:'PATCH',body:JSON.stringify({key,...payload})}),
  runAutomations:()=>request<{created:number}>('/suite/run-automations',{method:'POST'}),
  createFollowUp:(taskId:string,when?:string,title?:string)=>request<{taskId:string}>('/suite/follow-up',{method:'POST',body:JSON.stringify({taskId,when,title})}),
};
