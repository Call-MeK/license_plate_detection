export type Mode = 'ENTRY' | 'EXIT';
export type User = {id:string;username:string;role:'ADMIN'|'STAFF'};
export type Confirmation = {sourceEventId:string;plateNumber:string;expiresAt:string};
export type Candidate = {plateNumber:string;bbox:[number,number,number,number];confidence:number};
export type Recognition = {id:string;mode:Mode;state:'COLLECTING'|'READY';status:'STABLE'|'UNCERTAIN';plateNumber:string|null;candidates:Candidate[];needsTarget:boolean;sequence:number;stub:boolean;expiresAt:string};
export type ParkingSession = {id:string;vehicleId?:string;plateNumber:string;vehicleType:'CAR'|'MOTORBIKE';status:string;checkInAt:string;checkOutAt?:string|null;fee?:number|null;paymentMethod?:string|null;pricingSnapshot?:unknown};
export type Alert = {id:string;plateNumber:string;status:string;decision?:'ALLOW'|'BLOCK'|null;sourceEventId:string;note?:string;evidence?:{imagePath:string|null}};
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
 const data=await response.json().catch(()=>null);
 if(!response.ok){
  const frameError=path.endsWith('/frames')?({413:'FRAME_TOO_LARGE',422:'INVALID_FRAME',503:'AI_UNAVAILABLE'} as Record<number,string>)[response.status]:undefined;
  const code=data?.error?.code || frameError || 'REQUEST_FAILED';
  const messages:Record<string,string>={
   FRAME_TOO_LARGE:'Khung hình quá lớn. Chọn video nhỏ hơn hoặc nhập thủ công có lý do.',
   INVALID_FRAME:'Khung hình không hợp lệ. Mở lại camera, chọn video khác hoặc nhập thủ công có lý do.',
   AI_UNAVAILABLE:'AI chưa sẵn sàng. Kiểm tra model offline hoặc nhập thủ công có lý do.',
  };
  if(code==='CSRF_INVALID')csrfToken=null;
  throw new ApiError(code,messages[code] || data?.error?.message || 'Yêu cầu thất bại',response.status);
 }
 if(path==='/auth/logout' || path==='/auth/password')csrfToken=null;
 return data as T;
}
export function post<T=unknown>(path:string,body?:unknown,key?:string){
 return api<T>(path,{method:'POST',body:body===undefined?undefined:JSON.stringify(body),headers:key?{'Idempotency-Key':key}:undefined});
}
export function errorMessage(error:unknown){return error instanceof Error?error.message:'Không thực hiện được yêu cầu';}
