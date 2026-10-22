import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, ChevronRight, CornerDownLeft, History, KeyRound, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Receipt, ScanLine, ScrollText, Search, Settings2, ShieldAlert, SquareParking, Users, type LucideIcon } from 'lucide-react';
import { post, errorMessage, type User } from './api';
import { Dialog, ErrorText, cx, useHotkeys } from './ui';

export type Route='ops'|'alerts'|'history'|'users'|'pricing'|'watchlist'|'audit';
export const ADMIN_ROUTES:Route[]=['users','pricing','watchlist','audit'];
type NavItem={id:Route;label:string;icon:LucideIcon};
const NAV:NavItem[]=[{id:'ops',label:'Vận hành',icon:ScanLine},{id:'alerts',label:'Cảnh báo',icon:Bell},{id:'history',label:'Lịch sử',icon:History}];
const ADMIN:NavItem[]=[{id:'users',label:'Nhân viên',icon:Users},{id:'pricing',label:'Biểu phí',icon:Receipt},{id:'watchlist',label:'Xe cần cảnh báo',icon:ShieldAlert},{id:'audit',label:'Nhật ký',icon:ScrollText}];
const TITLES:Record<Route,string>=Object.fromEntries([...NAV,...ADMIN].map(n=>[n.id,n.label])) as Record<Route,string>;
const roleLabel=(role:User['role'])=>role==='ADMIN'?'Quản trị viên':'Nhân viên';

function readCollapsed(){try{return localStorage.getItem('sidebar')==='collapsed';}catch{return false;}}

