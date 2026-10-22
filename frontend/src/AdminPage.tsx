import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Bike, Car, ChevronDown, ChevronRight, Copy, History, KeyRound, LogIn, LogOut, Pencil, Plus, Receipt, RefreshCw, ScrollText, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { api, patch, post, ApiError, errorMessage, type AdminUser, type AuditLog, type Dossier, type Page, type PricingPolicy, type User, type VehicleType } from './api';
import { calculateFee, billedMinutes, dayLabel, duration, money, time, vehicleLabel, when } from './format';
import { Badge, Dialog, Empty, ErrorText, PageHead, Pager, Plate, Seg, Sheet, SwitchRow, cx, useToast } from './ui';

const roleLabel=(role:string)=>role==='ADMIN'?'Quản trị':'Nhân viên';
function generatePassword(){
 const chars='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(12));
 const text=[...bytes].map(b=>chars[b%chars.length]).join('');
 return `park-${text.slice(0,4)}-${text.slice(4,8)}-${text.slice(8)}`;
}
function friendly(error:unknown){
 if(error instanceof ApiError){
  if(error.code==='LAST_ADMIN')return 'Phải giữ ít nhất một quản trị viên đang hoạt động.';
  if(error.code==='USERNAME_EXISTS')return 'Tên đăng nhập đã tồn tại.';
  if(error.code==='WATCHLIST_EXISTS')return 'Biển số này đã có trong danh sách cảnh báo.';
 }
 return errorMessage(error);
}

// ---------------- Nhân viên ----------------
export function UsersPage({user}:{user:User}){
 const toast=useToast();
 const [rows,setRows]=useState<AdminUser[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [adding,setAdding]=useState(false),[editing,setEditing]=useState<AdminUser|null>(null);
 async function load(next=page){
  setLoading(true);setError('');
  try{const r=await api<Page<AdminUser>>(`/users?page=${next}`);setRows(r.items);setTotal(r.total);setPage(next);}
  catch(e){setError(errorMessage(e));}finally{setLoading(false);}
 }
 useEffect(()=>{void load(1);},[]);
 const activeCount=rows.filter(r=>r.active).length;
 return <>
  <PageHead title="Nhân viên" description={loading?' ':`${total} tài khoản · ${activeCount} đang hoạt động`}>
   <button type="button" className="btn btn-primary" onClick={()=>setAdding(true)}><UserPlus/>Thêm nhân viên</button>
  </PageHead>
  <ErrorText error={error}/>
  <div className="card overflow-x-auto">
   <table className="table">
    <thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Trạng thái</th><th className="w-10"/></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id} className="clickable" tabIndex={0} aria-label={`Sửa ${r.username}`} onClick={()=>setEditing(r)} onKeyDown={e=>{if(e.key==='Enter')setEditing(r);}}>
     <td><div className="flex items-center gap-3"><span className={cx('avatar',r.role==='ADMIN' && 'primary',!r.active && 'opacity-60')}>{r.username[0]?.toUpperCase()}</span>
      <div><b className={cx('font-medium block font-mono',!r.active && 'text-text-3')}>{r.username}</b>{r.id===user.id?<span className="t-meta">Bạn</span>:null}</div></div></td>
     <td>{r.role==='ADMIN'?<Badge tone="primary" dot={false}>Quản trị</Badge>:<Badge dot={false}>Nhân viên</Badge>}</td>
     <td>{r.active?<Badge tone="ok">Hoạt động</Badge>:<Badge>Đã khóa</Badge>}</td>
     <td><ChevronRight className="text-text-3"/></td>
    </tr>)}</tbody>
   </table>
   <Pager page={page} total={total} onPage={p=>void load(p)} disabled={loading} unit="tài khoản"/>
  </div>
  <AddUserSheet open={adding} onClose={()=>setAdding(false)} onCreated={u=>{setAdding(false);toast(`Đã tạo tài khoản ${u.username}`);void load(page);}}/>
  <EditUserSheet target={editing} self={editing?.id===user.id} onClose={()=>setEditing(null)} onSaved={message=>{setEditing(null);toast(message);void load(page);}}/>
 </>;
}

