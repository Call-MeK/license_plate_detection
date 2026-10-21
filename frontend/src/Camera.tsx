import { useEffect, useRef, useState } from 'react';
import { api, post, errorMessage, type Confirmation, type Mode, type Recognition } from './api';

export default function Camera({mode,onConfirm,onInvalidate}:{mode:Mode;onConfirm:(value:Confirmation)=>void;onInvalidate:()=>void}) {
 const video=useRef<HTMLVideoElement>(null), stream=useRef<MediaStream|null>(null), fileUrl=useRef('');
 const generation=useRef(0), sessionId=useRef(''), pending=useRef(false);
 const [source,setSource]=useState(''), [recognition,setRecognition]=useState<Recognition|null>(null);
 const [frameSize,setFrameSize]=useState({width:1,height:1});
 const [plate,setPlate]=useState(''), [reason,setReason]=useState(''), [manual,setManual]=useState(''), [manualReason,setManualReason]=useState('');
 const [error,setError]=useState(''), [busy,setBusy]=useState(false), [scanning,setScanning]=useState(false);
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
 async function openCamera(){
  changeSource();setError('');setBusy(true);
  try {
   if(!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt không hỗ trợ camera. Hãy dùng localhost hoặc video cục bộ.');
   stream.current=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
   if(video.current){video.current.srcObject=stream.current; await video.current.play();} setSource('camera');
  }catch(e){setError(e instanceof DOMException && e.name==='NotAllowedError'?'Quyền camera bị từ chối. Cho phép camera trong trình duyệt, chọn video cục bộ hoặc nhập thủ công có lý do.':errorMessage(e));}
  finally{setBusy(false);}
 }
 async function chooseFile(file?:File){
  if(!file)return;changeSource();setError('');
  fileUrl.current=URL.createObjectURL(file);
  if(video.current){video.current.srcObject=null;video.current.src=fileUrl.current;try{await video.current.play();}catch{setError('Nhấn phát video để bắt đầu.');}}
  setSource('file');
 }
 async function collect(existing?:Recognition){
  if(pending.current)return;pending.current=true;setScanning(true);setError('');invalidate();
  const current=++generation.current;
  try {
   let state=existing || await post<Recognition>('/recognition/sessions',{mode});
   if(current!==generation.current){void api(`/recognition/sessions/${state.id}`,{method:'DELETE'}).catch(()=>{});return;}
   sessionId.current=state.id;setRecognition(state);
   let sequence=state.sequence || 0;
   while(current===generation.current){
    const element=video.current;
    if(!element?.videoWidth || element.ended) throw new Error('Video chưa sẵn sàng hoặc đã kết thúc. Chọn nguồn và thử lại.');
    const scale=Math.min(1,1920/element.videoWidth,1080/element.videoHeight);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(element.videoWidth*scale));canvas.height=Math.max(1,Math.floor(element.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Không tạo được khung hình.');
    context.drawImage(element,0,0,canvas.width,canvas.height);
    let blob:Blob|null=null;
    for(const quality of [0.85,0.65,0.45]){
     blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Không mã hóa được JPEG.')),'image/jpeg',quality));
     if(blob.size<=2*1024*1024)break;
    }
    if(!blob || blob.size>2*1024*1024)throw new Error('Khung hình vượt 2 MiB. Chọn video nhỏ hơn hoặc nhập thủ công có lý do.');
    if(current!==generation.current)break;
    const form=new FormData();form.append('frame',blob,'frame.jpg');form.append('sequence',String(++sequence));
    state=await api<Recognition>(`/recognition/sessions/${state.id}/frames`,{method:'POST',body:form});
    if(current!==generation.current)break;
    setFrameSize({width:canvas.width,height:canvas.height});
    setRecognition(state);setPlate(state.plateNumber || '');setReason('');
    if(state.needsTarget || state.state==='READY')break;
    await new Promise(resolve=>window.setTimeout(resolve,500));
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
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Nhận dạng biển số">
  <h2>Nhận dạng {mode==='ENTRY'?'xe vào':'xe ra'}</h2>
  <div className="flex flex-wrap gap-3"><button type="button" onClick={openCamera} disabled={busy || scanning}>Mở camera</button><label>Video cục bộ<input type="file" accept="video/*" disabled={busy || scanning} onChange={e=>void chooseFile(e.target.files?.[0])}/></label></div>
  <div className="relative bg-slate-950 rounded overflow-hidden"><video ref={video} muted playsInline controls={source==='file'} className="block w-full" aria-label="Hình ảnh camera"/>
   {recognition?.candidates.map((candidate,index)=>{const {width,height}=frameSize;return <button type="button" key={index} aria-label={`Chọn mục tiêu ${candidate.plateNumber || index+1}`} disabled={busy || scanning} onClick={()=>void selectTarget(candidate.bbox)} style={{position:'absolute',left:`${candidate.bbox[0]/width*100}%`,top:`${candidate.bbox[1]/height*100}%`,width:`${(candidate.bbox[2]-candidate.bbox[0])/width*100}%`,height:`${(candidate.bbox[3]-candidate.bbox[1])/height*100}%`,border:'3px solid #fbbf24',background:'rgba(0,0,0,.25)',padding:0,minHeight:24}}>{candidate.plateNumber || `Mục tiêu ${index+1}`}</button>;})}
  </div>
  <button type="button" disabled={!source || busy || scanning} onClick={()=>{stopRecognition();void collect();}}>{scanning?'Đang nhận dạng…':'Bắt đầu nhận dạng'}</button>
  {scanning?<button type="button" onClick={()=>{generation.current++;}}>Dừng nhận dạng</button>:null}
  {recognition?<><p>Trạng thái: {recognition.status} · {recognition.state}</p>{recognition.stub?<p className="notice">Dữ liệu AI giả lập — chưa phải nhận dạng thật.</p>:null}{recognition.needsTarget?<p className="notice">Có nhiều mục tiêu. Chọn khung biển số trên video.</p>:null}
   <label>Biển số nhận dạng<input value={plate} disabled={busy || scanning} onChange={e=>{setPlate(e.target.value);invalidate();}}/></label>
   {plate!==recognition.plateNumber?<label>Lý do sửa biển số<input value={reason} onChange={e=>setReason(e.target.value)}/></label>:null}
   <button type="button" disabled={busy || scanning || recognition.needsTarget || !plate.trim() || (plate!==recognition.plateNumber && !reason.trim())} onClick={()=>void confirm(false)}>Xác nhận biển số</button></>:null}
  <details open><summary>Nhập thủ công có audit</summary><div className="grid gap-3 mt-3"><label>Biển số thủ công<input value={manual} disabled={busy || scanning} onChange={e=>{setManual(e.target.value);invalidate();}}/></label><label>Lý do nhập thủ công<input value={manualReason} onChange={e=>setManualReason(e.target.value)} disabled={busy || scanning}/></label><button type="button" disabled={busy || scanning || !manual.trim() || !manualReason.trim()} onClick={()=>void confirm(true)}>Xác nhận thủ công</button></div></details>
  {error?<p className="error" role="alert">{error}</p>:null}
 </section>;
}