type Props={user:User;route:Route;pendingAlerts:number;onNavigate:(route:Route,query?:string)=>void;onLogout:()=>void;onPasswordChanged:()=>void;children:ReactNode};
export default function Shell({user,route,pendingAlerts,onNavigate,onLogout,onPasswordChanged,children}:Props){
 const [collapsed,setCollapsed]=useState(readCollapsed),[menu,setMenu]=useState(false),[password,setPassword]=useState(false),[palette,setPalette]=useState(false);
 const isAdmin=user.role==='ADMIN',isAdminRoute=ADMIN_ROUTES.includes(route);
 useHotkeys();
 useEffect(()=>{try{localStorage.setItem('sidebar',collapsed?'collapsed':'expanded');}catch{/* chỉ là tiện ích */}},[collapsed]);
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='k'){e.preventDefault();setPalette(true);}};
  document.addEventListener('keydown',onKey);return ()=>document.removeEventListener('keydown',onKey);
 },[]);
 const link=(n:NavItem)=>{
  const on=n.id===route,Icon=n.icon;
  return <button key={n.id} type="button" onClick={()=>onNavigate(n.id)} aria-current={on?'page':undefined} title={collapsed?n.label:undefined}
   className={cx('flex items-center gap-3 h-9 px-3 rounded-[10px] text-[14px] w-full text-left transition-colors',on?'bg-surface border border-border shadow-[var(--shadow-xs)] font-medium text-text':'text-text-2 hover:bg-muted hover:text-text border border-transparent',collapsed && 'justify-center px-0')}>
   <Icon className={on?'text-primary':''}/>{collapsed?null:<span className="flex-1 truncate">{n.label}</span>}
   {n.id==='alerts' && pendingAlerts?<span className={cx('count',collapsed && 'absolute ml-5 -mt-5')}>{pendingAlerts}</span>:null}
  </button>;
 };
 return <div className="min-h-screen md:flex">
  <aside className={cx('hidden md:flex flex-col shrink-0 sticky top-0 h-screen border-r border-border bg-subtle transition-[width] duration-200',collapsed?'w-16':'w-60')} aria-label="Điều hướng chính">
   <div className={cx('flex items-center gap-2.5 h-14 px-4',collapsed && 'justify-center px-0')}>
    <span className="grid place-items-center w-7 h-7 rounded-[7px] bg-primary text-white shrink-0"><SquareParking/></span>
    {collapsed?null:<><span className="font-semibold">ParkSense</span><button type="button" className="btn btn-icon btn-sm ml-auto" onClick={()=>setCollapsed(true)} aria-label="Thu gọn thanh bên"><PanelLeftClose/></button></>}
   </div>
   <nav className="grid gap-1 px-3 pt-1">{NAV.map(link)}</nav>
   {isAdmin?<nav className="grid gap-1 px-3 mt-5" aria-label="Quản trị">{collapsed?<hr className="divider mb-2"/>:<p className="eyebrow px-3 mb-1">Quản trị</p>}{ADMIN.map(link)}</nav>:null}
   <div className="mt-auto border-t border-border p-3 grid gap-2">
    {collapsed?<button type="button" className="btn btn-icon btn-sm justify-self-center" onClick={()=>setCollapsed(false)} aria-label="Mở rộng thanh bên"><PanelLeftOpen/></button>:null}
    <div className={cx('flex items-center gap-3 px-1',collapsed && 'justify-center')}><span className="avatar primary">{user.username[0]?.toUpperCase()}</span>
     {collapsed?null:<div className="min-w-0"><p className="text-[13px] font-medium truncate">{user.username}</p><p className="t-meta text-[12px]">{roleLabel(user.role)}</p></div>}</div>
   </div>
  </aside>

  <div className="flex-1 min-w-0 flex flex-col">
   <header className="sticky top-0 z-20 flex items-center gap-3 h-14 px-4 md:px-6 border-b border-border bg-[rgb(247_248_250/.85)] backdrop-blur">
    <span className="md:hidden grid place-items-center w-7 h-7 rounded-[7px] bg-primary text-white"><SquareParking/></span>
    {isAdminRoute?<><span className="t-meta hidden sm:inline">Quản trị</span><ChevronRight className="text-text-3 hidden sm:block"/></>:null}
    <span className="font-semibold text-[15px] truncate">{TITLES[route]}</span>
    <div className="ml-auto flex items-center gap-2">
     <button type="button" className="search w-9 sm:w-[240px] justify-center sm:justify-start" onClick={()=>setPalette(true)} aria-label="Tìm biển số"><Search/><span className="hidden sm:inline flex-1 text-left">Tìm biển số…</span><span className="hidden sm:inline-flex kbd">Ctrl K</span></button>
     <div className="relative">
      <button type="button" className="avatar primary cursor-pointer" aria-haspopup="menu" aria-expanded={menu} onClick={()=>setMenu(!menu)} aria-label="Tài khoản">{user.username[0]?.toUpperCase()}</button>
      {menu?<><div className="fixed inset-0 z-40" onClick={()=>setMenu(false)}/>
       <div className="menu right-0 top-10" role="menu">
        <div className="px-2.5 py-2"><p className="font-medium text-[14px]">{user.username}</p><p className="t-meta">{roleLabel(user.role)}</p></div><hr className="divider my-1"/>
        <button type="button" role="menuitem" className="menu-item" onClick={()=>{setMenu(false);setPassword(true);}}><KeyRound/>Đổi mật khẩu</button>
        <button type="button" role="menuitem" className="menu-item" onClick={()=>{setMenu(false);onLogout();}}><LogOut/>Đăng xuất</button>
       </div></>:null}
     </div>
    </div>
   </header>
   <main className="flex-1 w-full max-w-[1400px] mx-auto p-4 md:p-6 pb-24 md:pb-10">{children}</main>
  </div>

  <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-4 h-16 border-t border-border bg-surface" aria-label="Điều hướng chính">
   {[...NAV,...(isAdmin?[{id:'users' as Route,label:'Quản trị',icon:Settings2}]:[])].map(n=>{const on=n.id==='users'?isAdminRoute:n.id===route,Icon=n.icon;
    return <button key={n.id} type="button" onClick={()=>onNavigate(n.id)} aria-current={on?'page':undefined} className={cx('relative grid place-items-center content-center gap-1 text-[12px]',on?'text-primary font-medium':'text-text-3')}>
     <Icon className="ic-lg"/>{n.label}{n.id==='alerts' && pendingAlerts?<span className="count absolute top-2 left-1/2 ml-1">{pendingAlerts}</span>:null}</button>;})}
  </nav>

  <PasswordDialog open={password} onClose={()=>setPassword(false)} onChanged={onPasswordChanged}/>
  <CommandPalette open={palette} onClose={()=>setPalette(false)} isAdmin={isAdmin} onNavigate={(r,q)=>{setPalette(false);onNavigate(r,q);}}/>
 </div>;
}

