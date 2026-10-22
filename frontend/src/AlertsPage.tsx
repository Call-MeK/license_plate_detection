import { useEffect, useState } from 'react';
import { ImageOff, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, post, errorMessage, type Alert, type Page } from './api';
import { when } from './format';
import { Badge, Empty, ErrorText, PageHead, Pager, Plate, Seg, cx, useToast } from './ui';

type ReviewStatus='REVIEWED'|'FALSE_POSITIVE';
export const reviewLabel=(status:string)=>status==='FALSE_POSITIVE'?'Cảnh báo nhầm':status==='REVIEWED'?'Đã xem xét':'Chờ xử lý';

/** Thông tin cảnh báo + form xử lý; dùng ở trang Cảnh báo và trong luồng xe vào. */
export function AlertReview({alert,onSubmit,disabled}:{alert:Alert;onSubmit:(status:ReviewStatus,note:string)=>Promise<void>;disabled?:boolean}){
 const [status,setStatus]=useState<ReviewStatus|''>(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setStatus('');setNote('');setError('');},[alert.id]);
 async function submit(){
  if(!status || !note.trim())return;
  setBusy(true);setError('');
  try{await onSubmit(status,note.trim());}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 [.sheet_&]:md:grid-cols-1">
  <div className="grid gap-4 content-start">
   {alert.evidence?.imagePath?<img src={`/api/v1/alerts/${encodeURIComponent(alert.id)}/evidence`} alt={`Ảnh biển số ${alert.plateNumber}`} className="w-full rounded-[14px] border border-border bg-muted"/>
    :<div className="grid place-items-center gap-1 h-28 rounded-[14px] bg-subtle border border-dashed border-border-strong t-meta"><ImageOff/>Không có ảnh bằng chứng</div>}
   <dl className="grid grid-cols-[100px_1fr] gap-y-2.5 text-[14px]">
    <dt className="text-text-3">Biển số</dt><dd><Plate>{alert.plateNumber}</Plate></dd>
    {alert.evidence?.description?<><dt className="text-text-3">Lý do</dt><dd>{alert.evidence.description}</dd></>:null}
    {alert.createdAt?<><dt className="text-text-3">Phát hiện</dt><dd className="tnum">{when(alert.createdAt)}{alert.evidence?.mode?` · ${alert.evidence.mode==='EXIT'?'Xe ra':'Xe vào'}`:''}{alert.evidence?.manual?' · nhập tay':''}</dd></>:null}
   </dl>
  </div>
  <form className="grid gap-4 content-start" onSubmit={e=>{e.preventDefault();void submit();}}>
   <ErrorText error={error}/>
   <fieldset className="grid gap-2" disabled={disabled || busy}><legend className="t-label mb-2">Kết quả kiểm tra</legend>
    <label className="radio-card"><input type="radio" name={`review-${alert.id}`} checked={status==='REVIEWED'} onChange={()=>setStatus('REVIEWED')}/><span><b className="font-medium block text-[14px]">Đã xem xét</b><span className="t-meta">Đã kiểm tra giấy tờ / báo bảo vệ</span></span></label>
    <label className="radio-card"><input type="radio" name={`review-${alert.id}`} checked={status==='FALSE_POSITIVE'} onChange={()=>setStatus('FALSE_POSITIVE')}/><span><b className="font-medium block text-[14px]">Cảnh báo nhầm</b><span className="t-meta">Biển trùng nhưng không phải xe này</span></span></label>
   </fieldset>
   <div className="field"><label htmlFor={`note-${alert.id}`}>Ghi chú xử lý</label><div className="control textarea"><textarea id={`note-${alert.id}`} value={note} disabled={disabled || busy} placeholder="Mô tả ngắn việc đã làm" onChange={e=>setNote(e.target.value)}/></div><span className="hint">Bắt buộc · lưu vào nhật ký</span></div>
   <button className="btn btn-primary" disabled={disabled || busy || !status || !note.trim()}>Lưu xử lý {alert.plateNumber}</button>
  </form>
 </div>;
}