function PasswordField({id,label,value,onChange,hint}:{id:string;label:string;value:string;onChange:(value:string)=>void;hint:string}){
 const toast=useToast();
 return <div className="field"><label htmlFor={id}>{label}</label>
  <div className="control"><input id={id} className="font-mono" autoComplete="new-password" required minLength={12} value={value} onChange={e=>onChange(e.target.value)}/>
   <button type="button" className="btn btn-icon btn-sm" aria-label="Tạo lại mật khẩu" onClick={()=>onChange(generatePassword())}><RefreshCw/></button>
   <button type="button" className="btn btn-icon btn-sm -mr-1.5" aria-label="Sao chép mật khẩu" onClick={()=>void navigator.clipboard?.writeText(value).then(()=>toast('Đã sao chép mật khẩu'),()=>{})}><Copy/></button></div>
  <span className="hint">{hint}</span></div>;
}

function AddUserSheet({open,onClose,onCreated}:{open:boolean;onClose:()=>void;onCreated:(user:AdminUser)=>void}){
 const [username,setUsername]=useState(''),[role,setRole]=useState<'STAFF'|'ADMIN'>('STAFF'),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(open){setUsername('');setRole('STAFF');setPassword(generatePassword());setError('');}},[open]);
 async function submit(){
  setBusy(true);setError('');
  try{onCreated(await post<AdminUser>('/users',{username:username.trim(),password,role}));}catch(e){setError(friendly(e));}finally{setBusy(false);}
 }
 return <Sheet open={open} onClose={onClose} title="Thêm nhân viên"
  footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Hủy</button><button type="submit" form="add-user" className="btn btn-primary" disabled={busy}>Tạo tài khoản</button></>}>
  <form id="add-user" className="grid gap-5" onSubmit={e=>{e.preventDefault();void submit();}}>
   <ErrorText error={error}/>
   <div className="field"><label htmlFor="new-username">Tên đăng nhập</label><div className="control"><input id="new-username" className="font-mono" required pattern="[A-Za-z0-9_.\-]+" placeholder="nv.a" value={username} onChange={e=>setUsername(e.target.value)}/></div><span className="hint">Chữ, số và . _ - (không dấu, không khoảng trắng)</span></div>
   <fieldset className="grid gap-2"><legend className="t-label mb-2">Vai trò</legend>
    <label className="radio-card"><input type="radio" name="new-role" checked={role==='STAFF'} onChange={()=>setRole('STAFF')}/><span><b className="font-medium block text-[14px]">Nhân viên</b><span className="t-meta">Ghi nhận xe vào/ra, xử lý cảnh báo, xem lịch sử</span></span></label>
    <label className="radio-card"><input type="radio" name="new-role" checked={role==='ADMIN'} onChange={()=>setRole('ADMIN')}/><span><b className="font-medium block text-[14px]">Quản trị</b><span className="t-meta">Thêm: nhân viên, biểu phí, danh sách cảnh báo, nhật ký</span></span></label>
   </fieldset>
   <PasswordField id="new-password" label="Mật khẩu tạm" value={password} onChange={setPassword} hint="Ít nhất 12 ký tự · gửi cho nhân viên và nhắc đổi sau khi đăng nhập"/>
  </form>
 </Sheet>;
}

