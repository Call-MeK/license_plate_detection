import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CameraCard, PlateStep, useRecognition } from './Camera';

function Camera() {
 const rec=useRecognition('ENTRY',()=>{},()=>{});
 return <><CameraCard rec={rec}/><PlateStep rec={rec}/></>;
}

it('opens the rear camera and switches both ways, releasing the previous camera',async()=>{
 const stopRear=vi.fn(),stopFront=vi.fn();
 const rear={getTracks:()=>[{stop:stopRear}],getVideoTracks:()=>[{getSettings:()=>({facingMode:'environment'})}]};
 const front={getTracks:()=>[{stop:stopFront}],getVideoTracks:()=>[{getSettings:()=>({facingMode:'user'})}]};
 const getUserMedia=vi.fn().mockResolvedValueOnce(rear).mockImplementationOnce(async()=>{
  expect(stopRear).toHaveBeenCalledOnce();return front;
 }).mockImplementationOnce(async()=>{expect(stopFront).toHaveBeenCalledOnce();return rear;});
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 const {unmount}=render(<Camera/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
 await screen.findByText('Camera sau');
 expect(getUserMedia).toHaveBeenNthCalledWith(1,{video:{facingMode:{ideal:'environment'}},audio:false});
 fireEvent.click(screen.getByRole('button',{name:'Đổi camera'}));
 await screen.findByText('Camera trước');
 expect(getUserMedia).toHaveBeenNthCalledWith(2,{video:{facingMode:{exact:'user'}},audio:false});
 fireEvent.click(screen.getByRole('button',{name:'Đổi camera'}));
 await screen.findByText('Camera sau');
 expect(getUserMedia).toHaveBeenNthCalledWith(3,{video:{facingMode:{exact:'environment'}},audio:false});
 unmount();expect(stopRear).toHaveBeenCalledTimes(2);
});

it('clears a stopped source and explains when the other camera is unavailable',async()=>{
 const stop=vi.fn();
 const getUserMedia=vi.fn().mockResolvedValueOnce({getTracks:()=>[{stop}],getVideoTracks:()=>[{getSettings:()=>({facingMode:'environment'})}]}).mockRejectedValueOnce(new DOMException('missing','OverconstrainedError'));
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 render(<Camera/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
 await screen.findByText('Camera sau');
 fireEvent.click(screen.getByRole('button',{name:'Đổi camera'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Không tìm thấy camera'));
 expect(stop).toHaveBeenCalledOnce();
 expect(screen.queryByRole('button',{name:'Bắt đầu nhận dạng Enter'})).toBeNull();
});

const observation={id:'r',mode:'ENTRY',sequence:0,state:'COLLECTING',status:'UNCERTAIN',plateNumber:null,candidates:[] as unknown[],needsTarget:false,stub:false};
function mediaOf(width:number,height:number) {
 const sizes:[number,number][]=[];
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop:vi.fn()}]})}});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 vi.spyOn(HTMLVideoElement.prototype,'videoWidth','get').mockReturnValue(width);vi.spyOn(HTMLVideoElement.prototype,'videoHeight','get').mockReturnValue(height);
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(this:HTMLCanvasElement){sizes.push([this.width,this.height]);return {drawImage:vi.fn()} as unknown as CanvasRenderingContext2D;} as never);
 vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,'+btoa('jpeg-bytes'));
 return sizes;
}

it('encodes frames synchronously instead of waiting on toBlob idle scheduling',async()=>{
 mediaOf(640,480);
 const toBlob=vi.spyOn(HTMLCanvasElement.prototype,'toBlob');
 const bodies:FormData[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(String(path).endsWith('/frames'))bodies.push(init?.body as FormData);
  return {ok:true,status:200,json:async()=>String(path).endsWith('/auth/csrf')?{csrfToken:'x'}:{...observation,state:'READY'}};
 }));
 await startRecognition();await waitFor(()=>expect(bodies.length).toBe(1));
 expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg',0.85);
 expect(toBlob).not.toHaveBeenCalled();
 const frame=bodies[0].get('frame') as Blob;
 expect(frame.type).toBe('image/jpeg');
 expect(await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result);reader.readAsText(frame);})).toBe('jpeg-bytes');
});
function framesApi(respond:(count:number)=>unknown) {
 let frames=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,status:200,json:async()=>String(path).endsWith('/frames')?respond(++frames):path.endsWith('/auth/csrf')?{csrfToken:'x'}:observation})));
 return ()=>frames;
}
async function startRecognition() {
 render(<Camera/>);
 // Mở camera là tự bắt đầu nhận dạng.
 fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
}

