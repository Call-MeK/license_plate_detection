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
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['jpeg-bytes'],{type:'image/jpeg'})));
 return sizes;
}
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
