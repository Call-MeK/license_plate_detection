import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, Bike, Car, Check, CircleAlert, CircleCheck, LogIn, LogOut, Pencil, QrCode, RotateCw, Search, SearchX, ShieldAlert, TriangleAlert } from 'lucide-react';
import { CameraCard, PlateStep, useRecognition } from './Camera';
import { AlertReview } from './AlertsPage';
import { api, post, ApiError, errorMessage, type User, type Mode, type Confirmation, type ParkingSession, type Alert, type Page, type PricingPolicy, type VehicleType } from './api';
import { billedMinutes, duration, money, time, vehicleLabel, vehicleTypeFromPlate } from './format';
import { Badge, Callout, Pager, Plate, Seg, Sheet, SwitchRow, cx, useToast } from './ui';

type Precheck={sourceEventId:string;plateNumber:string;alerts:Alert[];canCheckIn:boolean};
type Preview={sessionId:string;fee:number;durationMinutes:number;asOf:string};
type Done={mode:Mode;plateNumber:string;at:string;vehicleType?:string;fee?:number;paymentMethod?:string};

export default function ParkingPage({user,onAlertsChanged=()=>{}}:{user:User;onAlertsChanged?:()=>void}){
 const toast=useToast();
 const [mode,setMode]=useState<Mode>('ENTRY'),[vehicleType,setVehicleType]=useState<VehicleType|null>(null);
 const [confirmed,setConfirmed]=useState<Confirmation|null>(null),[precheck,setPrecheck]=useState<Precheck|null>(null);
 const [sessions,setSessions]=useState<ParkingSession[]>([]),[policies,setPolicies]=useState<PricingPolicy[]>([]);
 const [selected,setSelected]=useState<ParkingSession|null>(null),[preview,setPreview]=useState<Preview|null>(null),[matched,setMatched]=useState<'auto'|'none'|null>(null);
 const [payment,setPayment]=useState('CASH'),[paid,setPaid]=useState(false),[selectionReason,setSelectionReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[filter,setFilter]=useState('');
 const [activePage,setActivePage]=useState(1),[activeTotal,setActiveTotal]=useState(0),[parkedTotal,setParkedTotal]=useState<number|null>(null),[appliedFilter,setAppliedFilter]=useState('');
 const [done,setDone]=useState<Done|null>(null),[round,setRound]=useState(0),[sessionSheet,setSessionSheet]=useState(false),[reviewing,setReviewing]=useState<Alert|null>(null);
 const locked=useRef(false),version=useRef(0),keys=useRef(new Map<string,string>()),precheckType=useRef<VehicleType|null>(null);
 const invalidate=useCallback(()=>{version.current++;setConfirmed(null);setVehicleType(null);setPrecheck(null);setPreview(null);setSelected(null);setMatched(null);setPaid(false);setSelectionReason('');setNotice('');precheckType.current=null;},[]);
 const confirm=useCallback((value:Confirmation)=>{invalidate();setVehicleType(vehicleTypeFromPlate(value.plateNumber));setConfirmed(value);},[invalidate]);
 const rec=useRecognition(mode,confirm,invalidate);
 async function loadActive(page=activePage,plate=appliedFilter){
  const query=new URLSearchParams({status:'ACTIVE',page:String(page)});if(plate.trim())query.set('plateNumber',plate.trim());
  const result=await api<Page<ParkingSession>>(`/parking-sessions?${query}`);
  setSessions(result.items);setActivePage(page);setActiveTotal(result.total);setAppliedFilter(plate);if(!plate.trim())setParkedTotal(result.total);
  return result.items;
 }
 useEffect(()=>{
  void loadActive(1,'').catch(e=>setError(errorMessage(e)));
  void api<Page<PricingPolicy>>('/pricing-policies?pageSize=100').then(r=>setPolicies(r.items || [])).catch(()=>{});
 },[]);
 async function run(action:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{await action();}catch(e){setError(errorMessage(e));}finally{locked.current=false;setBusy(false);}
 }
 function requireConfirmation(){
  if(!confirmed)throw new Error('Cần xác nhận biển số trước khi tiếp tục.');
  return confirmed;
 }
 function idempotency(operation:string,body:unknown){
  const signature=JSON.stringify([operation,body]);let key=keys.current.get(signature);
  if(!key){key=crypto.randomUUID();keys.current.set(signature,key);}return key;
 }
 async function checkPreconditions(){
  const event=requireConfirmation(),current=version.current;
  if (!vehicleType) return;
  // Precheck chỉ phụ thuộc biển số; giữ nguyên loại xe đã gửi lần đầu để kiểm tra lại không bị coi là yêu cầu khác.
  const type=precheckType.current || vehicleType;precheckType.current=type;
  const result=await post<Precheck>('/parking-sessions/check-in/precheck',{sourceEventId:event.sourceEventId,plateNumber:event.plateNumber,vehicleType:type});
  if(version.current!==current)return;
  setPrecheck(result);
 }
 async function checkIn(){
  const event=requireConfirmation();
  if(!vehicleType || !precheck?.canCheckIn || precheck.sourceEventId!==event.sourceEventId)return;
  const body={sourceEventId:event.sourceEventId,plateNumber:event.plateNumber,vehicleType};
  const session=await post<ParkingSession>('/parking-sessions/check-in',body,idempotency('check-in',body));
  invalidate();setDone({mode:'ENTRY',plateNumber:event.plateNumber,at:session?.checkInAt || new Date().toISOString(),vehicleType});
  await loadActive(1,'');
 }
 async function chooseSession(session:ParkingSession,reason=''){
  setSelected(session);setPreview(null);setPaid(false);setSelectionReason(reason);
  const current=version.current;
  const value=await post<Preview>(`/parking-sessions/${session.id}/fee-preview`);
  if(version.current===current)setPreview(value);
 }
 async function autoMatch(){
  const event=requireConfirmation(),current=version.current;
  const items=await loadActive(1,event.plateNumber);
  if(version.current!==current)return;
  const exact=items.find(s=>s.plateNumber===event.plateNumber);
  setFilter(event.plateNumber);setMatched(exact?'auto':'none');
  if(exact)await chooseSession(exact);
 }
 async function checkout(){
  const event=requireConfirmation();if(!selected || !preview || !paid)return;
  if(selected.plateNumber!==event.plateNumber && !selectionReason.trim())throw new Error('Cần lý do chọn lượt gửi có biển số khác.');
  const body={sourceEventId:event.sourceEventId,plateNumber:event.plateNumber,paymentMethod:payment,paymentConfirmed:true,expectedFee:preview.fee,...(selectionReason.trim()?{manualSelectionReason:selectionReason.trim()}: {})};
  try{await post(`/parking-sessions/${selected.id}/check-out`,body,idempotency(`check-out:${selected.id}`,body));}
  catch(e){
   if(e instanceof ApiError && e.code==='FEE_CHANGED'){
    setPaid(false);setPreview(null);
    setPreview(await post<Preview>(`/parking-sessions/${selected.id}/fee-preview`));
    setNotice('Phí đã thay đổi. Kiểm tra phí mới và xác nhận lại đã nhận đủ tiền.');return;
   }throw e;
  }
  invalidate();setDone({mode:'EXIT',plateNumber:selected.plateNumber,at:preview.asOf,fee:preview.fee,paymentMethod:payment});
  await loadActive(1,'');
 }
 async function review(alert:Alert,status:string,note:string){
  await post(`/alerts/${alert.id}/review`,{note,status});
  setReviewing(null);toast(`Đã lưu xử lý cảnh báo ${alert.plateNumber}`);onAlertsChanged();
  setPrecheck(null);
  if(confirmed && mode==='ENTRY')await run(checkPreconditions);
 }
 // Tự chạy bước kiểm tra ngay khi biển số được xác nhận.
 useEffect(()=>{
  if(!confirmed || done)return;
  if(mode==='ENTRY' && vehicleType && !precheck)void run(checkPreconditions);
  if(mode==='EXIT' && !matched)void run(autoMatch);
 },[confirmed,vehicleType]);
 function next(){setDone(null);setRound(r=>r+1);rec.reset();if(rec.source)rec.start();}
 useEffect(()=>{if(!done)return;const timer=window.setTimeout(next,5000);return ()=>window.clearTimeout(timer);},[done]);

 const policy=(type:string)=>policies.find(p=>p.active && p.vehicleType===type);
 const pendingAlerts=(precheck?.alerts || []).filter(a=>a.status==='PENDING');
 const step=confirmed?2:1;
 const mismatch=!!selected && !!confirmed && selected.plateNumber!==confirmed.plateNumber;
 const snapshot=selected?.pricingSnapshot;
 const errorBox=error?<Callout tone="danger" icon={CircleAlert} role="alert"><span>{error} Có thể thử lại; cùng một yêu cầu sẽ giữ mã chống trùng.</span></Callout>:null;

 return <div>
  <div className="flex flex-wrap items-center gap-3 mb-5">
   <Seg label="Chế độ" size="lg" value={mode} disabled={busy} onChange={m=>{invalidate();setDone(null);setMode(m);}}
    options={[{value:'ENTRY',label:'Xe vào',icon:LogIn},{value:'EXIT',label:'Xe ra',icon:LogOut}]}/>
   {parkedTotal!==null?<p className="ml-auto t-meta"><b className="text-text font-semibold tnum">{parkedTotal}</b> xe đang gửi</p>:null}
  </div>

  <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
   <CameraCard rec={rec}/>
   <section aria-label={mode==='ENTRY'?'Ghi nhận xe vào':'Ghi nhận xe ra'} className="lg:sticky lg:top-20">
    {done?<div className="card p-6 enter" role="status">
     <span className="grid place-items-center w-10 h-10 rounded-full bg-ok-soft text-ok mb-4"><Check className="ic-lg"/></span>
     <h2 className="h-section">{done.mode==='ENTRY'?'Đã ghi nhận xe vào.':'Đã ghi nhận xe ra và thanh toán.'}</h2>
     <p className="t-meta mb-4">{time(done.at)}{done.vehicleType?` · ${vehicleLabel(done.vehicleType)}`:''}{done.paymentMethod?` · ${done.paymentMethod==='CASH'?'Tiền mặt':'Chuyển khoản'}`:''}</p>
     {done.mode==='ENTRY'?<div className="plate plate-xl mb-5">{done.plateNumber}</div>:
      <div className="rounded-[10px] bg-subtle border border-border p-4 mb-5 flex items-center justify-between gap-2"><Plate>{done.plateNumber}</Plate><span className="text-[13px] t-2">Đã thu <b className="text-text text-[18px] font-semibold tnum ml-1">{money(done.fee || 0)}</b></span></div>}
     <button type="button" className="btn btn-primary btn-xl btn-block" data-kbd="Space" onClick={next}>Xe tiếp theo <kbd>Space</kbd></button>
     <div className="h-1 rounded-full bg-muted mt-4 overflow-hidden"><div className="h-full bg-primary w-full origin-left animate-[progress_5s_linear]"/></div>
     <p className="t-meta text-center mt-2">Tự chuyển sau 5 giây</p>
    </div>:
    <div className="card">
     <div className="card-head"><span className="h-section">{mode==='ENTRY'?'Xe vào':'Xe ra'}</span><span className="t-meta ml-auto tnum">Bước {step}/2</span></div>
     <div className="card-body steps">
      <div className="step" data-state={step===1?'current':'done'}>
       <span className="step-num">{step===1?'1':<Check/>}</span>
       <div>
        <div className="step-head"><span className="step-title">Biển số</span>
         {confirmed?<span className="inline-flex items-center gap-1"><Plate>{confirmed.plateNumber}</Plate><button type="button" className="btn btn-icon btn-sm" aria-label="Sửa biển số" disabled={busy} onClick={invalidate}><Pencil/></button></span>:null}</div>
        <div className="step-body" hidden={!!confirmed}><PlateStep key={round} rec={rec}/></div>
       </div>
      </div>
      <div className="step" data-state={step===2?'current':'todo'}>
       <span className="step-num">2</span>
       <div>
        <div className="step-head"><span className="step-title">{mode==='ENTRY'?'Loại xe & ghi nhận':'Lượt gửi & thu phí'}</span></div>
        <div className="step-body grid gap-4">
         {errorBox}
         {mode==='ENTRY'?<>
          {confirmed && (vehicleType ? <p className="t-meta">Loại xe theo biển số: <b>{vehicleLabel(vehicleType)}</b></p> : <label className="field">Xác nhận loại xe
           <select className="control" value="" disabled={busy} onChange={e=>setVehicleType(e.target.value as VehicleType)}>
            <option value="" disabled>Chọn loại xe</option><option value="CAR">Ô tô</option><option value="MOTORBIKE">Xe máy</option>
           </select></label>)}
          {!precheck?(busy?<div className="skeleton h-[92px]" aria-label="Đang kiểm tra"/>:confirmed && vehicleType?<button type="button" className="btn btn-secondary" onClick={()=>void run(checkPreconditions)}><RotateCw/>Kiểm tra lại</button>:null)
          :pendingAlerts.length?<>
           {pendingAlerts.map(a=><Callout key={a.id} tone="danger" icon={ShieldAlert} role="alert">
            <span><b>Xe trong danh sách cần cảnh báo</b>{a.evidence?.description?<><br/>{a.evidence.description}</>:null}</span>
            <button type="button" className="btn btn-danger-soft btn-sm justify-self-start" onClick={()=>setReviewing(a)}>Xem & xử lý</button>
           </Callout>)}
           <p className="t-meta text-center">Cần xử lý cảnh báo trước khi ghi nhận xe vào.</p>
          </>:<div className="rounded-[10px] border border-border bg-subtle p-3.5 grid gap-2.5 enter">
           <p className="eyebrow">Đã kiểm tra tự động</p>
           <ul className="checks">
            <li><CircleCheck/>Không có cảnh báo chờ xử lý</li>
            {vehicleType && policy(vehicleType)?<li><CircleCheck/>Biểu phí {vehicleLabel(vehicleType).toLowerCase()}: {money(Number(policy(vehicleType)!.hourlyRate))}/giờ</li>:null}
           </ul>
          </div>}
          <button type="button" className="btn btn-primary btn-xl btn-block" data-kbd="Enter" disabled={busy || !confirmed || !precheck?.canCheckIn || precheck.sourceEventId!==confirmed.sourceEventId} onClick={()=>void run(checkIn)}><LogIn/>Ghi nhận xe vào <kbd>Enter</kbd></button>
         </>:<>
          {!matched && busy?<div className="skeleton h-[92px]" aria-label="Đang tìm lượt gửi"/>:null}
          {matched==='none' && !selected?<>
           <Callout tone="warn" icon={SearchX}><span><b>Không có lượt gửi đang mở cho {confirmed?.plateNumber}</b><br/>Có thể lúc vào camera đọc sai một ký tự. Tìm theo biển gần giống.</span></Callout>
           <button type="button" className="btn btn-primary btn-lg btn-block" onClick={()=>setSessionSheet(true)}><Search/>Tìm lượt gửi</button>
          </>:null}
          {!matched && !busy && confirmed?<button type="button" className="btn btn-secondary" onClick={()=>void run(autoMatch)}><RotateCw/>Tìm lượt gửi</button>:null}
          {selected?<>
           <div className="rounded-[10px] border border-border p-3.5 grid gap-2">
            <div className="flex items-center gap-2">{mismatch?<Badge tone="warn">Chọn tay · {selected.plateNumber}</Badge>:<Badge tone="ok">Đã khớp lượt gửi</Badge>}
             <button type="button" className="ml-auto text-[13px] font-medium text-primary hover:underline" onClick={()=>setSessionSheet(true)}>Đổi lượt</button></div>
            <dl className="grid grid-cols-3 gap-2 text-[13px]">
             <div><dt className="text-text-3">Vào lúc</dt><dd className="font-medium tnum">{time(selected.checkInAt)}</dd></div>
             <div><dt className="text-text-3">Thời gian</dt><dd className="font-medium tnum">{preview?duration(preview.durationMinutes):'…'}</dd></div>
             <div><dt className="text-text-3">Loại xe</dt><dd className="font-medium">{vehicleLabel(selected.vehicleType)}</dd></div>
            </dl>
           </div>
           {notice?<Callout tone="warn" icon={TriangleAlert} role="status"><span>{notice}</span></Callout>:null}
           {preview?<>
            <div className="text-center py-1">
             <p className="t-meta">Phí gửi xe</p>
             <p aria-label="Phí gửi xe" className="text-[44px] leading-[1.1] font-semibold tracking-[-.02em] tnum mt-1">{money(preview.fee).replace(' ₫','')} <span className="text-[24px] text-text-3 font-medium">₫</span></p>
             {snapshot?<p className="t-meta mt-1 tnum">{duration(preview.durationMinutes)} → tính {duration(billedMinutes(preview.durationMinutes,snapshot.roundingMinutes))} × {money(Number(snapshot.hourlyRate))}/giờ</p>:null}
            </div>
            <Seg label="Hình thức thanh toán" block value={payment} disabled={busy} onChange={v=>{setPayment(v);setPaid(false);}} options={[{value:'CASH',label:'Tiền mặt',icon:Banknote},{value:'TRANSFER',label:'Chuyển khoản',icon:QrCode}]}/>
            <SwitchRow title="Đã nhận đủ tiền" checked={paid} disabled={busy} onChange={setPaid}/>
           </>:<div className="skeleton h-[120px]"/>}
           <button type="button" className="btn btn-primary btn-xl btn-block" data-kbd="Enter" disabled={busy || !confirmed || !preview || !paid || (mismatch && !selectionReason.trim())} onClick={()=>void run(checkout)}><LogOut/>Ghi nhận xe ra <kbd>Enter</kbd></button>
          </>:null}
         </>}
        </div>
       </div>
      </div>
     </div>
    </div>}
   </section>
  </div>

  <Sheet open={sessionSheet} onClose={()=>setSessionSheet(false)} title="Chọn lượt gửi">
   <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>{await loadActive(1,filter);});}}>
    <div className="control flex-1"><Search/><input className="font-mono uppercase" value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Lọc biển số" placeholder="Biển số"/></div>
    <button className="btn btn-secondary" disabled={busy}>Tìm xe đang gửi</button>
   </form>
   <div>
    <p className="eyebrow mb-2">Đang gửi{appliedFilter?` · khớp “${appliedFilter}”`:''}</p>
    <div className="rounded-[10px] border border-border overflow-hidden">
     {sessions.length?<div className="divide-y divide-[var(--border)]" role="listbox" aria-label="Lượt gửi đang mở">
      {sessions.map(s=><button type="button" key={s.id} role="option" className="row-item" aria-selected={selected?.id===s.id} disabled={busy || !confirmed} aria-label={`Chọn ${s.plateNumber}`}
       onClick={()=>void run(()=>chooseSession(s,selected?.id===s.id?selectionReason:''))}>
       <Plate>{s.plateNumber}</Plate><span className="t-meta flex-1">{vehicleLabel(s.vehicleType)} · vào {time(s.checkInAt)}</span>{selected?.id===s.id?<Check className="text-primary"/>:null}
      </button>)}
     </div>:<p className="t-meta p-4">Không có xe đang gửi khớp.</p>}
     <Pager page={activePage} total={activeTotal} onPage={p=>void run(async()=>{await loadActive(p);})} disabled={busy} unit="xe"/>
    </div>
   </div>
   {mismatch?<div className="field"><label htmlFor="selection-reason">Lý do chọn lượt gửi khác biển số</label><div className="control"><input id="selection-reason" value={selectionReason} disabled={busy} placeholder="Ví dụ: lúc vào đọc sai số cuối" onChange={e=>{setSelectionReason(e.target.value);setPaid(false);}}/></div><span className="hint">Bắt buộc · lưu vào nhật ký</span></div>:null}
   <button type="button" className={cx('btn btn-primary',!selected && 'invisible')} disabled={mismatch && !selectionReason.trim()} onClick={()=>setSessionSheet(false)}>Dùng lượt này</button>
  </Sheet>

  <Sheet open={!!reviewing} onClose={()=>setReviewing(null)} title="Xử lý cảnh báo">
   {reviewing?<AlertReview alert={reviewing} disabled={busy} onSubmit={(status,note)=>review(reviewing,status,note)}/>:null}
  </Sheet>
  <span className="sr-only">Nhân viên: {user.username}</span>
 </div>;
}