function EditUserSheet({target,self,onClose,onSaved}:{target:AdminUser|null;self:boolean;onClose:()=>void;onSaved:(message:string)=>void}){
 const [role,setRole]=useState<'STAFF'|'ADMIN'>('STAFF'),[active,setActive]=useState(true),[password,setPassword]=useState(''),[reset,setReset]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(target){setRole(target.role);setActive(target.active);setPassword('');setReset(false);setError('');}},[target?.id]);
 if(!target)return null;
 const changes={...(role!==target.role?{role}:{}),...(active!==target.active?{active}:{}),...(reset?{password}:{})};
 async function submit(){
  if(!target)return;
  setBusy(true);setError('');
  try{await patch(`/users/${target.id}`,changes);onSaved(`Đã lưu thay đổi cho ${target.username}`);}catch(e){setError(friendly(e));}finally{setBusy(false);}
 }
 return <Sheet open onClose={onClose} title={`Sửa ${target.username}`}
  head={<><span className={cx('avatar',target.role==='ADMIN' && 'primary')}>{target.username[0]?.toUpperCase()}</span><div><h2 className="h-section font-mono">{target.username}</h2><p className="t-meta">{roleLabel(target.role)}</p></div></>}
  footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Hủy</button><button type="submit" form="edit-user" className="btn btn-primary" disabled={busy || !Object.keys(changes).length}>Lưu</button></>}>
  <form id="edit-user" className="grid gap-5" onSubmit={e=>{e.preventDefault();void submit();}}>
   <ErrorText error={error}/>
   <div className="grid gap-2"><span className="t-label">Vai trò</span><Seg label="Vai trò" block value={role} onChange={setRole} options={[{value:'STAFF',label:'Nhân viên'},{value:'ADMIN',label:'Quản trị'}]}/></div>
   <SwitchRow title="Cho phép đăng nhập" hint="Tắt để khóa tài khoản, lịch sử vẫn giữ" checked={active} onChange={setActive}/>
   <hr className="divider"/>
   {reset?<PasswordField id="reset-password" label="Mật khẩu mới" value={password} onChange={setPassword} hint="Ít nhất 12 ký tự · lưu xong tài khoản sẽ bị đăng xuất khỏi mọi thiết bị"/>
    :<div className="flex items-center gap-3"><div className="flex-1"><b className="font-medium block text-[14px]">Đặt lại mật khẩu</b><span className="t-meta">Tạo mật khẩu tạm mới cho nhân viên</span></div>
     <button type="button" className="btn btn-secondary btn-sm" onClick={()=>{setPassword(generatePassword());setReset(true);}}><KeyRound/>Đặt lại</button></div>}
   {self && (role!==target.role || !active)?<p className="callout callout-warn">Bạn đang đổi chính tài khoản của mình; sau khi lưu sẽ cần đăng nhập lại.</p>:null}
  </form>
 </Sheet>;
}

