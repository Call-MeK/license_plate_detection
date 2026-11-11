import { useEffect, useRef, useState } from 'react';
import { CircleAlert, FileVideo, Info, Keyboard, LoaderCircle, Pencil, Play, Square, SwitchCamera, TriangleAlert, Video, VideoOff } from 'lucide-react';
import { api, post, errorMessage, ApiError, type Confirmation, type Mode, type Recognition, type VehicleType } from './api';
import { hintLabel, plateLines } from './format';
import { Badge, Callout, cx } from './ui';

const MAX_FRAME_EDGE=1280;
// Phiên server chỉ sống 15 s; còn thấy biển thì mở phiên mới tối đa ngần này lần (~1 phút).
const MAX_RENEWALS=3;
const NO_PLATE_MESSAGE='Hết thời gian đọc mà chưa thấy biển số rõ. Bấm Đọc lại hoặc Nhập tay.';
const EXPIRED_NOTICE='Phiên đọc đã hết hạn — đang đọc lại biển số.';
const EXPIRED_CORRECTION='Phiên đọc đã hết hạn. Dùng Nhập tay với biển đã sửa, hoặc bấm Đọc lại.';
// Server xóa phiên hết hạn ở lần gọi kế tiếp (và mất hết khi khởi động lại), nên 404 SESSION_NOT_FOUND cũng là hết hạn.
const isExpired=(e:unknown)=>e instanceof ApiError && (e.code==='SESSION_EXPIRED' || e.code==='SESSION_NOT_FOUND');

/** Nén JPEG đồng bộ (~vài chục ms). Chrome xếp toBlob/convertToBlob vào lúc rảnh của main thread và
 * chỉ ép chạy sau ~1 s; khi video đang phát và React đang vẽ lại thì không có lúc rảnh, mỗi khung trễ 1–3 s. */
function encodeJpeg(canvas:HTMLCanvasElement):Blob{
 const url=canvas.toDataURL('image/jpeg',0.85),comma=url.indexOf(',');
 if(!url.startsWith('data:image/jpeg') || comma<0)throw new Error('Không mã hóa được JPEG.');
 const binary=atob(url.slice(comma+1)),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:'image/jpeg'});
}

