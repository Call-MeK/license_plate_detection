import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CameraCard, PlateStep, useRecognition } from './Camera';
import ParkingPage from './ParkingPage';
import HistoryPage from './HistoryPage';
import App from './App';
import { AuditPage, UsersPage } from './AdminPage';
import { api, type Confirmation, type Mode } from './api';

const user={id:'u',username:'staff',role:'STAFF' as const};
const admin={id:'a',username:'admin',role:'ADMIN' as const};
function setupFetch(handler:(path:string,body:any)=>unknown) {
 vi.stubGlobal('fetch',vi.fn(async (path:string,init?:RequestInit)=>({ok:true,status:200,json:async()=>handler(path,init?.body && typeof init.body==='string'?JSON.parse(init.body):init?.body)})));
}
const session={id:'s',vehicleId:'v',plateNumber:'51F12345',vehicleType:'CAR',status:'ACTIVE',checkInAt:'2026-01-01T00:00:00Z',pricingSnapshot:{hourlyRate:'10000',roundingMinutes:60}};
function base(path:string) {
 if(path.endsWith('/auth/csrf')) return {csrfToken:'csrf'};
 if(path.includes('/parking-sessions?')) return {items:[session],total:1,page:1,pageSize:20};
 if(path.includes('/alerts?')) return {items:[],total:0,page:1,pageSize:20};
 if(path.includes('/pricing-policies')) return {items:[],total:0,page:1,pageSize:100};
 if(path.endsWith('/recognition/manual')) return {sourceEventId:'event',plateNumber:'51F12345',expiresAt:'2099-01-01',vehicleHint:{type:'CAR',source:'SERIES'}};
 if(path.endsWith('/fee-preview')) return {sessionId:'s',fee:10000,durationMinutes:60,asOf:'2026-01-01T01:00:00Z'};
 return {};
}
const button=(name:string|RegExp)=>screen.getByRole('button',{name}) as HTMLButtonElement;
const checkInButton=()=>button(/^Ghi nhận xe vào/);
const checkOutButton=()=>button(/^Ghi nhận xe ra/);
async function manual(mode:Mode='ENTRY') {
 if(mode==='EXIT') fireEvent.click(button('Xe ra'));
 fireEvent.click(button(/^Nhập tay/));
 fireEvent.change(screen.getByLabelText('Biển số thủ công'),{target:{value:'51F12345'}});
 fireEvent.change(screen.getByLabelText('Lý do nhập thủ công'),{target:{value:'Camera lỗi'}});
 fireEvent.click(button('Xác nhận thủ công'));
 await screen.findByRole('button',{name:'Sửa biển số'});
}
function Recognition({onConfirm,mode='ENTRY'}:{onConfirm:(value:Confirmation)=>void;mode?:Mode}){
 const rec=useRecognition(mode,onConfirm,()=>{});
 return <><CameraCard rec={rec}/><PlateStep rec={rec}/></>;
}

