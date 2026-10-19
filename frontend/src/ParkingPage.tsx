import { useCallback, useEffect, useRef, useState } from 'react';
import Camera from './Camera';
import { api, post, ApiError, errorMessage, type User, type Mode, type Confirmation, type ParkingSession, type Alert, type Page } from './api';

type Precheck={sourceEventId:string;plateNumber:string;alerts:Alert[];canCheckIn:boolean};
type Preview={sessionId:string;fee:number;durationMinutes:number;asOf:string};
const money=(value:number)=>new Intl.NumberFormat('vi-VN').format(value)+' ₫';
export default function ParkingPage({user}:{user:User}){
 const [mode,setMode]=useState<Mode>('ENTRY'),[vehicleType,setVehicleType]=useState('CAR');
 const [confirmed,setConfirmed]=useState<Confirmation|null>(null),[precheck,setPrecheck]=useState<Precheck|null>(null);
 const [sessions,setSessions]=useState<ParkingSession[]>([]),[history,setHistory]=useState<ParkingSession[]>([]),[alerts,setAlerts]=useState<Alert[]>([]);
 const [selected,setSelected]=useState<ParkingSession|null>(null),[preview,setPreview]=useState<Preview|null>(null);
 const [payment,setPayment]=useState('CASH'),[paid,setPaid]=useState(false),[selectionReason,setSelectionReason]=useState('');
 const [reviewNote,setReviewNote]=useState<Record<string,string>>({}),[reviewStatus,setReviewStatus]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[filter,setFilter]=useState('');
 const [activePage,setActivePage]=useState(1),[activeTotal,setActiveTotal]=useState(0),[appliedFilter,setAppliedFilter]=useState('');
 const [historyPage,setHistoryPage]=useState(1),[historyTotal,setHistoryTotal]=useState(0),[alertPage,setAlertPage]=useState(1),[alertTotal,setAlertTotal]=useState(0);
 const locked=useRef(false),version=useRef(0),keys=useRef(new Map<string,string>());
 const invalidate=useCallback(()=>{version.current++;setConfirmed(null);setPrecheck(null);setPreview(null);setSelected(null);setPaid(false);setSelectionReason('');},[]);
 const confirm=useCallback((value:Confirmation)=>{invalidate();setConfirmed(value);},[invalidate]);
 async function loadActive(page=activePage,plate=appliedFilter){
  const query=new URLSearchParams({status:'ACTIVE',page:String(page)});if(plate.trim())query.set('plateNumber',plate.trim());
  const result=await api<Page<ParkingSession>>(`/parking-sessions?${query}`);
  setSessions(result.items);setActivePage(page);setActiveTotal(result.total);setAppliedFilter(plate);
 }
 async function loadAlerts(page=alertPage){
  const result=await api<Page<Alert>>(`/alerts?status=PENDING&page=${page}`);setAlerts(result.items);setAlertPage(page);setAlertTotal(result.total);
 }
 async function loadHistory(page=historyPage){
  const result=await api<Page<ParkingSession>>(`/parking-sessions?page=${page}`);setHistory(result.items);setHistoryPage(page);setHistoryTotal(result.total);
 }
 async function refresh(){await Promise.all([loadActive(),loadAlerts()]);}
 useEffect(()=>{void refresh().catch(e=>setError(errorMessage(e)));},[]);
 async function run(action:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(errorMessage(e));}finally{locked.current=false;setBusy(false);}
 }
 function requireConfirmation(){
  if(!confirmed || new Date(confirmed.expiresAt).getTime()<=Date.now())throw new Error('Xác nhận biển số đã hết hạn. Hãy xác nhận lại.');
  return confirmed;
 }
 function idempotency(operation:string,body:unknown){
  const signature=JSON.stringify([operation,body]);let key=keys.current.get(signature);
  if(!key){key=crypto.randomUUID();keys.current.set(signature,key);}return key;
 }
 async function checkPreconditions(){
  const event=requireConfirmation(),current=version.current;
  const result=await post<Precheck>('/parking-sessions/check-in/precheck',{sourceEventId:event.sourceEventId,plateNumber:event.plateNumber,vehicleType});
  if(version.current!==current)return;
  setPrecheck(result);
  if(!result.canCheckIn)setNotice('Cần xử lý cảnh báo và kiểm tra lại trước khi ghi nhận xe vào.');
 }
 async function checkIn(){
  const event=requireConfirmation();
  if(!precheck?.canCheckIn || precheck.sourceEventId!==event.sourceEventId)return;
  const body={sourceEventId:event.sourceEventId,plateNumber:event.plateNumber,vehicleType};
  await post('/parking-sessions/check-in',body,idempotency('check-in',body));
  invalidate();setNotice('Đã ghi nhận xe vào.');await refresh();
 }
 async function chooseSession(session:ParkingSession){
  setSelected(session);setPreview(null);setPaid(false);setSelectionReason('');
  const current=version.current;
  const value=await post<Preview>(`/parking-sessions/${session.id}/fee-preview`);
  if(version.current===current)setPreview(value);
 }
 async function checkout(){
  const event=requireConfirmation();if(!selected || !preview || !paid)return;
  if(selected.plateNumber!==event.plateNumber && !selectionReason.trim())throw new Error('Cần lý do chọn phiên có biển số khác.');
  const body={sourceEventId:event.sourceEventId,plateNumber:event.plateNumber,paymentMethod:payment,paymentConfirmed:true,expectedFee:preview.fee,...(selectionReason.trim()?{manualSelectionReason:selectionReason.trim()}: {})};
  try{await post(`/parking-sessions/${selected.id}/check-out`,body,idempotency(`check-out:${selected.id}`,body));}
  catch(e){
   if(e instanceof ApiError && e.code==='FEE_CHANGED'){
    setPaid(false);setPreview(null);
    setPreview(await post<Preview>(`/parking-sessions/${selected.id}/fee-preview`));
    setNotice('Phí đã thay đổi. Kiểm tra phí mới và xác nhận lại đã nhận đủ tiền.');return;
   }throw e;
  }
  invalidate();setNotice('Đã ghi nhận xe ra và thanh toán.');await refresh();
 }
 async function review(alert:Alert){
  const note=reviewNote[alert.id]?.trim(),status=reviewStatus[alert.id];if(!note || !status)return;
  await post(`/alerts/${alert.id}/review`,{note,status});setPrecheck(null);await refresh();
  if(confirmed && mode==='ENTRY')await checkPreconditions();
 }
 const eventAlerts=precheck?.alerts || [];
 const allAlerts=[...alerts,...eventAlerts.filter(alert=>!alerts.some(item=>item.id===alert.id))].filter(alert=>alert.status==='PENDING');
 return <div className="grid gap-4">
  <section className="panel"><div className="flex flex-wrap gap-4"><label>Chế độ<select value={mode} disabled={busy} onChange={e=>{invalidate();setMode(e.target.value as Mode);}}><option value="ENTRY">Xe vào</option><option value="EXIT">Xe ra</option></select></label><p>Nhân viên: {user.username}</p></div></section>
  <fieldset disabled={busy}><Camera mode={mode} onConfirm={confirm} onInvalidate={invalidate}/></fieldset>
  {confirmed?<p className="panel" role="status">Đã xác nhận: {confirmed.plateNumber}</p>:null}
  {error?<p className="error" role="alert">{error} Có thể thử lại; cùng một yêu cầu sẽ giữ mã chống trùng.</p>:null}
  {notice?<p className="notice" role="status">{notice}</p>:null}
  {mode==='ENTRY'?<section className="panel"><h2>Xe vào</h2><label>Loại xe<select value={vehicleType} disabled={busy} onChange={e=>{setVehicleType(e.target.value);setPrecheck(null);}}><option value="CAR">Ô tô</option><option value="MOTORBIKE">Xe máy</option></select></label><div className="flex flex-wrap gap-3"><button disabled={busy || !confirmed} onClick={()=>void run(checkPreconditions)}>Kiểm tra xe vào</button><button disabled={busy || !confirmed || !precheck?.canCheckIn || precheck.sourceEventId!==confirmed.sourceEventId} onClick={()=>void run(checkIn)}>Ghi nhận xe vào</button></div></section>:
   <section className="panel"><h2>Chọn phiên xe đang gửi</h2><form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();void run(()=>loadActive(1,filter));}}><label>Lọc biển số<input value={filter} onChange={e=>setFilter(e.target.value)}/></label><button disabled={busy}>Tìm xe đang gửi</button></form><div className="overflow-x-auto"><table><thead><tr><th>Biển số</th><th>Giờ vào</th><th>Thao tác</th></tr></thead><tbody>{sessions.map(s=><tr key={s.id}><td>{s.plateNumber}</td><td>{new Date(s.checkInAt).toLocaleString('vi-VN')}</td><td><button disabled={busy || !confirmed} onClick={()=>void run(()=>chooseSession(s))}>Chọn {s.plateNumber}</button></td></tr>)}</tbody></table></div>
    <div className="flex gap-3 items-center"><button disabled={busy || activePage===1} onClick={()=>void run(()=>loadActive(activePage-1))}>Xe đang gửi: trang trước</button><span>Trang {activePage} · {activeTotal} xe</span><button disabled={busy || activePage*20>=activeTotal} onClick={()=>void run(()=>loadActive(activePage+1))}>Xe đang gửi: trang sau</button></div>
    {selected?<><p>Phiên: {selected.id} · {selected.plateNumber}</p>{selected.plateNumber!==confirmed?.plateNumber?<label>Lý do chọn phiên khác biển số<input value={selectionReason} disabled={busy} onChange={e=>{setSelectionReason(e.target.value);setPaid(false);}}/></label>:null}
     {preview?<><p className="text-xl font-bold">Phí dự kiến: {money(preview.fee)}</p><p>{preview.durationMinutes} phút · Thời điểm tính: {new Date(preview.asOf).toLocaleString('vi-VN')}</p><label>Phương thức thanh toán<select value={payment} disabled={busy} onChange={e=>{setPayment(e.target.value);setPaid(false);}}><option value="CASH">Tiền mặt</option><option value="TRANSFER">Chuyển khoản</option></select></label><label><input type="checkbox" checked={paid} disabled={busy} onChange={e=>setPaid(e.target.checked)}/>Đã nhận đủ tiền</label><button disabled={busy || !confirmed || !paid || (selected.plateNumber!==confirmed.plateNumber && !selectionReason.trim())} onClick={()=>void run(checkout)}>Ghi nhận xe ra</button></>:null}</>:null}
   </section>}
  <section className="panel"><h2>Cảnh báo chờ xử lý</h2>{allAlerts.length===0?<p>Không có cảnh báo chờ xử lý.</p>:allAlerts.map(alert=><div key={alert.id} className="panel"><h3>{alert.plateNumber} · {alert.status}</h3><label>Trạng thái xử lý {alert.plateNumber}<select value={reviewStatus[alert.id] || ''} disabled={busy} onChange={e=>setReviewStatus({...reviewStatus,[alert.id]:e.target.value})}><option value="">Chọn kết quả</option><option value="REVIEWED">Đã xem xét</option><option value="FALSE_POSITIVE">Cảnh báo nhầm</option></select></label><label>Ghi chú xử lý {alert.plateNumber}<textarea value={reviewNote[alert.id] || ''} disabled={busy} onChange={e=>setReviewNote({...reviewNote,[alert.id]:e.target.value})}/></label><button disabled={busy || !reviewNote[alert.id]?.trim() || !reviewStatus[alert.id]} onClick={()=>void run(()=>review(alert))}>Lưu xử lý {alert.plateNumber}</button></div>)}</section>
  <div className="flex gap-3 items-center"><button disabled={busy || alertPage===1} onClick={()=>void run(()=>loadAlerts(alertPage-1))}>Cảnh báo: trang trước</button><span>Trang {alertPage} · {alertTotal} cảnh báo</span><button disabled={busy || alertPage*20>=alertTotal} onClick={()=>void run(()=>loadAlerts(alertPage+1))}>Cảnh báo: trang sau</button></div>
  <section className="panel"><div className="flex justify-between gap-4"><h2>Lịch sử gửi xe</h2><button disabled={busy} onClick={()=>void run(()=>loadHistory())}>Tải lịch sử</button></div><div className="overflow-x-auto"><table><thead><tr><th>Biển số</th><th>Trạng thái</th><th>Vào</th><th>Ra</th><th>Phí</th></tr></thead><tbody>{history.map(s=><tr key={s.id}><td>{s.plateNumber}</td><td>{s.status}</td><td>{new Date(s.checkInAt).toLocaleString('vi-VN')}</td><td>{s.checkOutAt?new Date(s.checkOutAt).toLocaleString('vi-VN'):'—'}</td><td>{s.fee==null?'—':money(s.fee)}</td></tr>)}</tbody></table></div><div className="flex gap-3 items-center"><button disabled={busy || historyPage===1} onClick={()=>void run(()=>loadHistory(historyPage-1))}>Lịch sử: trang trước</button><span>Trang {historyPage} · {historyTotal} phiên</span><button disabled={busy || historyPage*20>=historyTotal} onClick={()=>void run(()=>loadHistory(historyPage+1))}>Lịch sử: trang sau</button></div></section>
 </div>;
}