/** Toàn bộ trạng thái nhận dạng; CameraCard (khung video) và PlateStep (bước 1 ở bảng thao tác) cùng dùng. */
export function useRecognition(mode:Mode,onConfirm:(value:Confirmation)=>void,onInvalidate:()=>void){
 const video=useRef<HTMLVideoElement>(null), stream=useRef<MediaStream|null>(null), fileUrl=useRef('');
 const generation=useRef(0), sessionId=useRef(''), pending=useRef(false);
 const [source,setSource]=useState(''), [recognition,setRecognition]=useState<Recognition|null>(null);
 const [facing,setFacing]=useState<'environment'|'user'>('environment');
 const [plate,setPlate]=useState(''), [reason,setReason]=useState(''), [manual,setManual]=useState(''), [manualReason,setManualReason]=useState('');
 const [error,setError]=useState(''), [busy,setBusy]=useState(false), [scanning,setScanning]=useState(false), [aspect,setAspect]=useState('16 / 10'), [expired,setExpired]=useState(false);
 const [frameSize,setFrameSize]=useState<{width:number;height:number}|null>(null);
 function invalidate() { onInvalidate(); }
 function stopRecognition() {
  generation.current++; setScanning(false);
  const id=sessionId.current; sessionId.current='';
  if(id) void api(`/recognition/sessions/${id}`,{method:'DELETE'}).catch(()=>{});
 }
 function stopMedia() {
  stream.current?.getTracks().forEach(track=>track.stop()); stream.current=null;
  if(fileUrl.current) URL.revokeObjectURL(fileUrl.current); fileUrl.current='';
 }
 useEffect(()=>{
  setRecognition(null); setPlate(''); setReason(''); stopRecognition();
  return ()=>{stopRecognition();};
 },[mode]);
 useEffect(()=>()=>{stopMedia();},[]);
 function changeSource() {stopRecognition();stopMedia();setRecognition(null);setPlate('');setReason('');invalidate();}
 async function openCamera(nextFacing=facing,exact=false){
  if(busy || scanning)return;
  changeSource();setSource('');setError('');setBusy(true);
  try {
   if(!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt không hỗ trợ camera. Hãy dùng localhost hoặc video cục bộ.');
   stream.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:exact?{exact:nextFacing}:{ideal:nextFacing}},audio:false});
   if(!video.current){stopMedia();return;}
   const actual=stream.current.getVideoTracks?.()[0]?.getSettings?.().facingMode;
   setFacing(actual==='user' || actual==='environment'?actual:nextFacing);
   if(video.current){video.current.srcObject=stream.current; await video.current.play();} setSource('camera');
   void collect();
  }catch(e){stopMedia();if(video.current)video.current.srcObject=null;setError(e instanceof DOMException && e.name==='NotAllowedError'?'Quyền camera bị từ chối. Cho phép camera trong trình duyệt, chọn video cục bộ hoặc nhập tay có lý do.':e instanceof DOMException && ['OverconstrainedError','NotFoundError'].includes(e.name)?'Không tìm thấy camera đã chọn. Bấm Mở camera để thử lại camera hiện có.':errorMessage(e));}
  finally{setBusy(false);}
 }
 async function chooseFile(file?:File){
  if(!file)return;changeSource();setError('');
  fileUrl.current=URL.createObjectURL(file);
  if(video.current){video.current.srcObject=null;video.current.src=fileUrl.current;try{await video.current.play();}catch{setError('Nhấn phát video để bắt đầu.');}}
  setSource('file');
 }
 async function collect(existing?:Recognition,notice=''){
  if(pending.current)return;pending.current=true;setScanning(true);setError(notice);setExpired(false);invalidate();
  const current=++generation.current;
  try {
   let state=existing || await post<Recognition>('/recognition/sessions',{mode});
   if(current!==generation.current){void api(`/recognition/sessions/${state.id}`,{method:'DELETE'}).catch(()=>{});return;}
   sessionId.current=state.id;setRecognition(state);if(!existing){setPlate(state.plateNumber || '');setReason('');}
   let sequence=state.sequence || 0,renewals=0;
   while(current===generation.current){
    const element=video.current;
    if(!element?.videoWidth || element.ended) throw new Error('Video chưa sẵn sàng hoặc đã kết thúc. Chọn nguồn và thử lại.');
    const scale=Math.min(1,MAX_FRAME_EDGE/Math.max(element.videoWidth,element.videoHeight)),cw=Math.round(element.videoWidth*scale),ch=Math.round(element.videoHeight*scale);
    const canvas=document.createElement('canvas');canvas.width=cw;canvas.height=ch;
    const context=canvas.getContext('2d');if(!context)throw new Error('Không tạo được khung hình.');
    context.drawImage(element,0,0,cw,ch);
    const blob=encodeJpeg(canvas);
    const form=new FormData();form.append('frame',blob,'frame.jpg');form.append('sequence',String(++sequence));
    try{state=await api<Recognition>(`/recognition/sessions/${state.id}/frames`,{method:'POST',body:form});}
    catch(e){
     if(!isExpired(e) || current!==generation.current)throw e;
     if((!state.plateNumber && !state.candidates.length) || renewals>=MAX_RENEWALS){setExpired(true);throw new Error(NO_PLATE_MESSAGE);}
     renewals++;state=await post<Recognition>('/recognition/sessions',{mode});
     if(current!==generation.current){void api(`/recognition/sessions/${state.id}`,{method:'DELETE'}).catch(()=>{});break;}
     sessionId.current=state.id;sequence=0;continue;
    }
    if(current!==generation.current)break;
    setRecognition(state);setFrameSize({width:cw,height:ch});setPlate(state.plateNumber || '');setReason('');
    if(state.needsTarget || state.state==='READY')break;
   }
  }catch(e){if(current===generation.current)setError(errorMessage(e));}
  finally{pending.current=false;setScanning(false);}
 }
 async function selectTarget(bbox:[number,number,number,number]){
  if(!recognition || busy || pending.current)return;
  setBusy(true);invalidate();setReason('');
  try{const result=await post<Recognition>(`/recognition/sessions/${recognition.id}/target`,{bbox});setRecognition(result);setPlate(result.plateNumber || '');setBusy(false);await collect(result);}
  catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 async function confirm(isManual:boolean){
  if(pending.current || busy)return;setBusy(true);setError('');
  try {
   const result=isManual?await post<Confirmation>('/recognition/manual',{plateNumber:manual.trim(),mode,reason:manualReason.trim()}):await post<Confirmation>(`/recognition/sessions/${recognition!.id}/confirm`,{plateNumber:plate.trim(),...(plate!==recognition?.plateNumber?{reason:reason.trim()}: {})});
   onConfirm(result);
  }catch(e){
   if(!isManual && isExpired(e)){
    // Đã sửa biển thì giữ nguyên bản sửa, không tự đọc lại đè mất.
    if(plate!==(recognition?.plateNumber || '')){setExpired(true);setError(EXPIRED_CORRECTION);return;}
    setBusy(false);await collect(undefined,EXPIRED_NOTICE);return;
   }
   setError(errorMessage(e));
  }finally{setBusy(false);}
 }
 const editPlate=(value:string)=>{setPlate(value);invalidate();};
 const editManual=(value:string)=>{setManual(value);invalidate();};
 const stop=()=>{generation.current++;};
 const start=()=>{stopRecognition();void collect();};
 const reset=()=>{stopRecognition();setRecognition(null);setExpired(false);setPlate('');setReason('');setManual('');setManualReason('');setError('');};
 const onMetadata=()=>{const v=video.current;if(v?.videoWidth)setAspect(`${v.videoWidth} / ${v.videoHeight}`);};
 const switchCamera=()=>openCamera(facing==='environment'?'user':'environment',true);
 return {mode,video,source,recognition,plate,reason,manual,manualReason,error,busy,scanning,expired,aspect,frameSize,facing,switchCamera,
  openCamera,chooseFile,start,stop,reset,selectTarget,confirm,editPlate,setReason,editManual,setManualReason,onMetadata};
}
export type RecognitionState=ReturnType<typeof useRecognition>;