describe('parking operator safeguards',()=>{
 it('requires a vehicle type before checking in an ambiguous plate',async()=>{
  setupFetch(path=>path.endsWith('/recognition/manual')?{sourceEventId:'event',plateNumber:'29AB90111',expiresAt:'2099-01-01',vehicleHint:{type:null,source:null}}:path.endsWith('/check-in/precheck')?{sourceEventId:'event',plateNumber:'29AB90111',canCheckIn:true,alerts:[]}:path.endsWith('/parking-sessions/check-in')?{checkInAt:'2026-01-01T00:00:00Z'}:base(path));
  render(<ParkingPage user={user}/>);await manual();
  await waitFor(()=>expect(screen.getByText(/Không có cảnh báo chờ xử lý/)).toBeTruthy());
  expect(checkInButton().disabled).toBe(true);
  fireEvent.click(button('Xe máy'));
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));
  fireEvent.click(checkInButton());
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).endsWith('/parking-sessions/check-in'))).toBe(true));
  const call=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/parking-sessions/check-in'))!;
  expect(JSON.parse(String(call[1]?.body)).vehicleType).toBe('MOTORBIKE');
 });
 it('explains permission denial and offers local video',async()=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockRejectedValue(new DOMException('denied','NotAllowedError'))}});
  render(<Recognition onConfirm={()=>{}}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
  expect(await screen.findByText(/Quyền camera bị từ chối/)).toBeTruthy();
  expect(screen.getByLabelText('Video cục bộ')).toBeTruthy();
 });
 it('requires review before check-in',async()=>{
  setupFetch(path=>path.endsWith('/check-in/precheck')?{sourceEventId:'event',plateNumber:'51F12345',canCheckIn:false,alerts:[{id:'a',plateNumber:'51F12345',status:'PENDING'}]}:base(path));
  render(<ParkingPage user={user}/>); await manual();
  expect(await screen.findByText(/Cần xử lý cảnh báo/)).toBeTruthy();
  expect(checkInButton().disabled).toBe(true);
 });
 it('requires payment confirmation and refreshes changed fee',async()=>{
  let previews=0;
  setupFetch(path=>{if(path.endsWith('/fee-preview'))return {sessionId:'s',fee:++previews===1?10000:12000,durationMinutes:60,asOf:'2026-01-01T01:00:00Z'};return base(path);});
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async (p,init)=>String(p).endsWith('/check-out')?{ok:false,status:409,json:async()=>({error:{code:'FEE_CHANGED',message:'changed'}})} as Response:impl(p,init));
  render(<ParkingPage user={user}/>);await manual('EXIT');
  await waitFor(()=>expect(screen.getByLabelText('Phí gửi xe').textContent).toMatch(/10\.000/));
  expect(checkOutButton().disabled).toBe(true);
  fireEvent.click(screen.getByRole('switch',{name:'Đã nhận đủ tiền'}));
  fireEvent.click(checkOutButton());
  await waitFor(()=>expect(screen.getByLabelText('Phí gửi xe').textContent).toMatch(/12\.000/));
  expect(screen.getByRole('switch',{name:'Đã nhận đủ tiền'}).getAttribute('aria-checked')).toBe('false');
  expect(checkOutButton().disabled).toBe(true);
 });
 it('hides admin access from staff',async()=>{
  setupFetch(path=>path.endsWith('/auth/me')?user:base(path));render(<App/>);
  await screen.findByText('Nhân viên: staff');
  expect(screen.queryByRole('navigation',{name:'Quản trị'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Biểu phí'})).toBeNull();
 });
 it('sends credentials and csrf without storing jwt',async()=>{
  setupFetch(path=>base(path)); await api('/auth/login',{method:'POST',body:JSON.stringify({username:'x',password:'p'})});
  const [,options]=vi.mocked(fetch).mock.calls.at(-1)!;
  expect(options?.credentials).toBe('include');
  expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe('csrf');
 });
 it('locks check-in and reuses the idempotency key after an uncertain network result',async()=>{
  let rejectRequest:(e:Error)=>void=()=>{};const attempts:{key:string|null,body:unknown}[]=[];
  setupFetch(path=>path.endsWith('/check-in/precheck')?{sourceEventId:'event',plateNumber:'51F12345',canCheckIn:true,alerts:[]}:base(path));
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async(p,options)=>{
   if(String(p).endsWith('/check-in')){attempts.push({key:new Headers(options?.headers).get('Idempotency-Key'),body:options?.body});if(attempts.length===1)await new Promise((_,reject)=>{rejectRequest=reject;});}
   return impl(p,options);
  });
  render(<ParkingPage user={user}/>);await manual();
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));
  fireEvent.click(checkInButton());await waitFor(()=>expect(attempts).toHaveLength(1));
  expect(checkInButton().disabled).toBe(true);fireEvent.click(checkInButton());expect(attempts).toHaveLength(1);
  await act(async()=>rejectRequest(new Error('Mất kết nối')));await screen.findByText(/Mất kết nối/);
  vi.spyOn(Date,'now').mockReturnValue(new Date('2100-01-01').getTime());fireEvent.click(checkInButton());
  await waitFor(()=>expect(attempts).toHaveLength(2));expect(attempts[0].key).toBeTruthy();expect(attempts[1]).toEqual(attempts[0]);
  await screen.findByText('Đã ghi nhận xe vào.');
 });
 it('replays the same checkout after a lost response and confirmation expiry',async()=>{
  const attempts:{key:string|null,body:unknown}[]=[];
  setupFetch(path=>base(path));
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async(p,options)=>{
   if(String(p).endsWith('/check-out')){
    attempts.push({key:new Headers(options?.headers).get('Idempotency-Key'),body:options?.body});
    if(attempts.length===1)throw new Error('Mất phản hồi thanh toán');
   }
   return impl(p,options);
  });
  render(<ParkingPage user={user}/>);await manual('EXIT');
  await waitFor(()=>expect(screen.getByLabelText('Phí gửi xe').textContent).toMatch(/10\.000/));
  fireEvent.click(screen.getByRole('switch',{name:'Đã nhận đủ tiền'}));fireEvent.click(checkOutButton());
  await screen.findByText(/Mất phản hồi thanh toán/);
  vi.spyOn(Date,'now').mockReturnValue(new Date('2100-01-01').getTime());
  fireEvent.click(checkOutButton());
  await screen.findByText('Đã ghi nhận xe ra và thanh toán.');
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
 });
 it('invalidates confirmation and precheck when the operator edits the plate',async()=>{
  setupFetch(path=>path.endsWith('/check-in/precheck')?{sourceEventId:'event',plateNumber:'51F12345',canCheckIn:true,alerts:[]}:base(path));
  render(<ParkingPage user={user}/>);await manual();
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));
  fireEvent.click(button('Sửa biển số'));
  fireEvent.change(screen.getByLabelText('Biển số thủ công'),{target:{value:'51F99999'}});
  expect(screen.queryByRole('button',{name:'Sửa biển số'})).toBeNull();expect(checkInButton().disabled).toBe(true);
 });
 it('requires both alert result and note, then reruns precheck',async()=>{
  let reviewed=false;
  setupFetch(path=>{
   if(path.endsWith('/alerts/a/review')){reviewed=true;return {};}
   if(path.endsWith('/check-in/precheck'))return {sourceEventId:'event',plateNumber:'51F12345',canCheckIn:reviewed,alerts:reviewed?[]:[{id:'a',plateNumber:'51F12345',status:'PENDING'}]};return base(path);
  });render(<ParkingPage user={user}/>);await manual();
  fireEvent.click(await screen.findByRole('button',{name:'Xem & xử lý'}));
  const review=await screen.findByRole('button',{name:'Lưu xử lý 51F12345'}) as HTMLButtonElement;expect(review.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Đã xem xét/));expect(review.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Ghi chú xử lý'),{target:{value:'Đã kiểm tra giấy tờ'}});fireEvent.click(review);
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));
 });
 it('searches active plates on the server rather than only the first page',async()=>{
  setupFetch(path=>base(path));render(<ParkingPage user={user}/>);await manual('EXIT');
  fireEvent.click(await screen.findByRole('button',{name:'Đổi lượt'}));
  fireEvent.change(screen.getByLabelText('Lọc biển số'),{target:{value:'51F99'}});fireEvent.click(button('Tìm xe đang gửi'));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).includes('plateNumber=51F99'))).toBe(true));
 });
 it('does not show an unpaid active session as zero-fee in history',async()=>{
  setupFetch(path=>path.includes('/parking-sessions?')?{items:[{...session,fee:null}],total:1,page:1,pageSize:20}:base(path));
  render(<HistoryPage user={user}/>);
  const row=await screen.findByRole('row',{name:/51F12345 đang gửi/});
  expect(within(row).getAllByRole('cell')[4].textContent).toBe('—');
 });
});