// ---------------- Biểu phí ----------------
const TYPES:{value:VehicleType;icon:LucideIcon}[]=[{value:'CAR',icon:Car},{value:'MOTORBIKE',icon:Bike}];
export function PricingPage(){
 const toast=useToast();
 const [rows,setRows]=useState<PricingPolicy[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState<VehicleType|null>(null);
 async function load(){
  setLoading(true);setError('');
  try{setRows((await api<Page<PricingPolicy>>('/pricing-policies?pageSize=100')).items || []);}catch(e){setError(errorMessage(e));}finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[]);
 const active=(type:VehicleType)=>rows.find(r=>r.active && r.vehicleType===type);
 const history=[...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return <>
  <PageHead title="Biểu phí" description="Giá mới áp dụng cho xe vào sau khi lưu. Xe đang gửi giữ giá cũ."/>
  <ErrorText error={error}/>
  <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
   {TYPES.map(({value,icon:Icon})=>{const p=active(value);return <section key={value} className="card p-5" aria-label={`Biểu phí ${vehicleLabel(value).toLowerCase()}`}>
    <div className="flex items-center gap-3 mb-5"><span className="grid place-items-center w-10 h-10 rounded-[10px] bg-primary-soft text-primary"><Icon className="ic-lg"/></span>
     <div><h2 className="h-section">{vehicleLabel(value)}</h2><p className="t-meta">{p?`Áp dụng từ ${when(p.createdAt)}`:'Chưa có biểu phí'}</p></div>
     <button type="button" className="btn btn-secondary btn-sm ml-auto" disabled={loading} onClick={()=>setEditing(value)}>{p?'Đổi giá':'Đặt giá'}</button></div>
    {loading?<div className="skeleton h-12"/>:p?<><p className="text-[32px] font-semibold tracking-[-.02em] tnum">{money(Number(p.hourlyRate))}<span className="text-[15px] text-text-3 font-medium"> / giờ</span></p>
     <p className="t-meta mt-1">Làm tròn lên mỗi {p.roundingMinutes} phút</p></>
     :<p className="t-meta">Xe loại này chưa vào được cho tới khi có biểu phí.</p>}
   </section>;})}
  </div>
  {history.length?<details className="card mt-4 max-w-4xl group">
   <summary className="flex items-center gap-2 px-5 py-3.5 cursor-pointer list-none"><History className="text-text-3"/><span className="font-medium text-[14px]">Lịch sử thay đổi</span><span className="t-meta">· {history.length} lần</span>
    <ChevronDown className="ml-auto text-text-3 transition-transform group-open:rotate-180"/></summary>
   <div className="overflow-x-auto"><table className="table border-t border-border">
    <thead><tr><th>Loại xe</th><th className="num">Giá / giờ</th><th className="num hidden sm:table-cell">Làm tròn</th><th>Áp dụng từ</th><th>Phiên bản</th></tr></thead>
    <tbody>{history.map(p=><tr key={p.id} className={cx(!p.active && 'text-text-3')}><td>{vehicleLabel(p.vehicleType)}</td><td className="num tnum">{money(Number(p.hourlyRate))}</td><td className="num hidden sm:table-cell">{p.roundingMinutes} phút</td><td className="tnum">{when(p.createdAt)}</td><td>v{p.version}{p.active?<span className="ml-2"><Badge tone="ok">Đang dùng</Badge></span>:null}</td></tr>)}</tbody>
   </table></div>
  </details>:null}
  <PriceDialog type={editing} current={editing?active(editing):undefined} onClose={()=>setEditing(null)} onSaved={()=>{toast(`Đã lưu biểu phí ${vehicleLabel(editing || 'CAR').toLowerCase()}`);setEditing(null);void load();}}/>
 </>;
}

const EXAMPLE_MINUTES=130;
function PriceDialog({type,current,onClose,onSaved}:{type:VehicleType|null;current?:PricingPolicy;onClose:()=>void;onSaved:()=>void}){
 const [rate,setRate]=useState(''),[rounding,setRounding]=useState('60'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(type){setRate(current?String(Number(current.hourlyRate)):'');setRounding(String(current?.roundingMinutes || 60));setError('');}},[type]);
 const value=Number(rate.replace(/\D/g,'')),step=Number(rounding),options=[...new Set([15,30,60,step])].sort((a,b)=>a-b);
 async function submit(){
  setBusy(true);setError('');
  try{await post('/pricing-policies',{vehicleType:type,hourlyRate:value,roundingMinutes:step});onSaved();}catch(e){setError(friendly(e));}finally{setBusy(false);}
 }
 return <Dialog open={!!type} onClose={onClose} title={`Đổi giá ${vehicleLabel(type || 'CAR').toLowerCase()}`} description="Giá mới áp dụng cho xe vào từ lúc lưu."
  footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Hủy</button><button type="submit" form="price-form" className="btn btn-primary" disabled={busy || !rate}>Lưu giá mới</button></>}>
  <form id="price-form" className="grid gap-4" onSubmit={e=>{e.preventDefault();void submit();}}>
   <ErrorText error={error}/>
   <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
    <div className="field"><label htmlFor="rate">Giá mỗi giờ</label><div className="control"><input id="rate" inputMode="numeric" required className="tnum min-w-0" value={rate} onChange={e=>setRate(e.target.value.replace(/\D/g,''))}/><span className="t-meta">₫</span></div></div>
    <div className="field"><label htmlFor="rounding">Làm tròn lên</label><div className="control select"><select id="rounding" value={rounding} onChange={e=>setRounding(e.target.value)}>{options.map(o=><option key={o} value={o}>{o} phút</option>)}</select></div></div>
   </div>
   <div className="rounded-[10px] bg-subtle border border-border p-3.5">
    <p className="eyebrow mb-1.5">Ví dụ</p>
    <p className="text-[14px]">Gửi <b>{duration(EXAMPLE_MINUTES)}</b> → tính <b className="tnum">{duration(billedMinutes(EXAMPLE_MINUTES,step))}</b> → <b className="tnum text-primary">{money(calculateFee(EXAMPLE_MINUTES,value,step))}</b></p>
   </div>
  </form>
 </Dialog>;
}

