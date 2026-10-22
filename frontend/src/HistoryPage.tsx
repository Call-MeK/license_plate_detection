import { useEffect, useRef, useState } from 'react';
import { Bike, Car, History, Search } from 'lucide-react';
import { api, patch, errorMessage, type Page, type ParkingSession, type User, type VehicleType } from './api';
import { money, time, vehicleLabel, when } from './format';
import { Badge, Empty, ErrorText, PageHead, Pager, Plate, Seg, Sheet, useToast } from './ui';

type Status=''|'ACTIVE'|'COMPLETED';
type Vehicle={id:string;plateNumber:string;vehicleType:VehicleType};
const STATUS:{value:Status;label:string}[]=[{value:'',label:'Tất cả'},{value:'ACTIVE',label:'Đang gửi'},{value:'COMPLETED',label:'Đã ra'}];

export default function HistoryPage({user,initialQuery=''}:{user:User;initialQuery?:string}){
 const [query,setQuery]=useState(initialQuery),[applied,setApplied]=useState(initialQuery),[status,setStatus]=useState<Status>('');
 const [rows,setRows]=useState<ParkingSession[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [vehicle,setVehicle]=useState<ParkingSession|null>(null),[reload,setReload]=useState(0);
 const request=useRef(0);
 // Tìm biển số phía máy chủ, chờ người dùng gõ xong.
 useEffect(()=>{const timer=window.setTimeout(()=>setApplied(query.trim()),300);return ()=>window.clearTimeout(timer);},[query]);
 useEffect(()=>{setPage(1);},[applied,status]);
 useEffect(()=>{
  const id=++request.current,params=new URLSearchParams({page:String(page)});
  if(status)params.set('status',status);if(applied)params.set('plateNumber',applied);
  setLoading(true);setError('');
  api<Page<ParkingSession>>(`/parking-sessions?${params}`).then(r=>{if(id===request.current){setRows(r.items);setTotal(r.total);}})
   .catch(e=>{if(id===request.current)setError(errorMessage(e));}).finally(()=>{if(id===request.current)setLoading(false);});
 },[page,status,applied,reload]);
 return <>
  <PageHead title="Lịch sử gửi xe" description="Bấm vào một dòng để xem toàn bộ lịch sử của xe đó."/>
  <div className="flex flex-wrap items-center gap-2 mb-4">
   <div className="control w-full sm:w-[260px]"><Search/><input className="font-mono uppercase placeholder:normal-case placeholder:font-sans" placeholder="Tìm biển số" aria-label="Tìm biển số" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <div className="flex flex-wrap gap-2" role="group" aria-label="Trạng thái">
    {STATUS.map(s=><button type="button" key={s.value} className="chip" aria-pressed={status===s.value} onClick={()=>setStatus(s.value)}>{s.label}</button>)}
   </div>
  </div>
  <ErrorText error={error}/>
  <div className="card overflow-x-auto">
   {!loading && !rows.length?<Empty icon={History} title={applied?`Không có lượt gửi nào khớp “${applied}”`:'Chưa có lượt gửi nào'}/>:<table className="table">
    <thead><tr><th>Biển số</th><th className="hidden sm:table-cell">Loại</th><th>Vào</th><th className="hidden md:table-cell">Ra</th><th className="num hidden sm:table-cell">Phí</th><th>Trạng thái</th></tr></thead>
    <tbody>{rows.map(s=><tr key={s.id} className="clickable" tabIndex={0} aria-label={`${s.plateNumber} ${s.status==='ACTIVE'?'đang gửi':'đã ra'}`}
     onClick={()=>setVehicle(s)} onKeyDown={e=>{if(e.key==='Enter')setVehicle(s);}}>
     <td><Plate>{s.plateNumber}</Plate></td>
     <td className="hidden sm:table-cell">{s.vehicleType==='MOTORBIKE'?<Bike className="text-text-3" aria-label="Xe máy"/>:<Car className="text-text-3" aria-label="Ô tô"/>}</td>
     <td className="tnum">{when(s.checkInAt)}</td>
     <td className="hidden md:table-cell tnum">{s.checkOutAt?when(s.checkOutAt):<span className="t-meta">—</span>}</td>
     <td className="num hidden sm:table-cell font-medium">{s.fee==null?<span className="t-meta">—</span>:money(s.fee)}</td>
     <td>{s.status==='ACTIVE'?<Badge tone="primary">Đang gửi</Badge>:<Badge>Đã ra</Badge>}</td>
    </tr>)}</tbody>
   </table>}
   <Pager page={page} total={total} onPage={setPage} disabled={loading} unit="lượt"/>
  </div>
  <VehicleSheet session={vehicle} admin={user.role==='ADMIN'} onClose={()=>setVehicle(null)} onSaved={()=>setReload(r=>r+1)}/>
 </>;
}

function VehicleSheet({session,admin,onClose,onSaved}:{session:ParkingSession|null;admin:boolean;onClose:()=>void;onSaved:()=>void}){
 const toast=useToast();
 const [items,setItems]=useState<ParkingSession[]>([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [info,setInfo]=useState<Vehicle|null>(null),[plate,setPlate]=useState(''),[type,setType]=useState<VehicleType>('CAR'),[busy,setBusy]=useState(false),[editError,setEditError]=useState('');
 const vehicleId=session?.vehicleId;
 useEffect(()=>{
  if(!session)return;
  setItems([]);setError('');setEditError('');setInfo(null);setPlate(session.plateNumber);setType(session.vehicleType);
  if(!vehicleId){setItems([session]);setTotal(1);return;}
  let ignore=false;setLoading(true);
  Promise.all([api<Page<ParkingSession>>(`/vehicles/${vehicleId}/history?pageSize=100`),api<Vehicle>(`/vehicles/${vehicleId}`)])
   .then(([history,v])=>{if(ignore)return;setItems(history.items);setTotal(history.total);setInfo(v);setPlate(v.plateNumber);setType(v.vehicleType);})
   .catch(e=>{if(!ignore)setError(errorMessage(e));}).finally(()=>{if(!ignore)setLoading(false);});
  return ()=>{ignore=true;};
 },[session?.id]);
 async function save(){
  if(!vehicleId)return;
  setBusy(true);setEditError('');
  try{const v=await patch<Vehicle>(`/vehicles/${vehicleId}`,{plateNumber:plate.trim(),vehicleType:type});setInfo(v);toast(`Đã cập nhật hồ sơ ${v.plateNumber}`);onSaved();}
  catch(e){setEditError(errorMessage(e));}finally{setBusy(false);}
 }
 const fees=items.reduce((sum,s)=>sum+(s.fee || 0),0),active=items.some(s=>s.status==='ACTIVE');
 const changed=!!info && (plate.trim().toUpperCase()!==info.plateNumber || type!==info.vehicleType);
 return <Sheet open={!!session} onClose={onClose} title={session?`Lịch sử xe ${session.plateNumber}`:''}
  head={session?<><Plate className="!h-8 !text-[15px]">{info?.plateNumber || session.plateNumber}</Plate><span className="t-meta">{vehicleLabel(info?.vehicleType || session.vehicleType)}</span></>:null}>
  <ErrorText error={error}/>
  <div className="grid grid-cols-3 gap-2">
   <Stat label="Số lượt" value={loading?'…':String(total)}/>
   <Stat label="Tổng phí" value={loading?'…':money(fees)}/>
   <Stat label="Gần nhất" value={items[0]?lastDay(items[0].checkInAt):'—'}/>
  </div>
  <div>
   <p className="eyebrow mb-3">Các lượt gửi</p>
   {loading?<div className="skeleton h-24"/>:<ol className="relative grid gap-4 pl-5 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-[var(--border)]">
    {items.map((s,i)=><li key={s.id} className="relative">
     <span className={`absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full ring-4 ring-[var(--surface)] ${i===0?'bg-primary':'bg-[var(--border-strong)]'}`}/>
     <div className="flex justify-between gap-2"><b className="font-medium text-[14px] tnum">{when(s.checkInAt)} → {s.checkOutAt?time(s.checkOutAt):'đang gửi'}</b><span className="tnum text-[14px] font-medium">{s.fee==null?'—':money(s.fee)}</span></div>
     <p className="t-meta">{vehicleLabel(s.vehicleType)}{s.paymentMethod?` · ${s.paymentMethod==='CASH'?'Tiền mặt':'Chuyển khoản'}`:''}{s.plateNumber!==(info?.plateNumber || session?.plateNumber)?` · ghi nhận là ${s.plateNumber}`:''}</p>
    </li>)}
   </ol>}
  </div>
  {admin && vehicleId?<form className="grid gap-3 rounded-[10px] border border-border p-4" onSubmit={e=>{e.preventDefault();void save();}}>
   <p className="font-medium text-[14px]">Sửa hồ sơ xe</p>
   {active?<p className="t-meta">Xe đang trong bãi, chỉ sửa được sau khi xe ra.</p>:null}
   <ErrorText error={editError}/>
   <div className="field"><label htmlFor="vehicle-plate">Biển số</label><div className="control"><input id="vehicle-plate" className="font-mono uppercase" value={plate} disabled={busy || active} onChange={e=>setPlate(e.target.value)}/></div></div>
   <Seg label="Loại xe" block value={type} disabled={busy || active} onChange={setType} options={[{value:'CAR',label:'Ô tô',icon:Car},{value:'MOTORBIKE',label:'Xe máy',icon:Bike}]}/>
   <button className="btn btn-primary justify-self-start" disabled={busy || active || !changed || !plate.trim()}>Lưu hồ sơ</button>
  </form>:null}
 </Sheet>;
}

const lastDay=(value:string)=>{const text=when(value);return /^\d\d:\d\d$/.test(text)?'Hôm nay':text.replace(/ \d\d:\d\d$/,'');};
function Stat({label,value}:{label:string;value:string}){
 return <div className="rounded-[10px] bg-subtle border border-border p-3 min-w-0"><p className="t-meta">{label}</p><p className="text-[18px] font-semibold tnum truncate">{value}</p></div>;
}
