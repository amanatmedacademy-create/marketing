export type AccessAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'manage';
export type AccessGrant = Record<AccessAction, boolean>;
export interface UserCompany { id:string; name:string; slug:string; role:string; status:string }

export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  jobTitle?: string | null;
  positionId?: string | null;
  permissions?: Record<string, AccessGrant>;
  companyId?: string | null;
  companies?: UserCompany[];
}

interface StoredSession { access_token:string; refresh_token?:string; expires_at?:number; token_type?:string }
const STORAGE_KEY='amanat_marketing_auth_session';
const COMPANY_KEY='imds_active_company_id';
function readStoredSession():StoredSession|null{try{const value=localStorage.getItem(STORAGE_KEY);return value?JSON.parse(value) as StoredSession:null}catch{return null}}
function writeStoredSession(session:StoredSession|null){if(session)localStorage.setItem(STORAGE_KEY,JSON.stringify(session));else localStorage.removeItem(STORAGE_KEY)}
export function activeCompanyId():string{return localStorage.getItem(COMPANY_KEY)?.trim()||''}
export function setActiveCompanyId(companyId:string|null){if(companyId)localStorage.setItem(COMPANY_KEY,companyId);else localStorage.removeItem(COMPANY_KEY)}
function parseCallbackSession():StoredSession|null{const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));const accessToken=hash.get('access_token');if(!accessToken)return null;const session:StoredSession={access_token:accessToken,refresh_token:hash.get('refresh_token')||undefined,token_type:hash.get('token_type')||'bearer',expires_at:Math.floor(Date.now()/1000)+Number(hash.get('expires_in')||3600)};writeStoredSession(session);history.replaceState({},document.title,`${window.location.pathname}${window.location.search}`);return session}
async function refreshSession(session:StoredSession):Promise<StoredSession|null>{if(!session.refresh_token)return null;const response=await fetch('/api/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});if(!response.ok)return null;const payload=await response.json() as Record<string,unknown>;const accessToken=typeof payload.access_token==='string'?payload.access_token:'';if(!accessToken)return null;const next:StoredSession={access_token:accessToken,refresh_token:typeof payload.refresh_token==='string'?payload.refresh_token:session.refresh_token,token_type:typeof payload.token_type==='string'?payload.token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+Number(payload.expires_in||3600)};writeStoredSession(next);return next}
export async function currentSession():Promise<StoredSession|null>{const callback=parseCallbackSession();if(callback)return callback;const session=readStoredSession();if(!session)return null;const expiresAt=Number(session.expires_at||0);if(!expiresAt||expiresAt>Math.floor(Date.now()/1000)+60)return session;const refreshed=await refreshSession(session);if(!refreshed)writeStoredSession(null);return refreshed}
export async function startGoogleSignIn():Promise<void>{window.location.assign('/api/auth/google/start')}
export async function signOutSession():Promise<void>{writeStoredSession(null);setActiveCompanyId(null);await fetch('/api/auth/logout',{method:'POST'}).catch(()=>undefined)}
export async function authFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>{const session=await currentSession();const headers=new Headers(init.headers||{});if(session?.access_token)headers.set('authorization',`Bearer ${session.access_token}`);const companyId=activeCompanyId();if(companyId)headers.set('x-imds-company-id',companyId);return fetch(input,{...init,headers})}
export async function loadAppUser():Promise<AppUser>{
  const response=await authFetch('/api/auth/me');const body=await response.text();
  if(!response.ok){try{const parsed=JSON.parse(body) as {error?:string};throw new Error(parsed.error||body||'Ошибка авторизации')}catch(error){if(error instanceof Error&&error.message!=='Unexpected end of JSON input')throw error;throw new Error(body||'Ошибка авторизации')}}
  const user=(JSON.parse(body) as {user:AppUser}).user;
  if(user.companyId&&!activeCompanyId())setActiveCompanyId(user.companyId);
  return user;
}