export function CameraCard({rec}:{rec:RecognitionState}){
 const {video,source,recognition,busy,scanning,frameSize}=rec;
 const width=frameSize?.width || video.current?.videoWidth || 1,height=frameSize?.height || video.current?.videoHeight || 1;
 return <section className="card overflow-hidden" aria-label="Camera nhận dạng">
  <div className="card-head !py-2.5">
   <span className="h-section">Camera</span>
   {source?<Badge>{source==='camera'?<><span className="live-dot"/>Trực tiếp</>:'Video tệp'}</Badge>:null}
   <div className="ml-auto flex items-center gap-1">
    <button type="button" className="btn btn-secondary btn-sm" aria-label="Mở camera" onClick={()=>void rec.openCamera()} disabled={busy || scanning}><Video/><span className="hidden sm:inline">Mở camera</span></button>
    <label className={cx('btn btn-icon btn-sm',(busy || scanning) && 'opacity-45 pointer-events-none')} title="Dùng video tệp"><FileVideo/><input type="file" accept="video/*" className="sr-only" aria-label="Video cục bộ" disabled={busy || scanning} onChange={e=>void rec.chooseFile(e.target.files?.[0])}/></label>
   </div>
  </div>
  <div className="p-3">
   <div className="cam" style={{aspectRatio:rec.aspect}}>
    <video ref={video} muted playsInline controls={source==='file'} onLoadedMetadata={rec.onMetadata} aria-label="Hình ảnh camera" className={source?'':'invisible'}/>
    {!source?<div className="absolute inset-0 grid place-items-center text-center p-6"><div className="grid justify-items-center gap-2">
     <span className="grid place-items-center w-11 h-11 rounded-full bg-white/10 text-white/80"><VideoOff className="ic-lg"/></span>
     <p className="text-white font-medium">Chưa có nguồn video</p>
     <p className="text-white/60 text-[13px] max-w-xs">Mở camera hoặc chọn video tệp. Không có camera vẫn có thể nhập biển số tay ở bảng bên cạnh.</p>
    </div></div>:null}
    {recognition?.candidates.map((candidate,index)=><button type="button" key={index} className="cam-box target" aria-label={`Chọn mục tiêu ${candidate.plateNumber || index+1}`} disabled={busy || scanning} onClick={()=>void rec.selectTarget(candidate.bbox)}
     style={{left:`${candidate.bbox[0]/width*100}%`,top:`${candidate.bbox[1]/height*100}%`,width:`${(candidate.bbox[2]-candidate.bbox[0])/width*100}%`,height:`${(candidate.bbox[3]-candidate.bbox[1])/height*100}%`,minHeight:24}}>
     {candidate.plateNumber?<span className="cam-label">{candidate.plateNumber} <span className="text-ok">Điểm {Math.round(candidate.confidence*100)}%</span></span>:null}
    </button>)}
    {scanning?<><div className="cam-scan"/><span className="cam-chip bottom-3 left-1/2 -translate-x-1/2"><LoaderCircle className="animate-spin"/>Đang đọc biển số…</span></>:null}
   </div>
  </div>
  {source==='camera'?<div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
   <span className="t-meta" role="status">{rec.facing==='environment'?'Camera sau':'Camera trước'}</span>
   <button type="button" className="btn btn-secondary min-h-11" disabled={busy || scanning} onClick={()=>void rec.switchCamera()}><SwitchCamera/>Đổi camera</button>
   {scanning?<p className="t-meta w-full">Dừng nhận dạng để đổi camera.</p>:null}
  </div>:null}
  {recognition?.needsTarget?<p className="t-meta flex items-center gap-2 px-4 pb-3 -mt-0.5"><Info/>Có nhiều biển số trong khung — bấm vào đúng khung trên video.</p>:null}
 </section>;
}