describe('vehicle type hint',()=>{
 const precheckOk={sourceEventId:'event',plateNumber:'51F12345',canCheckIn:true,alerts:[]};
 const withHint=(vehicleHint:unknown)=>setupFetch(path=>path.endsWith('/recognition/manual')?{...base(path) as object,vehicleHint}:path.endsWith('/check-in/precheck')?precheckOk:base(path));
 it('preselects motorbike from confirmation hint',async()=>{
  withHint({type:'MOTORBIKE',source:'SERIES'});render(<ParkingPage user={user}/>);await manual();
  expect(button('Xe máy').getAttribute('aria-pressed')).toBe('true');expect(button('Ô tô').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByText('Xe máy · theo seri')).toBeTruthy();
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));
 });
 it('requires choosing a type when hint is unsure',async()=>{
  withHint({type:null,source:null});render(<ParkingPage user={user}/>);await manual();
  expect(button('Ô tô').getAttribute('aria-pressed')).toBe('false');expect(button('Xe máy').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByText('Kiểm tra loại xe')).toBeTruthy();
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).endsWith('/check-in/precheck'))).toBe(true));
  await waitFor(()=>expect(screen.getByText(/Không có cảnh báo chờ xử lý/)).toBeTruthy());
  expect(checkInButton().disabled).toBe(true);
  fireEvent.click(button('Ô tô'));
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));
 });
 it('staff can override the suggested type',async()=>{
  withHint({type:'MOTORBIKE',source:'RECORD'});render(<ParkingPage user={user}/>);await manual();
  expect(screen.getByText('Xe máy · theo hồ sơ')).toBeTruthy();
  fireEvent.click(button('Ô tô'));
  await waitFor(()=>expect(checkInButton().disabled).toBe(false));fireEvent.click(checkInButton());
  await screen.findByText('Đã ghi nhận xe vào.');
  const call=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/parking-sessions/check-in'))!;
  expect(JSON.parse(String(call[1]?.body)).vehicleType).toBe('CAR');
 });
});

