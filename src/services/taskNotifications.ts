import { authFetch } from './auth';

export type TaskNotificationKind='assigned'|'due_soon'|'overdue';
export interface TaskNotification{id:string;taskId:string;kind:TaskNotificationKind;title:string;message:string;readAt?:string|null;createdAt:string;}

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await authFetch(`/api/tasks/notifications${path}`,{...init,headers:{'content-type':'application/json',...init?.headers}});
  const body=await response.text();
  const contentType=response.headers.get('content-type')||'';
  if(!response.ok){
    if(contentType.includes('application/json')){
      try{const parsed=JSON.parse(body) as {error?:string};throw new Error(parsed.error||`Notifications API ${response.status}`);}catch(error){if(error instanceof Error)throw error;}
    }
    throw new Error(body||`Notifications API ${response.status}`);
  }
  if(!body)return null as T;
  if(!contentType.includes('application/json'))throw new Error(`Notifications API returned ${contentType||'non-JSON response'}`);
  return JSON.parse(body) as T;
}

export const taskNotificationsApi={
  list:()=>request<{notifications:TaskNotification[];unread:number}>(''),
  read:(id:string)=>request<{ok:boolean}>(`/${encodeURIComponent(id)}/read`,{method:'PATCH'}),
  readAll:()=>request<{ok:boolean}>('/read-all',{method:'PATCH'})
};