it('downscales 1920x1080 frames to 1280x720 before upload',async()=>{
 const sizes=mediaOf(1920,1080);const frames=framesApi(()=>({...observation,state:'READY'}));
 await startRecognition();await waitFor(()=>expect(frames()).toBe(1));
 expect(sizes).toEqual([[1280,720]]);
});

it('does not upscale frames smaller than 1280px',async()=>{
 const sizes=mediaOf(640,480);const frames=framesApi(()=>({...observation,state:'READY'}));
 await startRecognition();await waitFor(()=>expect(frames()).toBe(1));
 expect(sizes).toEqual([[640,480]]);
});

it('sends the next frame without a fixed delay',async()=>{
 mediaOf(640,480);const frames=framesApi(count=>({...observation,state:count>=2?'READY':'COLLECTING'}));
 render(<Camera/>);
 vi.useFakeTimers({toFake:['setTimeout','setInterval']});
 try {
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
  for(let i=0;i<20 && frames()<2;i++) await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(frames()).toBe(2);
 } finally {vi.useRealTimers();}
});

it('positions candidate boxes using the uploaded frame size',async()=>{
 mediaOf(1920,1080);const frames=framesApi(()=>({...observation,needsTarget:true,candidates:[{plateNumber:'51F12345',bbox:[640,360,1280,720],confidence:0.9}]}));
 await startRecognition();await waitFor(()=>expect(frames()).toBe(1));
 const box=await screen.findByRole('button',{name:'Chọn mục tiêu 51F12345'});
 expect(box.style.left).toBe('50%');expect(box.style.top).toBe('50%');expect(box.style.width).toBe('50%');expect(box.style.height).toBe('50%');
});

it('shows the vehicle-type badge only once a plate is read',async()=>{
 mediaOf(640,480);
 let plateNumber:string|null=null;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,status:200,json:async()=>String(path).endsWith('/auth/csrf')?{csrfToken:'x'}:{...observation,state:'READY',plateNumber,vehicleHint:null}})));
 for(const empty of [null,'']){
  plateNumber=empty;
  await startRecognition();
  await screen.findByRole('button',{name:/^Xác nhận biển số/});
  expect(screen.queryByText('Kiểm tra loại xe')).toBeNull();
  cleanup();
 }
 plateNumber='51F12345';
 await startRecognition();
 expect(await screen.findByText('Kiểm tra loại xe')).toBeTruthy();
});

type Reply={status?:number;body:unknown};
function routeApi(route:(path:string,count:Record<string,number>)=>Reply){
 const count:Record<string,number>={};
 const fetch=vi.fn(async(input:string)=>{
  const path=String(input).replace('/api/v1','').replace(/\/sessions\/[^/]+/,'/sessions/:id');
  count[path]=(count[path]||0)+1;
  const {status=200,body}=path==='/auth/csrf'?{body:{csrfToken:'x'}}:route(path,count);
  return {ok:status<400,status,json:async()=>body};
 });
 vi.stubGlobal('fetch',fetch);
 return count;
}
const expired={status:410,body:{error:{code:'SESSION_EXPIRED',message:'Start a new recognition session'}}};
const seen={...observation,plateNumber:'88G133343',candidates:[{plateNumber:'88G133343',bbox:[1,1,9,5],confidence:.7}]};

it('renews an expired session and keeps reading while a plate is in view',async()=>{
 mediaOf(640,480);
 const count=routeApi((path,c)=>path==='/recognition/sessions'?{body:observation}:
  c[path]===3?expired:{body:{...seen,state:c[path]>=5?'READY':'COLLECTING',status:c[path]>=5?'STABLE':'UNCERTAIN'}});
 await startRecognition();
 expect(await screen.findByText('Ổn định',{exact:false})).toBeTruthy();
 expect(count['/recognition/sessions']).toBe(2);
 expect(screen.queryByRole('alert')).toBeNull();
});