describe('camera observation',()=>{
 function media(){
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop:vi.fn()}]})}});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype,'videoWidth','get').mockReturnValue(640);vi.spyOn(HTMLVideoElement.prototype,'videoHeight','get').mockReturnValue(480);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['jpeg-bytes'],{type:'image/jpeg'})));
 }
 const observation={id:'r',mode:'ENTRY',sequence:0,state:'COLLECTING',status:'UNCERTAIN',plateNumber:'51F12345',candidates:[],needsTarget:false,stub:false};
 it('labels the combined model score without presenting it as accuracy',async()=>{
  media();
  setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:path.endsWith('/frames')?{...observation,state:'READY',status:'STABLE',candidates:[{plateNumber:'51F12345',bbox:[10,20,60,40],confidence:.5}]}:observation);
  render(<Recognition onConfirm={()=>{}}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
  expect(await screen.findByText(/Điểm AI: 50%/)).toBeTruthy();
  expect(screen.getByText(/không phải tỷ lệ đọc đúng/i)).toBeTruthy();
 });
 const start=()=>button(/^Bắt đầu nhận dạng/);
 it('lets staff stop an uncertain observation, edit the plate, and explicitly confirm with a reason',async()=>{
  media();const onConfirm=vi.fn();setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:path.endsWith('/confirm')?{sourceEventId:'event',plateNumber:'51F99999'}:observation);
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async(p,options)=>{if(String(p).endsWith('/frames'))await new Promise(resolve=>setTimeout(resolve,20));return impl(p,options);});
  render(<Recognition onConfirm={onConfirm}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);await screen.findByText('51F12345');
  expect(onConfirm).not.toHaveBeenCalled();fireEvent.click(button('Dừng nhận dạng'));
  fireEvent.click(await screen.findByRole('button',{name:'Sửa'}));
  fireEvent.change(screen.getByLabelText('Biển số nhận dạng'),{target:{value:'51F99999'}});
  const confirm=button(/^Xác nhận biển số/);expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do sửa biển số'),{target:{value:'Đối chiếu trực tiếp'}});fireEvent.click(confirm);
  await waitFor(()=>expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({plateNumber:'51F99999'})));
  const request=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/confirm'))!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({plateNumber:'51F99999',reason:'Đối chiếu trực tiếp'});
 });
 it('shows series hint while reading in step 1',async()=>{
  media();const hinted={...observation,state:'READY',status:'STABLE',vehicleHint:{type:'CAR',source:'SERIES'}};
  setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:hinted);
  const entry=render(<Recognition onConfirm={()=>{}}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);await screen.findByText('Ô tô · theo seri');
  entry.unmount();
  render(<Recognition mode="EXIT" onConfirm={()=>{}}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);await screen.findByRole('button',{name:/^Xác nhận biển số/});
  expect(screen.queryByText('Ô tô · theo seri')).toBeNull();
 });
 it('submits JPEG and waits for a frame response before sending another',async()=>{
  media();let finish:(value:any)=>void=()=>{};let frameRequests=0;let form:FormData|undefined;
  setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:observation);
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async(p,options)=>{
   if(String(p).endsWith('/frames')){frameRequests++;form=options?.body as FormData;return await new Promise(resolve=>{finish=resolve;});}return impl(p,options);
  });render(<Recognition onConfirm={()=>{}}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);await waitFor(()=>expect(frameRequests).toBe(1));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,600));});expect(frameRequests).toBe(1);
  expect(form?.get('sequence')).toBe('1');expect((form?.get('frame') as File).type).toBe('image/jpeg');
  await act(async()=>finish({ok:true,json:async()=>({...observation,state:'READY'})}));
  await screen.findByRole('button',{name:/^Xác nhận biển số/});
 });
});