// ---------------- Xe cần cảnh báo ----------------
export function WatchlistPage(){
 const toast=useToast();
 const [rows,setRows]=useState<Dossier[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState<'ACTIVE'|'INACTIVE'>('ACTIVE');
 const [editing,setEditing]=useState<Dossier|'new'|null>(null);
 async function load(){
  setLoading(true);setError('');
  try{setRows((await api<Page<Dossier>>('/stolen-vehicles?pageSize=100')).items);}catch(e){setError(errorMessage(e));}finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[]);
 const needle=query.replace(/[^0-9a-z]/gi,'').toUpperCase();
 const count=(s:string)=>rows.filter(r=>r.status===s).length;
 const shown=rows.filter(r=>r.status===status && (!needle || r.plateNumber.replace(/[^0-9a-z]/gi,'').toUpperCase().includes(needle)));
 return <>
  <PageHead title="Xe cần cảnh báo" description="Khi xe trong danh sách qua cổng, nhân viên sẽ được báo ngay.">
   <button type="button" className="btn btn-primary" onClick={()=>setEditing('new')}><Plus/>Thêm biển số</button>
  </PageHead>
  <div className="flex flex-wrap items-center gap-2 mb-4">
   <div className="control w-full sm:w-[260px]"><Search/><input className="font-mono uppercase placeholder:normal-case placeholder:font-sans" placeholder="Tìm biển số" aria-label="Tìm biển số" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="flex gap-2" role="group" aria-label="Trạng thái">
    <button type="button" className="chip" aria-pressed={status==='ACTIVE'} onClick={()=>setStatus('ACTIVE')}>Đang bật · {count('ACTIVE')}</button>
    <button type="button" className="chip" aria-pressed={status==='INACTIVE'} onClick={()=>setStatus('INACTIVE')}>Đã tắt · {count('INACTIVE')}</button>
   </div>
  </div>
  <ErrorText error={error}/>
  <div className="card overflow-hidden">
   {loading?<div className="p-4"><div className="skeleton h-24"/></div>:!shown.length?<Empty icon={ShieldCheck} title={needle?'Không có biển số khớp':status==='ACTIVE'?'Chưa có xe nào cần cảnh báo':'Không có mục nào đã tắt'}/>:
   <div className="divide-y divide-[var(--border)]">
    {shown.map(r=><button type="button" key={r.id} className="row-item" aria-label={`Sửa ${r.plateNumber}`} onClick={()=>setEditing(r)}>
     <Plate>{r.plateNumber}</Plate>
     <span className="flex-1 min-w-0"><span className="block text-[14px] truncate">{r.description}</span><span className="t-meta">Thêm {when(r.createdAt)}</span></span>
     {r.status==='ACTIVE'?<span className="hidden sm:inline-flex"><Badge tone="ok">Đang bật</Badge></span>:<span className="hidden sm:inline-flex"><Badge>Đã tắt</Badge></span>}
     <ChevronRight className="text-text-3"/>
    </button>)}
   </div>}
  </div>
  <DossierSheet value={editing} onClose={()=>setEditing(null)} onSaved={d=>{setEditing(null);toast(`Đã lưu ${d.plateNumber}`);void load();}}/>
 </>;
}

function DossierSheet({value,onClose,onSaved}:{value:Dossier|'new'|null;onClose:()=>void;onSaved:(dossier:Dossier)=>void}){
 const [plate,setPlate]=useState(''),[description,setDescription]=useState(''),[active,setActive]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const existing=value && value!=='new'?value:null;
 useEffect(()=>{if(value){setPlate(existing?.plateNumber || '');setDescription(existing?.description || '');setActive(existing?existing.status==='ACTIVE':true);setError('');}},[value]);
 async function submit(){
  setBusy(true);setError('');
  const body={plateNumber:plate.trim(),description:description.trim(),status:active?'ACTIVE':'INACTIVE'};
  try{onSaved(existing?await patch<Dossier>(`/stolen-vehicles/${existing.id}`,body):await post<Dossier>('/stolen-vehicles',body));}catch(e){setError(friendly(e));}finally{setBusy(false);}
 }
 return <Sheet open={!!value} onClose={onClose} title={existing?'Sửa biển số cần cảnh báo':'Thêm biển số cần cảnh báo'}
  footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Hủy</button><button type="submit" form="dossier-form" className="btn btn-primary" disabled={busy || !plate.trim() || !description.trim()}>Lưu</button></>}>
  <form id="dossier-form" className="grid gap-5" onSubmit={e=>{e.preventDefault();void submit();}}>
   <ErrorText error={error}/>
   <div className="field"><label htmlFor="dossier-plate">Biển số</label><div className="control lg"><input id="dossier-plate" className="font-mono uppercase text-[17px]" required value={plate} onChange={e=>setPlate(e.target.value)}/></div></div>
   <div className="field"><label htmlFor="dossier-description">Lý do</label><div className="control textarea"><textarea id="dossier-description" required placeholder="Ví dụ: báo mất · Honda City trắng" value={description} onChange={e=>setDescription(e.target.value)}/></div><span className="hint">Nhân viên sẽ thấy nội dung này khi xe qua cổng</span></div>
   <SwitchRow title="Đang bật cảnh báo" hint="Tắt khi không cần theo dõi nữa" checked={active} onChange={setActive}/>
  </form>
 </Sheet>;
}