export default function AlertsPage({onAlertsChanged}:{onAlertsChanged:()=>void}){
 const toast=useToast();
 const [tab,setTab]=useState<'PENDING'|ReviewStatus>('PENDING'),[pendingTotal,setPendingTotal]=useState(0);
 const [rows,setRows]=useState<Alert[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[selectedId,setSelectedId]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(nextPage=page,status=tab){
  setLoading(true);setError('');
  try{
   const result=await api<Page<Alert>>(`/alerts?status=${status}&page=${nextPage}`);
   setRows(result.items);setTotal(result.total);setPage(nextPage);if(status==='PENDING')setPendingTotal(result.total);
  }catch(e){setError(errorMessage(e));}finally{setLoading(false);}
 }
 useEffect(()=>{void load(1,tab);},[tab]);
 useEffect(()=>{void api<Page<Alert>>('/alerts?status=PENDING&pageSize=1').then(r=>setPendingTotal(r.total)).catch(()=>{});},[]);
 const selected=rows.find(a=>a.id===selectedId) || rows[0];
 async function review(alert:Alert,status:ReviewStatus,note:string){
  await post(`/alerts/${alert.id}/review`,{note,status});
  toast(`Đã lưu xử lý ${alert.plateNumber}`);onAlertsChanged();
  await load(page>1 && rows.length===1?page-1:page);
 }
 return <>
  <PageHead title="Cảnh báo" description="Xe khớp danh sách cần cảnh báo khi đi qua cổng.">
   <Seg label="Lọc trạng thái" value={tab==='PENDING'?'PENDING':'DONE'} onChange={v=>setTab(v==='PENDING'?'PENDING':'REVIEWED')}
    options={[{value:'PENDING',label:<>Chờ xử lý{pendingTotal?<span className="count">{pendingTotal}</span>:null}</>},{value:'DONE',label:'Đã xử lý'}]}/>
  </PageHead>
  <ErrorText error={error}/>
  {tab==='PENDING'?(!loading && !rows.length?<div className="card"><Empty icon={ShieldCheck} title="Không có cảnh báo cần xử lý"><p className="t-meta max-w-sm">Khi xe trong danh sách cảnh báo đi qua cổng, cảnh báo sẽ hiện ở đây và ngay trên màn Vận hành.</p></Empty></div>:
   <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-5 items-start">
    <div className="card overflow-hidden">
     <div className="divide-y divide-[var(--border)]" role="listbox" aria-label="Cảnh báo chờ xử lý">
      {rows.map(a=><button type="button" key={a.id} role="option" className="row-item !py-3.5" aria-selected={a.id===selected?.id} onClick={()=>setSelectedId(a.id)}>
       <span className="grid place-items-center w-9 h-9 rounded-full bg-danger-soft text-danger shrink-0"><ShieldAlert/></span>
       <span className="flex-1 min-w-0"><Plate>{a.plateNumber}</Plate><span className="block t-meta truncate mt-1">{a.evidence?.description || 'Trong danh sách cảnh báo'}</span></span>
       {a.createdAt?<span className="t-meta tnum self-start">{when(a.createdAt)}</span>:null}
      </button>)}
     </div>
     <Pager page={page} total={total} onPage={p=>void load(p)} disabled={loading} unit="cảnh báo"/>
    </div>
    {selected?<section className="card" aria-label="Chi tiết cảnh báo">
     <div className="card-head"><h2 className="h-section">Chi tiết</h2><span className="ml-auto"><Badge tone="danger">Chờ xử lý</Badge></span></div>
     <div className="card-body"><AlertReview alert={selected} onSubmit={(status,note)=>review(selected,status,note)}/></div>
    </section>:null}
   </div>)
  :<div className="grid gap-3">
   <div className="flex gap-2">{(['REVIEWED','FALSE_POSITIVE'] as const).map(s=><button type="button" key={s} className="chip" aria-pressed={tab===s} onClick={()=>setTab(s)}>{reviewLabel(s)}</button>)}</div>
   <div className="card overflow-x-auto">
    {!loading && !rows.length?<Empty icon={ShieldCheck} title="Chưa có cảnh báo nào ở mục này"/>:<table className="table">
     <thead><tr><th>Biển số</th><th>Lý do</th><th>Kết quả</th><th className="hidden md:table-cell">Ghi chú</th><th className="num">Xử lý lúc</th></tr></thead>
     <tbody>{rows.map(a=><tr key={a.id}><td><Plate>{a.plateNumber}</Plate></td><td className="max-w-[220px] truncate">{a.evidence?.description || '—'}</td>
      <td><Badge tone={a.status==='REVIEWED'?'ok':undefined}>{reviewLabel(a.status)}</Badge></td>
      <td className={cx('hidden md:table-cell max-w-[280px] truncate t-2')} title={a.note || ''}>{a.note || '—'}</td>
      <td className="num t-meta">{a.reviewedAt?when(a.reviewedAt):'—'}</td></tr>)}</tbody>
    </table>}
    <Pager page={page} total={total} onPage={p=>void load(p)} disabled={loading} unit="cảnh báo"/>
   </div>
  </div>}
 </>;
}
