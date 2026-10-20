import { useEffect, useState } from 'react';
import { api, post, errorMessage, type User } from './api';
import ParkingPage from './ParkingPage';
import AdminPage from './AdminPage';

export default function App(){
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[page,setPage]=useState('parking');
 useEffect(()=>{api<User>('/auth/me').then(setUser).catch(()=>setUser(null)).finally(()=>setLoading(false));},[]);
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 if(loading)return <main className="max-w-5xl mx-auto p-5">Đang kiểm tra đăng nhập…</main>;
 return <main className="max-w-5xl mx-auto p-4 md:p-6 grid gap-4"><header className="flex flex-wrap justify-between items-center gap-3"><h1>Bãi xe cục bộ</h1>{user?<p>{user.username} · {user.role}</p>:null}</header>
  {error?<p role="alert" className="error">{error}</p>:null}
  {!user?<form className="panel max-w-md" onSubmit={e=>{e.preventDefault();void run(async()=>{setUser(await post<User>('/auth/login',{username,password}));setPassword('');setPage('parking');});}}><h2>Đăng nhập</h2><label>Tên đăng nhập<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>Đăng nhập</button></form>:<>
   <nav aria-label="Điều hướng" className="flex flex-wrap gap-3"><button aria-pressed={page==='parking'} onClick={()=>setPage('parking')}>Vận hành bãi xe</button>{user.role==='ADMIN'?<button aria-pressed={page==='admin'} onClick={()=>setPage('admin')}>Quản trị</button>:null}<button disabled={busy} onClick={()=>void run(async()=>{await post('/auth/logout');setUser(null);setPage('parking');})}>Đăng xuất</button></nav>
   {page==='admin' && user.role==='ADMIN'?<AdminPage/>:<ParkingPage user={user}/>}
   <details className="panel"><summary>Đổi mật khẩu</summary><form className="grid gap-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await post('/auth/password',{currentPassword,newPassword});setCurrentPassword('');setNewPassword('');setUser(null);});}}><label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></label><label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><p>Đổi mật khẩu sẽ kết thúc các phiên đăng nhập.</p><button disabled={busy}>Lưu mật khẩu</button></form></details>
  </>}
 </main>;
}