function PasswordDialog({open,onClose,onChanged}:{open:boolean;onClose:()=>void;onChanged:()=>void}){
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(open){setCurrent('');setNext('');setError('');}},[open]);
 async function submit(){
  setBusy(true);setError('');
  try{await post('/auth/password',{currentPassword:current,newPassword:next});onClose();onChanged();}
  catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <Dialog open={open} onClose={onClose} title="Đổi mật khẩu" description="Đổi xong bạn sẽ cần đăng nhập lại trên mọi thiết bị.">
  <form id="password-form" className="grid gap-4" onSubmit={e=>{e.preventDefault();void submit();}}>
   <ErrorText error={error}/>
   <div className="field"><label htmlFor="pw-current">Mật khẩu hiện tại</label><div className="control"><input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)}/></div></div>
   <div className="field"><label htmlFor="pw-new">Mật khẩu mới</label><div className="control"><input id="pw-new" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={e=>setNext(e.target.value)}/></div><span className="hint">Ít nhất 12 ký tự</span></div>
   <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={busy}>Lưu mật khẩu</button></div>
  </form>
 </Dialog>;
}

function CommandPalette({open,onClose,isAdmin,onNavigate}:{open:boolean;onClose:()=>void;isAdmin:boolean;onNavigate:(route:Route,query?:string)=>void}){
 const [query,setQuery]=useState(''),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open){setQuery('');}},[open]);
 if(!open)return null;
 const actions:{label:string;icon:LucideIcon;route:Route}[]=[{label:'Ghi nhận xe vào / ra',icon:LogIn,route:'ops'},{label:'Cảnh báo chờ xử lý',icon:Bell,route:'alerts'},{label:'Lịch sử gửi xe',icon:History,route:'history'},
  ...(isAdmin?[{label:'Biểu phí',icon:Receipt,route:'pricing' as Route},{label:'Nhân viên',icon:Users,route:'users' as Route},{label:'Nhật ký',icon:ScrollText,route:'audit' as Route}]:[])];
 return <><div className="overlay open" onClick={onClose}/>
  <div className="dialog cmd open" role="dialog" aria-modal="true" aria-label="Tìm nhanh" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
   <form className="flex items-center gap-3 px-4 h-14 border-b border-border" onSubmit={e=>{e.preventDefault();if(query.trim())onNavigate('history',query.trim());}}>
    <Search className="text-text-3 ic-lg"/><input ref={input} autoFocus className="flex-1 h-full bg-transparent outline-none text-[15px] font-mono uppercase placeholder:normal-case placeholder:font-sans" placeholder="Nhập biển số rồi Enter…" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Biển số"/>
    <span className="kbd">Esc</span>
   </form>
   <div className="p-2 grid">
    {query.trim()?<button type="button" className="menu-item !h-11" onClick={()=>onNavigate('history',query.trim())}><Search/>Tìm <span className="plate">{query.trim().toUpperCase()}</span> trong lịch sử<CornerDownLeft className="ml-auto"/></button>:null}
    <p className="eyebrow px-2.5 pt-2 pb-1">Đi tới</p>
    {actions.map(a=>{const Icon=a.icon;return <button key={a.route} type="button" className="menu-item" onClick={()=>onNavigate(a.route)}><Icon/>{a.label}</button>;})}
   </div>
  </div></>;
}