it('stops with a Vietnamese message and a re-read button when the session expires without a plate',async()=>{
 mediaOf(640,480);
 const count=routeApi((path,c)=>path==='/recognition/sessions'?{body:observation}:c[path]===2?expired:{body:observation});
 await startRecognition();
 expect((await screen.findByRole('alert')).textContent).toContain('Hết thời gian đọc');
 expect(count['/recognition/sessions']).toBe(1);
 expect(screen.getByRole('button',{name:'Đọc lại'})).toBeTruthy();
});

it('reads again instead of dead-ending when confirming an expired session',async()=>{
 mediaOf(640,480);
 const count=routeApi((path,c)=>path==='/recognition/sessions'?{body:observation}:
  path.endsWith('/confirm')?expired:{body:{...seen,state:'READY',status:c[path]>=2?'STABLE':'UNCERTAIN'}});
 await startRecognition();
 fireEvent.click(await screen.findByRole('button',{name:/^Xác nhận biển số/}));
 expect((await screen.findByRole('alert')).textContent).toContain('Phiên đọc đã hết hạn');
 await waitFor(()=>expect(count['/recognition/sessions']).toBe(2));
});

it('clears the previous plate when a new reading fails before its first frame',async()=>{
 mediaOf(640,480);
 let ended=false;vi.spyOn(HTMLMediaElement.prototype,'ended','get').mockImplementation(()=>ended);
 routeApi(path=>path==='/recognition/sessions'?{body:observation}:{body:{...seen,state:'READY'}});
 await startRecognition();
 await screen.findByRole('button',{name:/^Xác nhận biển số/});
 ended=true;fireEvent.click(screen.getByRole('button',{name:'Sửa'}));
 fireEvent.click(screen.getByRole('button',{name:'Đọc lại'}));
 expect((await screen.findByRole('alert')).textContent).toContain('đã kết thúc');
 expect(screen.queryByLabelText('Lý do sửa biển số')).toBeNull();
});

it('confirms a staff correction as manual entry when the reading session has expired',async()=>{
 mediaOf(640,480);
 const count=routeApi(path=>path==='/recognition/sessions'?{body:observation}:path.endsWith('/confirm')?expired:path==='/recognition/manual'?{body:{sourceEventId:'m',plateNumber:'51F99999',expiresAt:'2099-01-01',vehicleHint:null}}:{body:{...seen,state:'READY'}});
 await startRecognition();
 fireEvent.click(await screen.findByRole('button',{name:'Sửa'}));
 fireEvent.change(screen.getByLabelText('Biển số nhận dạng'),{target:{value:'51F99999'}});
 fireEvent.change(screen.getByLabelText('Lý do sửa biển số'),{target:{value:'Camera đọc sai'}});
 fireEvent.click(screen.getByRole('button',{name:/^Xác nhận biển số/}));
 await waitFor(()=>expect(count['/recognition/manual']).toBe(1));
 const call=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/recognition/manual'))!;
 expect(JSON.parse(String((call as unknown as [string,RequestInit])[1].body))).toEqual({plateNumber:'51F99999',mode:'ENTRY',reason:'Camera đọc sai'});
 expect(screen.queryByRole('alert')).toBeNull();
 expect(count['/recognition/sessions']).toBe(1);
});

it('confirms the shown plate as manual entry when the session expired and the video has ended',async()=>{
 mediaOf(640,480);
 let ended=false;vi.spyOn(HTMLMediaElement.prototype,'ended','get').mockImplementation(()=>ended);
 const count=routeApi(path=>path==='/recognition/sessions'?{body:observation}:path.endsWith('/confirm')?expired:path==='/recognition/manual'?{body:{sourceEventId:'m',plateNumber:'88G133343',expiresAt:'2099-01-01',vehicleHint:null}}:{body:{...seen,state:'READY'}});
 await startRecognition();
 await screen.findByRole('button',{name:/^Xác nhận biển số/});
 ended=true;
 fireEvent.click(screen.getByRole('button',{name:/^Xác nhận biển số/}));
 await waitFor(()=>expect(count['/recognition/manual']).toBe(1));
 const call=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/recognition/manual'))!;
 const body=JSON.parse(String((call as unknown as [string,RequestInit])[1].body));
 expect(body).toMatchObject({plateNumber:'88G133343',mode:'ENTRY'});
 expect(body.reason).toMatch(/hết hạn/);
 expect(count['/recognition/sessions']).toBe(1);
 expect(screen.queryByRole('alert')).toBeNull();
});

