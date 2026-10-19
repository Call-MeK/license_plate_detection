import { useEffect, useState } from 'react';
import { api, post, errorMessage, type User } from './api';
import ParkingPage from './ParkingPage';
import AdminPage from './AdminPage';

export default function App(){
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[page,setPage]=useState('parking');
 useEffect(()=>{api<User>('/auth/me').then(setUser).catch(()=>setUser(null)).finally(()=>setLoading(false));},[]);
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 if(loading)return <main className="max-w-5xl mx-auto p-5">Äang kiá»ƒm tra Ä‘Äƒng nháº­pâ€¦</main>;
 return <main className="max-w-5xl mx-auto p-4 md:p-6 grid gap-4"><header className="flex flex-wrap justify-between items-center gap-3"><h1>BÃ£i xe cá»¥c bá»™</h1>{user?<p>{user.username} Â· {user.role}</p>:null}</header>
  {error?<p role="alert" className="error">{error}</p>:null}
  {!user?<form className="panel max-w-md" onSubmit={e=>{e.preventDefault();void run(async()=>{setUser(await post<User>('/auth/login',{username,password}));setPassword('');setPage('parking');});}}><h2>ÄÄƒng nháº­p</h2><label>TÃªn Ä‘Äƒng nháº­p<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Máº­t kháº©u<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>ÄÄƒng nháº­p</button></form>:<>
   <nav aria-label="Äiá»u hÆ°á»›ng" className="flex flex-wrap gap-3"><button aria-pressed={page==='parking'} onClick={()=>setPage('parking')}>Váº­n hÃ nh bÃ£i xe</button>{user.role==='ADMIN'?<button aria-pressed={page==='admin'} onClick={()=>setPage('admin')}>Quáº£n trá»‹</button>:null}<button disabled={busy} onClick={()=>void run(async()=>{await post('/auth/logout');setUser(null);setPage('parking');})}>ÄÄƒng xuáº¥t</button></nav>
   {page==='admin' && user.role==='ADMIN'?<AdminPage/>:<ParkingPage user={user}/>}
   <details className="panel"><summary>Äá»•i máº­t kháº©u</summary><form className="grid gap-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await post('/auth/password',{currentPassword,newPassword});setCurrentPassword('');setNewPassword('');setUser(null);});}}><label>Máº­t kháº©u hiá»‡n táº¡i<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></label><label>Máº­t kháº©u má»›i<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><p>Äá»•i máº­t kháº©u sáº½ káº¿t thÃºc cÃ¡c phiÃªn Ä‘Äƒng nháº­p.</p><button disabled={busy}>LÆ°u máº­t kháº©u</button></form></details>
  </>}
 </main>;
}