describe('admin forms',()=>{
 it('uses backend password length for user creation and password change',async()=>{
  setupFetch(path=>path.endsWith('/auth/me')?user:base(path));
  const app=render(<App/>);await screen.findByText('Nhân viên: staff');
  fireEvent.click(button('Tài khoản'));fireEvent.click(await screen.findByRole('menuitem',{name:/Đổi mật khẩu/}));
  expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).minLength).toBe(12);
  app.unmount();
  setupFetch(path=>path.includes('/users?')?{items:[],total:0,page:1,pageSize:20}:base(path));
  render(<UsersPage user={admin}/>);fireEvent.click(button('Thêm nhân viên'));
  const password=screen.getByLabelText('Mật khẩu tạm') as HTMLInputElement;
  expect(password.minLength).toBe(12);expect(password.value.length).toBeGreaterThanOrEqual(12);
 });
 it('keeps timezone-aware audit filters when moving to the next page',async()=>{
  setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:{items:[],total:21,page:1,pageSize:20});
  vi.mocked(fetch).mockImplementation(async(p)=>({ok:true,status:200,json:async()=>String(p).includes('/audit-logs')?{items:[{id:'l',actorId:null,action:'LOGIN',entityType:'User',entityId:'u',details:null,createdAt:'2026-01-01T10:00:00Z'}],total:21,page:1,pageSize:20}:{items:[],total:0,page:1,pageSize:100}}) as Response);
  render(<AuditPage/>);
  fireEvent.click(button(/Lọc nâng cao/));
  fireEvent.change(screen.getByLabelText('Từ lúc'),{target:{value:'2026-01-01T10:00'}});
  fireEvent.click(button('Áp dụng'));
  const expected=new Date('2026-01-01T10:00').toISOString();
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>new URL(String(p),'http://localhost').searchParams.get('dateFrom')===expected)).toBe(true));
  await waitFor(()=>expect(button('Trang sau').disabled).toBe(false));fireEvent.click(button('Trang sau'));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>{const q=new URL(String(p),'http://localhost').searchParams;return q.get('page')==='2' && q.get('dateFrom')===expected;})).toBe(true));
 });
});
