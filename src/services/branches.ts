import { authFetch } from './auth';

export type Branch = { id:string; companyId:string; name:string; code:string|null; status:string; isPrimary:boolean; city:string|null; address:string|null; phone:string|null; timezone:string; memberCount:number };
export type BranchList = { items: Branch[]; restricted: boolean; canManage: boolean; allAvailable?: boolean };
export type BranchAnalyticsItem = { branchId:string; name:string; code:string|null; isPrimary:boolean; leads:number; targetLeads:number; arrivals:number; sales:number; revenue:number; calls:number; appointments:number; callMinutes:number; openTasks:number; doneTasks:number };
export type BranchAnalytics = { items: BranchAnalyticsItem[]; totals: Omit<BranchAnalyticsItem,'branchId'|'name'|'code'|'isPrimary'> };
const BRANCH_KEY='imds_active_branch_id';
export function activeBranchId():string{return localStorage.getItem(BRANCH_KEY)?.trim()||'';}
export function setActiveBranchId(branchId:string|null){if(branchId)localStorage.setItem(BRANCH_KEY,branchId);else localStorage.removeItem(BRANCH_KEY);}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{const response=await authFetch(path,{...init,cache:'no-store',headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})}});const raw=await response.text();let payload:Record<string,unknown>={};try{payload=raw?JSON.parse(raw)as Record<string,unknown>:{};}catch{payload={};}if(!response.ok)throw new Error(typeof payload.error==='string'?payload.error:raw||`HTTP ${response.status}`);return payload as T;}
export async function loadBranches():Promise<BranchList>{return request<BranchList>('/api/branches');}
export async function loadBranchAnalytics():Promise<BranchAnalytics>{return request<BranchAnalytics>('/api/branches/analytics');}
export async function createBranch(input:{name:string;code?:string;city?:string;address?:string;phone?:string;timezone?:string}):Promise<void>{await request('/api/branches',{method:'POST',body:JSON.stringify(input)});}
export async function updateBranch(id:string,input:Partial<Pick<Branch,'name'|'code'|'city'|'address'|'phone'|'timezone'|'status'>>):Promise<void>{await request(`/api/branches/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)});}
export async function archiveBranch(id:string):Promise<void>{await request(`/api/branches/${encodeURIComponent(id)}`,{method:'DELETE'});}
export async function setPrimaryBranch(id:string):Promise<void>{await request(`/api/branches/${encodeURIComponent(id)}/primary`,{method:'POST'});}
export async function addBranchMember(branchId:string,userId:string):Promise<void>{await request(`/api/branches/${encodeURIComponent(branchId)}/members/${encodeURIComponent(userId)}`,{method:'PUT'});}
export async function removeBranchMember(branchId:string,userId:string):Promise<void>{await request(`/api/branches/${encodeURIComponent(branchId)}/members/${encodeURIComponent(userId)}`,{method:'DELETE'});}