// ---------------- Nhật ký ----------------
type Filters={actorId:string;action:string;entityId:string;dateFrom:string;dateTo:string};
const EMPTY:Filters={actorId:'',action:'',entityId:'',dateFrom:'',dateTo:''};
const ACTIONS:{value:string;label:string;icon:LucideIcon}[]=[
 {value:'PARKING_CHECK_IN',label:'Xe vào',icon:LogIn},{value:'PARKING_CHECK_OUT',label:'Xe ra',icon:LogOut},
 {value:'RECOGNITION_CORRECTED',label:'Sửa biển số',icon:Pencil},{value:'MANUAL_RECOGNITION',label:'Nhập tay',icon:Pencil},
 {value:'ALERT_REVIEWED',label:'Xử lý cảnh báo',icon:ShieldAlert},{value:'PRICING_CREATED',label:'Biểu phí',icon:Receipt},
 {value:'USER_UPDATED',label:'Tài khoản',icon:Users},{value:'LOGIN',label:'Đăng nhập',icon:LogIn},
];
type D=Record<string,unknown>;
const s=(v:unknown)=>v==null?'':String(v);
function describe(log:AuditLog,actor:string):{icon:LucideIcon;tone:string;text:ReactNode}{
 const d=(log.details || {}) as D,who=<b className="font-medium">{actor}</b>,plate=(v:unknown)=><Plate>{s(v)}</Plate>;
 switch(log.action){
  case 'PARKING_CHECK_IN':return {icon:LogIn,tone:'',text:<>{who} cho xe {plate(d.plateNumber)} vào</>};
  case 'PARKING_CHECK_OUT':return {icon:LogOut,tone:'',text:<>{who} cho xe {plate(d.plateNumber)} ra{d.fee!=null?<>, thu <b className="font-medium tnum">{money(Number(d.fee))}</b></>:null}</>};
  case 'ALERT_CREATED':return {icon:ShieldAlert,tone:'danger',text:<>Cảnh báo xe {plate(d.plateNumber)} khi qua cổng</>};
  case 'ALERT_REVIEWED':return {icon:ShieldAlert,tone:'danger',text:<>{who} xử lý cảnh báo: <b className="font-medium">{s(d.status)==='FALSE_POSITIVE'?'Cảnh báo nhầm':'Đã xem xét'}</b></>};
  case 'RECOGNITION_CORRECTED':return {icon:Pencil,tone:'warn',text:<>{who} sửa biển nhận dạng thành {plate(d.plateNumber)}</>};
  case 'MANUAL_RECOGNITION':return {icon:Pencil,tone:'warn',text:<>{who} nhập tay biển {plate(d.plateNumber)}</>};
  case 'PRICING_CREATED':return {icon:Receipt,tone:'primary',text:<>{who} đặt giá {vehicleLabel(s(d.vehicleType)).toLowerCase()} <b className="font-medium tnum">{money(Number(d.hourlyRate))}/giờ</b></>};
  case 'USER_CREATED':return {icon:UserPlus,tone:'primary',text:<>{who} tạo tài khoản <b className="font-medium font-mono">{s(d.username)}</b> ({roleLabel(s(d.role))})</>};
  case 'USER_UPDATED':return {icon:Users,tone:'primary',text:<>{who} cập nhật tài khoản{d.passwordChanged?' (đặt lại mật khẩu)':''}{d.active===false?' (khóa)':d.active===true?' (mở khóa)':''}</>};
  case 'WATCHLIST_CREATED':return {icon:ShieldAlert,tone:'primary',text:<>{who} thêm {plate(d.plateNumber)} vào danh sách cảnh báo</>};
  case 'VEHICLE_UPDATED':{const b=(d.before || {}) as D,a=(d.after || {}) as D;return {icon:Car,tone:'warn',text:<>{who} sửa hồ sơ xe {plate(b.plateNumber)}{s(a.plateNumber)!==s(b.plateNumber)?<> → {plate(a.plateNumber)}</>:null}</>};}
  case 'LOGIN':return {icon:LogIn,tone:'',text:<>{who} đăng nhập</>};
  case 'LOGOUT':return {icon:LogOut,tone:'',text:<>{who} đăng xuất</>};
  case 'PASSWORD_CHANGED':return {icon:KeyRound,tone:'',text:<>{who} đổi mật khẩu</>};
  default:
   if(log.action.startsWith('WATCHLIST_'))return {icon:ShieldAlert,tone:'primary',text:<>{who} cập nhật danh sách cảnh báo {d.plateNumber?plate(d.plateNumber):null}</>};
   return {icon:ScrollText,tone:'',text:<>{who} · <span className="font-mono">{log.action}</span></>};
 }
}
const DETAIL_LABELS:Record<string,string>={reason:'Lý do',note:'Ghi chú',manualSelectionReason:'Lý do chọn lượt',paymentMethod:'Hình thức',mode:'Chế độ',description:'Mô tả',roundingMinutes:'Làm tròn (phút)',sourceEventId:'Mã sự kiện'};
const iconTone:Record<string,string>={'':'bg-muted text-text-2',danger:'bg-danger-soft text-danger',warn:'bg-warn-soft text-warn',primary:'bg-primary-soft text-primary'};
const toIso=(value:string)=>value?new Date(value).toISOString():'';