it('shows the read plate on two lines like the physical plate',async()=>{
 mediaOf(640,480);
 routeApi(path=>path==='/recognition/sessions'?{body:observation}:{body:{...seen,state:'READY',status:'STABLE',vehicleHint:{type:'MOTORBIKE',source:'SERIES'}}});
 await startRecognition();
 const plate=await screen.findByRole('img',{name:'Biển số 88G133343'});
 expect([...plate.querySelectorAll('.plate-line')].map(line=>line.textContent)).toEqual(['88-G1','333.43']);
});

const notFound={status:404,body:{error:{code:'SESSION_NOT_FOUND',message:'Recognition session not found'}}};
it('treats a pruned session (404) like an expired one while reading',async()=>{
 mediaOf(640,480);
 const count=routeApi((path,c)=>path==='/recognition/sessions'?{body:observation}:
  c[path]===3?notFound:{body:{...seen,state:c[path]>=5?'READY':'COLLECTING',status:c[path]>=5?'STABLE':'UNCERTAIN'}});
 await startRecognition();
 expect(await screen.findByText('Ổn định',{exact:false})).toBeTruthy();
 expect(count['/recognition/sessions']).toBe(2);
 expect(screen.queryByText(/Recognition session not found/)).toBeNull();
});

it('reads again when confirming a session the server no longer has',async()=>{
 mediaOf(640,480);
 const count=routeApi((path,c)=>path==='/recognition/sessions'?{body:observation}:
  path.endsWith('/confirm')?notFound:{body:{...seen,state:'READY',status:c[path]>=2?'STABLE':'UNCERTAIN'}});
 await startRecognition();
 fireEvent.click(await screen.findByRole('button',{name:/^Xác nhận biển số/}));
 expect((await screen.findByRole('alert')).textContent).toContain('Phiên đọc đã hết hạn');
 await waitFor(()=>expect(count['/recognition/sessions']).toBe(2));
});

it('applies the frame already in flight when staff stop, so the confirmed plate matches the server',async()=>{
 mediaOf(640,480);
 let release:(v:unknown)=>void=()=>{};let frames=0;
 const bodies:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const path=String(input);
  const reply=(body:unknown)=>({ok:true,status:200,json:async()=>body});
  if(path.endsWith('/auth/csrf'))return reply({csrfToken:'x'});
  if(path.endsWith('/frames')){
   frames++;
   if(frames===1)return reply({...observation,plateNumber:'45B123456',candidates:[{plateNumber:'45B123456',bbox:[1,1,9,5],confidence:.6}]});
   return await new Promise(r=>{release=v=>r(reply(v));});
  }
  if(path.endsWith('/confirm')){bodies.push(JSON.parse(String(init?.body)));return reply({sourceEventId:'e',plateNumber:'85B123456',expiresAt:'2099-01-01',vehicleHint:null});}
  return reply(observation);
 }));
 await startRecognition();
 await screen.findByRole('img',{name:'Biển số 45B123456'});
 await waitFor(()=>expect(frames).toBe(2));
 fireEvent.click(screen.getByRole('button',{name:'Dừng nhận dạng'}));
 // Server đã chấm khung đang bay: biển phiên đổi sang 85B123456.
 await act(async()=>release({...observation,plateNumber:'85B123456',candidates:[{plateNumber:'85B123456',bbox:[1,1,9,5],confidence:.6}]}));
 await screen.findByRole('img',{name:'Biển số 85B123456'});
 fireEvent.click(await screen.findByRole('button',{name:/^Xác nhận biển số/}));
 await waitFor(()=>expect(bodies).toEqual([{plateNumber:'85B123456'}]));
 expect(frames).toBe(2);
});
