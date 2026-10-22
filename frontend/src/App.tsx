import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, Eye, EyeOff, Lock, ScanLine, ShieldCheck, SquareParking, User as UserIcon } from 'lucide-react';
import { api, post, errorMessage, type Page, type Alert, type User } from './api';
import Shell, { ADMIN_ROUTES, type Route } from './Shell';
import ParkingPage from './ParkingPage';
import AlertsPage from './AlertsPage';
import HistoryPage from './HistoryPage';
import { AuditPage, PricingPage, UsersPage, WatchlistPage } from './AdminPage';
import { ToastProvider } from './ui';

const ROUTES:Route[]=['ops','alerts','history',...ADMIN_ROUTES];
function readHash():{route:Route;query:string}{
 const [path,search='']=location.hash.replace(/^#\/?/,'').split('?');
 return {route:ROUTES.includes(path as Route)?path as Route:'ops',query:new URLSearchParams(search).get('q') || ''};
}

export default function App(){
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[location_,setLocation]=useState(readHash),[pendingAlerts,setPendingAlerts]=useState(0),[message,setMessage]=useState('');
 useEffect(()=>{api<User>('/auth/me').then(setUser).catch(()=>setUser(null)).finally(()=>setLoading(false));},[]);
 useEffect(()=>{const onHash=()=>setLocation(readHash());addEventListener('hashchange',onHash);return ()=>removeEventListener('hashchange',onHash);},[]);
 const refreshAlerts=useCallback(()=>{void api<Page<Alert>>('/alerts?status=PENDING&pageSize=1').then(r=>setPendingAlerts(r.total)).catch(()=>{});},[]);
 useEffect(()=>{if(user)refreshAlerts();},[user,location_.route]);
 function navigate(route:Route,query=''){location.hash=`/${route}${query?`?q=${encodeURIComponent(query)}`:''}`;setLocation({route,query});}
 if(loading)return <main className="min-h-screen grid place-items-center t-meta">Đang kiểm tra đăng nhập…</main>;
 if(!user)return <Login message={message} onLogin={u=>{setMessage('');setUser(u);}}/>;
 const route=ADMIN_ROUTES.includes(location_.route) && user.role!=='ADMIN'?'ops':location_.route;
 return <ToastProvider><Shell user={user} route={route} pendingAlerts={pendingAlerts} onNavigate={navigate}
  onLogout={()=>void post('/auth/logout').catch(()=>{}).finally(()=>setUser(null))}
  onPasswordChanged={()=>{setMessage('Đã đổi mật khẩu. Đăng nhập lại bằng mật khẩu mới.');setUser(null);}}>
  {route==='ops'?<ParkingPage user={user} onAlertsChanged={refreshAlerts}/>:null}
  {route==='alerts'?<AlertsPage onAlertsChanged={refreshAlerts}/>:null}
  {route==='history'?<HistoryPage key={location_.query} user={user} initialQuery={location_.query}/>:null}
  {route==='users'?<UsersPage user={user}/>:null}
  {route==='pricing'?<PricingPage/>:null}
  {route==='watchlist'?<WatchlistPage/>:null}
  {route==='audit'?<AuditPage/>:null}
 </Shell></ToastProvider>;
}

function Login({message,onLogin}:{message:string;onLogin:(user:User)=>void}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){
  setBusy(true);setError('');
  try{onLogin(await post<User>('/auth/login',{username,password}));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <main className="min-h-screen grid lg:grid-cols-[1fr_minmax(0,560px)] bg-surface">
  <section className="hidden lg:flex relative flex-col justify-between p-12 text-white overflow-hidden bg-primary">
   <div aria-hidden="true" className="absolute inset-0 opacity-[.07]" style={{backgroundImage:'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',backgroundSize:'48px 48px',maskImage:'radial-gradient(ellipse at 30% 40%,#000 0%,transparent 70%)'}}/>
   <div className="relative flex items-center gap-2.5"><span className="grid place-items-center w-8 h-8 rounded-[8px] bg-white text-primary"><SquareParking/></span><span className="font-semibold">ParkSense</span></div>
   <div className="relative max-w-md">
    <p className="eyebrow !text-white/50 mb-4">Hệ thống bãi xe</p>
    <p className="text-[40px] leading-[1.1] font-semibold tracking-[-.02em] mb-5">Nhận diện biển số.<br/>Ghi nhận trong một chạm.</p>
    <p className="text-white/70 text-[15px] leading-relaxed">Camera đọc biển số, hệ thống tự kiểm tra cảnh báo và tính phí. Nhân viên chỉ cần xác nhận.</p>
   </div>
   <div className="relative flex items-center gap-6 text-[13px] text-white/60"><span className="flex items-center gap-2"><ScanLine/>Nhận diện tự động</span><span className="flex items-center gap-2"><ShieldCheck/>Có nhật ký kiểm toán</span></div>
  </section>
  <section className="flex items-center justify-center px-4 py-12 sm:px-10">
   <form className="w-full max-w-[380px] grid gap-5 enter" onSubmit={e=>{e.preventDefault();void submit();}}>
    <div className="lg:hidden flex items-center gap-2.5 mb-4"><span className="grid place-items-center w-8 h-8 rounded-[8px] bg-primary text-white"><SquareParking/></span><span className="font-semibold">ParkSense</span></div>
    <div><h1 className="text-[24px] font-semibold tracking-[-.01em]">Đăng nhập</h1><p className="t-meta mt-1">Dùng tài khoản do quản trị viên cấp.</p></div>
    {message?<div className="callout callout-ok" role="status"><ShieldCheck/><span>{message}</span></div>:null}
    {error?<div className="callout callout-danger" role="alert"><CircleAlert/><span>{error}</span></div>:null}
    <div className="field"><label htmlFor="login-user">Tên đăng nhập</label><div className="control lg"><UserIcon/><input id="login-user" autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></div></div>
    <div className="field"><label htmlFor="login-pass">Mật khẩu</label><div className="control lg"><Lock/><input id="login-pass" type={show?'text':'password'} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>
     <button type="button" className="btn btn-icon btn-sm -mr-1.5" aria-label={show?'Ẩn mật khẩu':'Hiện mật khẩu'} onClick={()=>setShow(!show)}>{show?<EyeOff/>:<Eye/>}</button></div></div>
    <button className="btn btn-primary btn-xl btn-block mt-1" disabled={busy}>{busy?'Đang đăng nhập…':<>Đăng nhập <ArrowRight/></>}</button>
    <p className="t-meta text-center">Quên mật khẩu? Liên hệ quản trị viên để được cấp lại.</p>
   </form>
  </section>
 </main>;
}
