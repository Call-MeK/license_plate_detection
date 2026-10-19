import { useEffect, useState } from 'react';
import { api, post, errorMessage, type Page } from './api';
type Row=Record<string,unknown> & {id:string};
type Section='users'|'stolen-vehicles'|'vehicles'|'pricing-policies'|'audit-logs';
const labels:Record<Section,string>={users:'NhÃ¢n viÃªn','stolen-vehicles':'Danh sÃ¡ch xe cáº§n cáº£nh bÃ¡o',vehicles:'PhÆ°Æ¡ng tiá»‡n','pricing-policies':'Biá»ƒu phÃ­','audit-logs':'Nháº­t kÃ½ kiá»ƒm toÃ¡n'};
function listQuery(section:Section,page:number,filters:Record<string,string>){
 const query=new URLSearchParams({page:String(page)});
 if(section==='audit-logs')Object.entries(filters).forEach(([key,value])=>{if(value)query.set(key,key.startsWith('date')?new Date(value).toISOString():value);});
 return `/${section}?${query}`;
}
export default function AdminPage(){
 const [section,setSection]=useState<Section>('users'),[rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState<Row|null>(null),[page,setPage]=useState(1),[total,setTotal]=useState(0);
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('STAFF'),[active,setActive]=useState(true);
 const [plateNumber,setPlateNumber]=useState(''),[description,setDescription]=useState(''),[status,setStatus]=useState('ACTIVE'),[vehicleType,setVehicleType]=useState('CAR'),[hourlyRate,setHourlyRate]=useState('10000'),[roundingMinutes,setRoundingMinutes]=useState('60');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[history,setHistory]=useState<Row[]>([]),[auditFilters,setAuditFilters]=useState({actorId:'',action:'',entityType:'',entityId:'',dateFrom:'',dateTo:''});
 const [appliedAuditFilters,setAppliedAuditFilters]=useState(auditFilters);
 async function load(nextPage=page){
  const result=await api<Page<Row>>(listQuery(section,nextPage,appliedAuditFilters));setRows(result.items);setTotal(result.total);
 }
 useEffect(()=>{let ignore=false;setBusy(true);setError('');api<Page<Row>>(listQuery(section,page,appliedAuditFilters)).then(result=>{if(!ignore){setRows(result.items);setTotal(result.total);}}).catch(e=>{if(!ignore)setError(errorMessage(e));}).finally(()=>{if(!ignore)setBusy(false);});return()=>{ignore=true;};},[section,page,appliedAuditFilters]);
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 function choose(row:Row|null){
  setSelected(row);setUsername(String(row?.username || ''));setPassword('');setRole(String(row?.role || 'STAFF'));setActive(row?.active!==false);
  setPlateNumber(String(row?.plateNumber || ''));setDescription(String(row?.description || ''));setStatus(String(row?.status || 'ACTIVE'));setVehicleType(String(row?.vehicleType || 'CAR'));setHistory([]);
 }
 async function save(){
  let body:Record<string,unknown>;
  if(section==='users')body=selected?{role,active,...(password?{password}: {})}:{username,password,role};
  else if(section==='stolen-vehicles')body={plateNumber,description,status};
  else if(section==='vehicles')body={plateNumber,vehicleType};
  else body={vehicleType,hourlyRate:Number(hourlyRate),roundingMinutes:Number(roundingMinutes)};
  if(selected)await api(`/${section}/${selected.id}`,{method:'PATCH',body:JSON.stringify(body)});else await post(`/${section}`,body);
  choose(null);setNotice('ÄÃ£ lÆ°u.');await load();
 }
 const columns=rows.length?Object.keys(rows[0]).filter(key=>!['password','passwordHash','password_hash'].includes(key)):[];
 return <section className="panel"><h2>Quáº£n trá»‹</h2><nav aria-label="Danh má»¥c quáº£n trá»‹" className="flex flex-wrap gap-2">{Object.entries(labels).map(([key,label])=><button key={key} disabled={busy} aria-pressed={section===key} onClick={()=>{setSection(key as Section);setPage(1);choose(null);setNotice('');}}>{label}</button>)}</nav>
  {error?<p className="error" role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {section==='audit-logs'?<form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();setPage(1);setAppliedAuditFilters({...auditFilters});}}>{Object.entries({actorId:'NgÆ°á»i thá»±c hiá»‡n (ID)',action:'HÃ nh Ä‘á»™ng',entityType:'Loáº¡i Ä‘á»‘i tÆ°á»£ng',entityId:'Äá»‘i tÆ°á»£ng (ID)',dateFrom:'Tá»« ngÃ y (giá» mÃ¡y nÃ y)',dateTo:'Äáº¿n ngÃ y (giá» mÃ¡y nÃ y)'}).map(([key,label])=><label key={key}>{label}<input type={key.startsWith('date')?'datetime-local':'text'} value={auditFilters[key as keyof typeof auditFilters]} onChange={e=>setAuditFilters({...auditFilters,[key]:e.target.value})}/></label>)}<button disabled={busy}>Lá»c nháº­t kÃ½</button></form>:null}
  <div className="overflow-x-auto"><table><caption className="text-left font-bold my-2">{labels[section]}</caption><thead><tr>{columns.map(key=><th key={key}>{key}</th>)}{['users','stolen-vehicles','vehicles'].includes(section)?<th>Thao tÃ¡c</th>:null}</tr></thead><tbody>{rows.map(row=><tr key={row.id}>{columns.map(key=><td key={key}>{typeof row[key]==='object'?JSON.stringify(row[key]):String(row[key]??'â€”')}</td>)}{['users','stolen-vehicles','vehicles'].includes(section)?<td><button disabled={busy} onClick={()=>choose(row)}>Sá»­a {String(row.username || row.plateNumber || row.id)}</button>{section==='vehicles'?<button disabled={busy} onClick={()=>void run(async()=>{setHistory((await api<Page<Row>>(`/vehicles/${row.id}/history`)).items);})}>Lá»‹ch sá»­ {String(row.plateNumber)}</button>:null}</td>:null}</tr>)}</tbody></table>{!rows.length?<p>ChÆ°a cÃ³ dá»¯ liá»‡u.</p>:null}</div>
  <div className="flex gap-3 items-center"><button disabled={busy || page===1} onClick={()=>setPage(page-1)}>Trang trÆ°á»›c</button><span>Trang {page} Â· {total} báº£n ghi</span><button disabled={busy || page*20>=total} onClick={()=>setPage(page+1)}>Trang sau</button><button disabled={busy} onClick={()=>void run(()=>load())}>LÃ m má»›i</button></div>
  {history.length?<div className="overflow-x-auto"><h3>Lá»‹ch sá»­ phÆ°Æ¡ng tiá»‡n</h3><table><thead><tr><th>VÃ o</th><th>Ra</th><th>Tráº¡ng thÃ¡i</th><th>PhÃ­</th></tr></thead><tbody>{history.map(row=><tr key={row.id}><td>{String(row.checkInAt)}</td><td>{String(row.checkOutAt || 'â€”')}</td><td>{String(row.status)}</td><td>{String(row.fee ?? 'â€”')}</td></tr>)}</tbody></table></div>:null}
  {section!=='audit-logs' && (section!=='vehicles' || selected)?<form className="panel" onSubmit={e=>{e.preventDefault();void run(save);}}><h3>{selected?'Chá»‰nh sá»­a':'ThÃªm má»›i'} Â· {labels[section]}</h3>
   {section==='users'?<><label>TÃªn Ä‘Äƒng nháº­p<input required value={username} disabled={!!selected} onChange={e=>setUsername(e.target.value)}/></label><label>{selected?'Máº­t kháº©u má»›i (Ä‘á»ƒ trá»‘ng náº¿u giá»¯ nguyÃªn)':'Máº­t kháº©u'}<input type="password" autoComplete="new-password" required={!selected} minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Vai trÃ²<select value={role} onChange={e=>setRole(e.target.value)}><option value="STAFF">NhÃ¢n viÃªn</option><option value="ADMIN">Quáº£n trá»‹</option></select></label>{selected?<label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>Äang hoáº¡t Ä‘á»™ng</label>:null}</>:null}
   {section==='stolen-vehicles' || section==='vehicles'?<label>Biá»ƒn sá»‘<input value={plateNumber} required onChange={e=>setPlateNumber(e.target.value)}/></label>:null}
   {section==='stolen-vehicles'?<><label>MÃ´ táº£<textarea required value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Tráº¡ng thÃ¡i<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ACTIVE">Äang cáº£nh bÃ¡o</option><option value="INACTIVE">Ngá»«ng cáº£nh bÃ¡o</option></select></label></>:null}
   {section==='vehicles' || section==='pricing-policies'?<label>Loáº¡i xe<select value={vehicleType} onChange={e=>setVehicleType(e.target.value)}><option value="CAR">Ã” tÃ´</option><option value="MOTORBIKE">Xe mÃ¡y</option></select></label>:null}
   {section==='pricing-policies'?<><p>Biá»ƒu phÃ­ má»›i trá»Ÿ thÃ nh phiÃªn báº£n hiá»‡u lá»±c; phiÃªn Ä‘ang gá»­i giá»¯ biá»ƒu phÃ­ khi vÃ o.</p><label>GiÃ¡ má»—i giá» (VND)<input type="number" min="0" required step="1" value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)}/></label><label>LÃ m trÃ²n má»—i (phÃºt)<input type="number" min="1" step="1" required value={roundingMinutes} onChange={e=>setRoundingMinutes(e.target.value)}/></label></>:null}
   <div className="flex gap-3"><button disabled={busy}>LÆ°u</button>{selected?<button type="button" disabled={busy} onClick={()=>choose(null)}>Há»§y sá»­a</button>:null}</div>
  </form>:null}
 </section>;
}