export function AuditPage(){
 const [rows,setRows]=useState<AuditLog[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [filters,setFilters]=useState<Filters>(EMPTY),[draft,setDraft]=useState<Filters>(EMPTY),[open,setOpen]=useState(false),[users,setUsers]=useState<AdminUser[]>([]);
 const request=useRef(0);
 useEffect(()=>{void api<Page<AdminUser>>('/users?pageSize=100').then(r=>setUsers(r.items || [])).catch(()=>{});},[]);
 useEffect(()=>{
  const id=++request.current,query=new URLSearchParams({page:String(page)});
  Object.entries(filters).forEach(([key,value])=>{if(value)query.set(key,key.startsWith('date')?toIso(value):value);});
  setLoading(true);setError('');
  api<Page<AuditLog>>(`/audit-logs?${query}`).then(r=>{if(id===request.current){setRows(r.items);setTotal(r.total);}})
   .catch(e=>{if(id===request.current)setError(errorMessage(e));}).finally(()=>{if(id===request.current)setLoading(false);});
 },[page,filters]);
 const names=useMemo(()=>new Map(users.map(u=>[u.id,u.username])),[users]);
 const groups=useMemo(()=>{const map=new Map<string,AuditLog[]>();rows.forEach(r=>{const k=dayLabel(r.createdAt);map.set(k,[...(map.get(k) || []),r]);});return [...map];},[rows]);
 const advanced=[filters.actorId,filters.entityId,filters.dateFrom,filters.dateTo].filter(Boolean).length;
 function apply(next:Filters){setFilters(next);setPage(1);}
 return <>
  <PageHead title="Nhật ký" description="Mọi thao tác quan trọng đều được ghi lại, không sửa hay xóa được.">
   <button type="button" className="btn btn-secondary btn-sm" onClick={()=>{setDraft(filters);setOpen(true);}}><SlidersHorizontal/>Lọc nâng cao{advanced?<span className="count">{advanced}</span>:null}</button>
  </PageHead>
  <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="Loại thao tác">
   <button type="button" className="chip" aria-pressed={!filters.action} onClick={()=>apply({...filters,action:''})}><ArrowLeftRight/>Tất cả</button>
   {ACTIONS.map(({value,label,icon:Icon})=><button type="button" key={value} className="chip" aria-pressed={filters.action===value} onClick={()=>apply({...filters,action:filters.action===value?'':value})}><Icon/>{label}</button>)}
  </div>
  <ErrorText error={error}/>
  <div className="max-w-3xl grid gap-6">
   {loading && !rows.length?<div className="skeleton h-40"/>:!rows.length?<div className="card"><Empty icon={ScrollText} title="Không có thao tác nào khớp bộ lọc"/></div>:
   groups.map(([day,items])=><section key={day}>
    <h2 className="eyebrow mb-2">{day}</h2>
    <div className="card overflow-hidden divide-y divide-[var(--border)]">
     {items.map(log=>{const {icon:Icon,tone,text}=describe(log,log.actorId?names.get(log.actorId) || 'Người dùng':'Hệ thống'),d=(log.details || {}) as D;
      return <details key={log.id} className="log">
       <summary className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-subtle">
        <span className={cx('grid place-items-center w-8 h-8 rounded-full shrink-0',iconTone[tone])}><Icon/></span>
        <span className="flex-1 text-[14px] leading-8 min-w-0">{text}</span>
        <span className="t-meta tnum leading-8">{time(log.createdAt)}</span><ChevronRight className="chev text-text-3 transition-transform mt-2"/></summary>
       <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5 text-[13px] px-4 pb-4 sm:pl-[60px]">
        <dt className="text-text-3">Thao tác</dt><dd className="font-mono">{log.action}</dd>
        <dt className="text-text-3">Đối tượng</dt><dd className="font-mono break-all">{log.entityType} · {log.entityId}</dd>
        {Object.entries(DETAIL_LABELS).filter(([k])=>d[k]!=null && d[k]!=='').map(([k,label])=><Fragment key={k}><dt className="text-text-3">{label}</dt><dd className="break-words">{k==='paymentMethod'?(d[k]==='CASH'?'Tiền mặt':'Chuyển khoản'):s(d[k])}</dd></Fragment>)}
       </dl>
      </details>;})}
    </div>
   </section>)}
   {rows.length?<div className="card"><Pager page={page} total={total} onPage={setPage} disabled={loading} unit="thao tác"/></div>:null}
  </div>
  <Dialog open={open} onClose={()=>setOpen(false)} title="Lọc nâng cao"
   footer={<><button type="button" className="btn btn-ghost mr-auto" onClick={()=>{apply({...EMPTY,action:filters.action});setOpen(false);}}>Xóa lọc</button><button type="button" className="btn btn-secondary" onClick={()=>setOpen(false)}>Hủy</button><button type="submit" form="audit-filter" className="btn btn-primary">Áp dụng</button></>}>
   <form id="audit-filter" className="grid gap-4" onSubmit={e=>{e.preventDefault();apply({...draft,action:filters.action});setOpen(false);}}>
    <div className="field"><label htmlFor="f-actor">Người thực hiện</label><div className="control select"><select id="f-actor" value={draft.actorId} onChange={e=>setDraft({...draft,actorId:e.target.value})}><option value="">Tất cả</option>{users.map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select></div></div>
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
     <div className="field"><label htmlFor="f-from">Từ lúc</label><div className="control"><input id="f-from" type="datetime-local" value={draft.dateFrom} onChange={e=>setDraft({...draft,dateFrom:e.target.value})}/></div></div>
     <div className="field"><label htmlFor="f-to">Đến lúc</label><div className="control"><input id="f-to" type="datetime-local" value={draft.dateTo} onChange={e=>setDraft({...draft,dateTo:e.target.value})}/></div></div>
    </div>
    <div className="field"><label htmlFor="f-entity">Mã đối tượng</label><div className="control"><input id="f-entity" className="font-mono" value={draft.entityId} onChange={e=>setDraft({...draft,entityId:e.target.value.trim()})}/></div><span className="hint">Mã lượt gửi, cảnh báo hoặc tài khoản · theo giờ máy này</span></div>
   </form>
  </Dialog>
 </>;
}