/** Biển số chia 2 dòng như trên biển thật cho dễ đối chiếu. */
function TwoLinePlate({plate,type,className}:{plate:string;type?:VehicleType|null;className?:string}){
 return <div className={cx('plate plate-xl plate-2',className)} role="img" aria-label={`Biển số ${plate}`}>
  {plateLines(plate,type).map((line,index)=><span key={index} className="plate-line">{line}</span>)}
 </div>;
}

/** Bước 1: đọc / sửa / nhập tay biển số rồi xác nhận. */
export function PlateStep({rec}:{rec:RecognitionState}){
 const {mode,source,recognition,plate,reason,manual,manualReason,error,busy,scanning,expired}=rec;
 const [editing,setEditing]=useState(false),[manualOpen,setManualOpen]=useState(false);
 useEffect(()=>{if(!recognition)setEditing(false);},[recognition]);
 const corrected=!!recognition && plate!==(recognition.plateNumber || '');
 const confidence=recognition?.candidates.find(c=>c.plateNumber===recognition.plateNumber)?.confidence;
 const canConfirm=!busy && !scanning && !!recognition && !recognition.needsTarget && !!plate.trim() && (!corrected || !!reason.trim());
 const manualForm=<form className="grid gap-4 enter" onSubmit={e=>{e.preventDefault();void rec.confirm(true);}}>
  <div className="field"><label htmlFor="manual-plate">Biển số thủ công</label><div className="control lg plate-input"><input id="manual-plate" value={manual} disabled={busy || scanning} placeholder="51F12345" onChange={e=>rec.editManual(e.target.value)}/></div></div>
  <div className="field"><label htmlFor="manual-reason">Lý do nhập thủ công</label><div className="control"><input id="manual-reason" value={manualReason} disabled={busy || scanning} placeholder="Ví dụ: camera không đọc được" onChange={e=>rec.setManualReason(e.target.value)}/></div>
   <div className="flex flex-wrap gap-1.5">{['Camera không hoạt động','Biển số mờ / bẩn'].map(text=><button type="button" key={text} className="chip !h-7" aria-pressed={manualReason===text} onClick={()=>rec.setManualReason(text)}>{text}</button>)}</div>
   <span className="hint">Bắt buộc · lưu vào nhật ký</span></div>
  <div className="flex gap-2">{recognition || source?<button type="button" className="btn btn-secondary" onClick={()=>setManualOpen(false)}>Hủy</button>:null}
   <button className="btn btn-primary flex-1" disabled={busy || scanning || !manual.trim() || !manualReason.trim()}>Xác nhận thủ công</button></div>
 </form>;
 const manualButton=<button type="button" className="btn btn-ghost btn-sm justify-self-start -ml-2.5" data-kbd="F2" onClick={()=>setManualOpen(true)}><Keyboard/>Nhập tay <kbd>F2</kbd></button>;
 const errorBox=error?<Callout tone="danger" icon={CircleAlert} role="alert"><span>{error}</span></Callout>:null;
 if(manualOpen || (!source && !recognition))return <div className="grid gap-3">{errorBox}
  {!manualOpen?<><p className="t-meta">Mở camera để đọc biển số tự động, hoặc nhập tay.</p>
   <button type="button" className="btn btn-primary btn-lg btn-block" onClick={()=>void rec.openCamera()} disabled={busy}><Video/>Mở camera</button></>:null}
  {manualOpen?manualForm:<button type="button" className="btn btn-secondary btn-block" data-kbd="F2" onClick={()=>setManualOpen(true)}><Keyboard/>Nhập tay <kbd>F2</kbd></button>}
 </div>;
 if(scanning)return <div className="grid gap-3">
  {plate?<TwoLinePlate plate={plate} type={recognition?.vehicleHint?.type} className="opacity-60"/>:<div className="skeleton h-[64px]"/>}
  <p className="t-meta">Đang đọc — giữ xe trong khung hình.</p>
  <button type="button" className="btn btn-secondary btn-block" onClick={rec.stop}><Square/>Dừng nhận dạng</button>
 </div>;
 if(!recognition)return <div className="grid gap-3">{errorBox}
  <div className="skeleton h-[64px] !animate-none"/>
  <p className="t-meta">Đưa xe vào khung hình rồi bấm bắt đầu.</p>
  <button type="button" className="btn btn-primary btn-xl btn-block" data-kbd="Enter" disabled={busy} onClick={rec.start}><Play/>Bắt đầu nhận dạng <kbd>Enter</kbd></button>
  {manualButton}
 </div>;
 return <div className="grid gap-3 enter">{errorBox}
  {recognition.stub?<Callout tone="warn" icon={TriangleAlert}><span>Dữ liệu AI giả lập — chưa phải nhận dạng thật.</span></Callout>:null}
  {recognition.needsTarget?<Callout tone="warn" icon={Info}><span>Có nhiều biển số. Bấm vào đúng khung trên video.</span></Callout>:null}
  {editing || corrected?<div className="grid gap-4">
   <div className="field"><label htmlFor="plate-edit">Biển số nhận dạng</label><div className="control lg plate-input"><input id="plate-edit" value={plate} disabled={busy} onChange={e=>rec.editPlate(e.target.value)}/></div><span className="hint">Camera đọc: <span className="mono">{recognition.plateNumber || '—'}</span></span></div>
   {corrected?<div className="field"><label htmlFor="plate-reason">Lý do sửa biển số</label><div className="control"><input id="plate-reason" value={reason} placeholder="Ví dụ: camera đọc sai số cuối" onChange={e=>rec.setReason(e.target.value)}/></div><span className="hint">Bắt buộc · lưu vào nhật ký</span></div>:null}
  </div>:<>
   {plate?<TwoLinePlate plate={plate} type={recognition.vehicleHint?.type}/>:<div className="plate plate-xl">—</div>}
   <div className="flex items-center justify-between gap-2">
    {recognition.status==='STABLE'?<Badge tone="ok">Ổn định{confidence!==undefined?` · Điểm AI: ${Math.round(confidence*100)}%`:''}</Badge>:<Badge tone="warn">Chưa chắc chắn</Badge>}
    {mode==='ENTRY' && recognition.plateNumber?<Badge>{hintLabel(recognition.vehicleHint)}</Badge>:null}
   </div>
   {confidence!==undefined?<p className="t-meta">Điểm AI không phải tỷ lệ đọc đúng. Hãy kiểm tra biển trước khi xác nhận.</p>:null}
  </>}
  <button type="button" className="btn btn-primary btn-xl btn-block mt-1" data-kbd="Enter" disabled={!canConfirm} onClick={()=>void rec.confirm(false)}>Xác nhận biển số <kbd>Enter</kbd></button>
  <div className="grid grid-cols-2 gap-2">
   {editing || corrected || expired?<button type="button" className="btn btn-secondary" disabled={busy} onClick={rec.start}><Play/>Đọc lại</button>:<button type="button" className="btn btn-secondary" onClick={()=>setEditing(true)}><Pencil/>Sửa</button>}
   <button type="button" className="btn btn-ghost" data-kbd="F2" onClick={()=>setManualOpen(true)}><Keyboard/>Nhập tay <kbd>F2</kbd></button>
  </div>
 </div>;
}
