import type { Env } from './integrations';
import { handleUserAdminRequest } from './userAdmin';
import { hasPermission, permissionForRequest, resolveUserAccess, type AccessMap } from './accessControl';
import { listUserCompanies, resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;
export type AuthEnv = Env & { SUPABASE_ANON_KEY?: string; SUPABASE_PUBLISHABLE_KEY?: string; AUTH_ALLOWED_EMAIL_DOMAINS?: string; AUTH_AUTO_APPROVE?: string; CURRENT_COMPANY_ID?: string };
export interface AuthenticatedUser { id:string; email:string; name:string; avatarUrl:string|null; role:string; status:string; jobTitle?:string|null; positionId?:string|null; permissions?:AccessMap }
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const text=(value:unknown):string=>typeof value==='string'?value.trim():'';
function publicKey(env:AuthEnv){return text(env.SUPABASE_PUBLISHABLE_KEY)||text(env.SUPABASE_ANON_KEY)}
function authKey(env:AuthEnv){return publicKey(env)||env.SUPABASE_SERVICE_ROLE_KEY}
function serviceHeaders(env:AuthEnv,extra:HeadersInit={}):HeadersInit{return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',...extra}}
async function rest(env:AuthEnv,path:string,init:RequestInit={}):Promise<Response>{return fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`,{...init,headers:serviceHeaders(env,init.headers)})}
function bearer(request:Request){const value=request.headers.get('authorization')||'';return value.toLowerCase().startsWith('bearer ')?value.slice(7).trim():null}
function allowedDomains(env:AuthEnv){return text(env.AUTH_ALLOWED_EMAIL_DOMAINS).split(',').map((v)=>v.trim().toLowerCase()).filter(Boolean)}
function domainAllowed(email:string,env:AuthEnv){const domains=allowedDomains(env);return !domains.length||domains.includes(email.split('@').pop()?.toLowerCase()||'')}
async function readSettings(env:AuthEnv){try{const key=authKey(env);if(!env.SUPABASE_URL||!key)return{googleEnabled:false,error:'Supabase Auth не настроен'};const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/settings`,{headers:{apikey:key,authorization:`Bearer ${key}`}});const body=await response.text();if(!response.ok)return{googleEnabled:false,error:`Supabase Auth settings: ${response.status} ${body}`};const parsed=JSON.parse(body) as JsonRecord;const external=(parsed.external&&typeof parsed.external==='object'?parsed.external:{}) as JsonRecord;return{googleEnabled:external.google===true,error:null}}catch(error){return{googleEnabled:false,error:error instanceof Error?error.message:String(error)}}}
async function fetchAuthUser(request:Request,env:AuthEnv):Promise<JsonRecord|null>{const token=bearer(request),key=authKey(env);if(!token||!key)return null;const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/user`,{headers:{apikey:key,authorization:`Bearer ${token}`}});return response.ok?await response.json() as JsonRecord:null}
async function upsertUser(authUser:JsonRecord,env:AuthEnv):Promise<AuthenticatedUser>{
  const authId=text(authUser.id),email=text(authUser.email).toLowerCase(),metadata=(authUser.user_metadata&&typeof authUser.user_metadata==='object'?authUser.user_metadata:{}) as JsonRecord;
  const googleName=text(metadata.full_name)||text(metadata.name)||email.split('@')[0]||'Пользователь';const avatar=text(metadata.avatar_url)||null;
  if(!authId||!email)throw new Error('Google account does not contain a valid user ID or email');if(!domainAllowed(email,env))throw new Error('Этот Google-аккаунт не разрешён для входа');
  let rowsResponse=await rest(env,`marketing_users?auth_user_id=eq.${encodeURIComponent(authId)}&select=*`);if(!rowsResponse.ok)throw new Error(`Unable to read marketing user: ${await rowsResponse.text()}`);let rows=await rowsResponse.json() as JsonRecord[];let row=rows[0];
  if(row){
    const lastSeenAt=row.last_seen_at?new Date(String(row.last_seen_at)).getTime():0;
    const staleEnough=!Number.isFinite(lastSeenAt)||Date.now()-lastSeenAt>5*60*1000;
    const profileChanged=text(row.email).toLowerCase()!==email||(row.avatar_url?text(row.avatar_url):null)!==avatar||text(row.provider)!=='google';
    if(staleEnough||profileChanged){
      const response=await rest(env,`marketing_users?id=eq.${encodeURIComponent(text(row.id))}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({email,avatar_url:avatar,provider:'google',provider_metadata:metadata,last_seen_at:new Date().toISOString()})});
      if(!response.ok)throw new Error(`Unable to update marketing user: ${await response.text()}`);row=(await response.json() as JsonRecord[])[0];
    }
  }
  else{
    const invitedResponse=await rest(env,`marketing_users?email=ilike.${encodeURIComponent(email)}&auth_user_id=is.null&select=*&limit=1`);if(!invitedResponse.ok)throw new Error(`Unable to read invited user: ${await invitedResponse.text()}`);const invited=await invitedResponse.json() as JsonRecord[];
    if(invited[0]){const response=await rest(env,`marketing_users?id=eq.${encodeURIComponent(text(invited[0].id))}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({auth_user_id:authId,email,avatar_url:avatar,provider:'google',provider_metadata:{...metadata,manually_linked:true},last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()})});if(!response.ok)throw new Error(`Unable to activate invited user: ${await response.text()}`);row=(await response.json() as JsonRecord[])[0];}
    else{const first=await rest(env,'marketing_users?select=id&limit=1');const hasUsers=first.ok&&(await first.json() as JsonRecord[]).length>0;const role=hasUsers?'viewer':'administrator';const status=env.AUTH_AUTO_APPROVE==='false'&&role!=='administrator'?'invited':'active';const response=await rest(env,'marketing_users',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({auth_user_id:authId,name:googleName,email,avatar_url:avatar,provider:'google',provider_metadata:metadata,role,status,last_seen_at:new Date().toISOString()})});if(!response.ok)throw new Error(`Unable to create marketing user: ${await response.text()}`);row=(await response.json() as JsonRecord[])[0];}
  }
  return{id:text(row.id)||authId,email,name:text(row.name)||googleName,avatarUrl:row.avatar_url?text(row.avatar_url):avatar,role:text(row.role)||'viewer',status:text(row.status)||'invited'};
}
function origin(request:Request,env:AuthEnv){const requestOrigin=new URL(request.url).origin;try{return env.APP_ORIGIN?new URL(env.APP_ORIGIN).origin:requestOrigin}catch{return requestOrigin}}
function requestedCompanyId(request:Request):string{return text(request.headers.get('x-imds-company-id'))}
async function scopedEnv(request:Request,env:AuthEnv,user:AuthenticatedUser):Promise<AuthEnv>{
  const requested=requestedCompanyId(request);
  if(requested)return{...env,CURRENT_COMPANY_ID:await resolveCompanyId({...env,CURRENT_COMPANY_ID:requested},user.id)};
  const companies=await listUserCompanies(env,user.id);
  if(companies.length===1)return{...env,CURRENT_COMPANY_ID:companies[0].id};
  return env;
}
export function isPublicApiPath(pathname:string){return pathname==='/api/health'||pathname==='/api/auth/config'||pathname==='/api/auth/google/start'||pathname==='/api/auth/refresh'||pathname==='/api/auth/logout'||pathname.startsWith('/api/webhooks/')||pathname.startsWith('/api/public/lead-forms/')}
export async function authenticateRequest(request:Request,env:AuthEnv):Promise<AuthenticatedUser|null>{const authUser=await fetchAuthUser(request,env);return authUser?upsertUser(authUser,env):null}
export async function authorizeApplicationRequest(request:Request,env:AuthEnv,user:AuthenticatedUser):Promise<Response|null>{
  if(user.role==='administrator')return null;
  const rule=permissionForRequest(new URL(request.url).pathname,request.method);if(!rule)return null;
  const tenantEnv=await scopedEnv(request,env,user);if(!tenantEnv.CURRENT_COMPANY_ID)return json({error:'Выберите клинику для продолжения',code:'COMPANY_REQUIRED'},409);
  const access=await resolveUserAccess(tenantEnv,user.id,user.role);if(!hasPermission(access.permissions,rule.moduleId,rule.action))return json({error:'Недостаточно прав для этого действия',moduleId:rule.moduleId,action:rule.action},403);
  return null;
}
export async function handleAuthRequest(request:Request,env:AuthEnv,url:URL):Promise<Response|null>{
  if(url.pathname.startsWith('/api/admin/users')){const user=await authenticateRequest(request,env);if(!user)return json({error:'Необходим вход через Google'},401);if(user.status!=='active')return json({error:'Пользователь не активен'},403);const tenantEnv=await scopedEnv(request,env,user);if(!tenantEnv.CURRENT_COMPANY_ID)return json({error:'Выберите клинику для продолжения',code:'COMPANY_REQUIRED'},409);const headers=new Headers(request.headers);headers.set('x-amanat-auth-user',user.id);headers.set('x-amanat-auth-role',user.role);return handleUserAdminRequest(new Request(request,{headers}),tenantEnv,url)}
  if(url.pathname==='/api/auth/config'&&request.method==='GET'){const settings=await readSettings(env);return json({googleEnabled:settings.googleEnabled,oauthMode:'worker',publicKeyConfigured:Boolean(publicKey(env)),diagnostic:settings.error})}
  if(url.pathname==='/api/auth/google/start'&&request.method==='GET'){const settings=await readSettings(env);if(!settings.googleEnabled)return Response.redirect(`${origin(request,env)}/?error_description=${encodeURIComponent(settings.error||'Google Provider выключен')}`,302);const authorize=new URL(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/authorize`);authorize.searchParams.set('provider','google');authorize.searchParams.set('redirect_to',`${origin(request,env)}/`);authorize.searchParams.set('scopes','openid email profile');return Response.redirect(authorize.toString(),302)}
  if(url.pathname==='/api/auth/refresh'&&request.method==='POST'){const body=await request.json().catch(()=>({})) as JsonRecord;const token=text(body.refresh_token);if(!token)return json({error:'refresh_token is required'},400);const key=authKey(env);const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({refresh_token:token})});return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
  if(url.pathname==='/api/auth/logout'&&request.method==='POST')return json({ok:true});
  if(url.pathname==='/api/auth/me'&&request.method==='GET'){
    try{
      const user=await authenticateRequest(request,env);if(!user)return json({error:'Необходим вход через Google'},401);if(user.status==='blocked')return json({error:'Доступ пользователя заблокирован'},403);if(user.status!=='active')return json({error:'Аккаунт ожидает подтверждения администратора'},403);
      const companies=await listUserCompanies(env,user.id);const requested=requestedCompanyId(request);let companyId:string|null=null;
      if(requested)companyId=await resolveCompanyId({...env,CURRENT_COMPANY_ID:requested},user.id);else if(companies.length===1)companyId=companies[0].id;
      const tenantEnv=companyId?{...env,CURRENT_COMPANY_ID:companyId}:env;const access=companyId?await resolveUserAccess(tenantEnv,user.id,user.role):null;
      return json({user:{...user,companyId,companies,jobTitle:access?.jobTitle||null,positionId:access?.positionId||null,permissions:access?.permissions||{}}});
    }catch(error){return json({error:error instanceof Error?error.message:'Ошибка авторизации'},403)}
  }
  return null;
}
export function authError(status=401,message='Необходим вход через Google'){return json({error:message},status)}
