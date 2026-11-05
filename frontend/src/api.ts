export type Mode = 'ENTRY' | 'EXIT';
export type User = {id:string;username:string;role:'ADMIN'|'STAFF'};
export type VehicleType = 'CAR' | 'MOTORBIKE';
export type VehicleHint = {type:VehicleType|null;source:'RECORD'|'SERIES'|'SERIES_SHAPE'|null};
export type Confirmation = {sourceEventId:string;plateNumber:string;expiresAt:string;vehicleHint?:VehicleHint|null};
export type Candidate = {plateNumber:string;bbox:[number,number,number,number];confidence:number;lines?:string[]};
export type Recognition = {id:string;mode:Mode;state:'COLLECTING'|'READY';status:'STABLE'|'UNCERTAIN';plateNumber:string|null;candidates:Candidate[];needsTarget:boolean;sequence:number;stub:boolean;expiresAt:string;vehicleHint?:VehicleHint|null};
export type PricingSnapshot = {hourlyRate:string;roundingMinutes:number;version?:number};
export type ParkingSession = {id:string;vehicleId?:string;plateNumber:string;vehicleType:VehicleType;status:string;checkInAt:string;checkOutAt?:string|null;fee?:number|null;paymentMethod?:string|null;pricingSnapshot?:PricingSnapshot|null};
export type Alert = {id:string;plateNumber:string;status:string;sourceEventId:string;note?:string|null;createdAt?:string;reviewedAt?:string|null;evidence?:{imagePath?:string|null;description?:string;mode?:string;manual?:boolean}};
export type AdminUser = User & {active:boolean};
export type PricingPolicy = {id:string;vehicleType:VehicleType;version:number;hourlyRate:string;roundingMinutes:number;active:boolean;createdAt:string};
export type Dossier = {id:string;plateNumber:string;description:string;status:'ACTIVE'|'INACTIVE';createdAt:string};
export type AuditLog = {id:string;actorId:string|null;action:string;entityType:string;entityId:string;details:Record<string,unknown>|null;createdAt:string};
export type Page<T> = {items:T[];total:number;page:number;pageSize:number};
export class ApiError extends Error {
 constructor(public code:string,message:string,public status:number){super(message);}
}
let csrfToken:Promise<string>|null=null;
function getCsrf(){
 if(!csrfToken)csrfToken=fetch('/api/v1/auth/csrf',{credentials:'include'}).then(async response=>{
  if(!response.ok)throw new Error('Không lấy được mã bảo vệ. Vui lòng đăng nhập lại.');
  return (await response.json()).csrfToken as string;
 }).catch(error=>{csrfToken=null;throw error;});
 return csrfToken;
}
export async function api<T=unknown>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);
 if(options.method && !['GET','HEAD'].includes(options.method.toUpperCase())){
  headers.set('X-CSRF-Token',await getCsrf());
 }
 if(typeof options.body==='string') headers.set('Content-Type','application/json');
 const response=await fetch(`/api/v1${path}`,{...options,headers,credentials:'include'});
 const data=await response.json();
 if(!response.ok){
  if(data.error?.code==='CSRF_INVALID')csrfToken=null;
  throw new ApiError(data.error?.code || 'REQUEST_FAILED',data.error?.message || 'Yêu cầu thất bại',response.status);
 }
 if(path==='/auth/logout' || path==='/auth/password')csrfToken=null;
 return data as T;
}
export function post<T=unknown>(path:string,body?:unknown,key?:string){
 return api<T>(path,{method:'POST',body:body===undefined?undefined:JSON.stringify(body),headers:key?{'Idempotency-Key':key}:undefined});
}
export function patch<T=unknown>(path:string,body:unknown){
 return api<T>(path,{method:'PATCH',body:JSON.stringify(body)});
}
export function errorMessage(error:unknown){return error instanceof Error?error.message:'Không thực hiện được yêu cầu';}
