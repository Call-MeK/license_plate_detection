import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Camera from './Camera';
import ParkingPage from './ParkingPage';
import App from './App';
import AdminPage from './AdminPage';
import { api } from './api';

const user={id:'u',username:'staff',role:'STAFF' as const};
function setupFetch(handler:(path:string,body:any)=>unknown) {
 vi.stubGlobal('fetch',vi.fn(async (path:string,init?:RequestInit)=>({ok:true,status:200,json:async()=>handler(path,init?.body && typeof init.body==='string'?JSON.parse(init.body):init?.body)})));
}
const session={id:'s',plateNumber:'51F12345',vehicleType:'CAR',status:'ACTIVE',checkInAt:'2026-01-01T00:00:00Z'};
function base(path:string) {
 if(path.endsWith('/auth/csrf')) return {csrfToken:'csrf'};
 if(path.includes('/parking-sessions?')) return {items:[session],total:1,page:1,pageSize:20};
 if(path.includes('/alerts?')) return {items:[],total:0,page:1,pageSize:20};
 if(path.endsWith('/recognition/manual')) return {sourceEventId:'event',plateNumber:'51F12345',expiresAt:'2099-01-01'};
 if(path.endsWith('/fee-preview')) return {sessionId:'s',fee:10000,durationMinutes:60,asOf:'now'};
 return {};
}
async function manual(mode='ENTRY') {
 if(mode==='EXIT') fireEvent.change(screen.getByLabelText('Chế độ'),{target:{value:'EXIT'}});
 fireEvent.change(screen.getByLabelText('Biển số thủ công'),{target:{value:'51F12345'}});
 fireEvent.change(screen.getByLabelText('Lý do nhập thủ công'),{target:{value:'Camera lỗi'}});
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận thủ công'}));
 await screen.findByText('Đã xác nhận: 51F12345');
}
describe('parking operator safeguards',()=>{
 it('explains permission denial and offers local video',async()=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockRejectedValue(new DOMException('denied','NotAllowedError'))}});
  render(<Camera mode="ENTRY" onConfirm={()=>{}} onInvalidate={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Mở camera'}));
  expect(await screen.findByText(/Quyền camera bị từ chối/)).toBeTruthy();
  expect(screen.getByLabelText('Video cục bộ')).toBeTruthy();
 });
 it('requires review before check-in and disables duplicate submissions',async()=>{
  let finish:()=>void=()=>{};
  setupFetch(path=>base(path));
  const fetchMock=vi.mocked(fetch);
  fetchMock.mockImplementation(async (path,init)=>{
   const p=String(path); if(p.endsWith('/check-in/precheck')) return {ok:true,status:200,json:async()=>({sourceEventId:'event',plateNumber:'51F12345',canCheckIn:false,alerts:[{id:'a',plateNumber:'51F12345',status:'PENDING'}]})} as Response;
   if(p.endsWith('/check-in')) await new Promise<void>(r=>{finish=r;});
   return {ok:true,status:200,json:async()=>base(p)} as Response;
  });
  render(<ParkingPage user={user}/>); await manual();
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra xe vào'}));
  expect(await screen.findByText(/Cần xử lý cảnh báo/)).toBeTruthy();
  expect((screen.getByRole('button',{name:'Ghi nhận xe vào'}) as HTMLButtonElement).disabled).toBe(true);
  finish();
 });
 it('requires payment confirmation and refreshes changed fee',async()=>{
  let previews=0;
  setupFetch(path=>{if(path.endsWith('/fee-preview'))return {sessionId:'s',fee:++previews===1?10000:12000,durationMinutes:60,asOf:'now'};return base(path);});
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async (p,init)=>String(p).endsWith('/check-out')?{ok:false,status:409,json:async()=>({error:{code:'FEE_CHANGED',message:'changed'}})} as Response:impl(p,init));
  render(<ParkingPage user={user}/>);await manual('EXIT');
  fireEvent.click(await screen.findByRole('button',{name:'Chọn 51F12345'}));
  await screen.findByText(/10.000/);
  const checkout=screen.getByRole('button',{name:'Ghi nhận xe ra'});
  expect((checkout as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Đã nhận đủ tiền'));
  fireEvent.click(checkout);
  await screen.findByText(/12.000/);
  expect((screen.getByLabelText('Đã nhận đủ tiền') as HTMLInputElement).checked).toBe(false);
  expect((checkout as HTMLButtonElement).disabled).toBe(true);
 });
 it('hides admin access from staff',async()=>{
  setupFetch(path=>path.endsWith('/auth/me')?user:base(path));render(<App/>);
  await screen.findByText('Nhân viên: staff');
  expect(screen.queryByRole('button',{name:'Quản trị'})).toBeNull();
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
  render(<ParkingPage user={user}/>);await manual();fireEvent.click(screen.getByRole('button',{name:'Kiểm tra xe vào'}));
  const submit=screen.getByRole('button',{name:'Ghi nhận xe vào'});
  await waitFor(()=>expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);await waitFor(()=>expect(attempts).toHaveLength(1));
  expect((submit as HTMLButtonElement).disabled).toBe(true);fireEvent.click(submit);expect(attempts).toHaveLength(1);
  await act(async()=>rejectRequest(new Error('Mất kết nối')));await screen.findByText(/Mất kết nối/);
  vi.spyOn(Date,'now').mockReturnValue(new Date('2100-01-01').getTime());fireEvent.click(submit);
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
  fireEvent.click(await screen.findByRole('button',{name:'Chọn 51F12345'}));await screen.findByText(/10.000/);
  fireEvent.click(screen.getByLabelText('Đã nhận đủ tiền'));fireEvent.click(screen.getByRole('button',{name:'Ghi nhận xe ra'}));
  await screen.findByText(/Mất phản hồi thanh toán/);
  vi.spyOn(Date,'now').mockReturnValue(new Date('2100-01-01').getTime());
  fireEvent.click(screen.getByRole('button',{name:'Ghi nhận xe ra'}));
  await screen.findByText('Đã ghi nhận xe ra và thanh toán.');
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
 });
 it('invalidates confirmation and precheck when the operator edits the plate',async()=>{
  setupFetch(path=>path.endsWith('/check-in/precheck')?{sourceEventId:'event',plateNumber:'51F12345',canCheckIn:true,alerts:[]}:base(path));
  render(<ParkingPage user={user}/>);await manual();fireEvent.click(screen.getByRole('button',{name:'Kiểm tra xe vào'}));
  const submit=screen.getByRole('button',{name:'Ghi nhận xe vào'});await waitFor(()=>expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Biển số thủ công'),{target:{value:'51F99999'}});
  expect(screen.queryByText('Đã xác nhận: 51F12345')).toBeNull();expect((submit as HTMLButtonElement).disabled).toBe(true);
 });
 it('requires both alert result and note, then reruns precheck',async()=>{
  let reviewed=false;
  setupFetch(path=>{
   if(path.endsWith('/alerts/a/review')){reviewed=true;return {};}
   if(path.endsWith('/check-in/precheck'))return {sourceEventId:'event',plateNumber:'51F12345',canCheckIn:reviewed,alerts:reviewed?[]:[{id:'a',plateNumber:'51F12345',status:'PENDING'}]};return base(path);
  });render(<ParkingPage user={user}/>);await manual();fireEvent.click(screen.getByRole('button',{name:'Kiểm tra xe vào'}));
  const review=await screen.findByRole('button',{name:'Lưu xử lý 51F12345'});expect((review as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Trạng thái xử lý 51F12345'),{target:{value:'REVIEWED'}});expect((review as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Ghi chú xử lý 51F12345'),{target:{value:'Đã kiểm tra giấy tờ'}});fireEvent.click(review);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Ghi nhận xe vào'}) as HTMLButtonElement).disabled).toBe(false));
 });
 it('searches active plates on the server rather than only the first page',async()=>{
  setupFetch(path=>base(path));render(<ParkingPage user={user}/>);await manual('EXIT');
  fireEvent.change(screen.getByLabelText('Lọc biển số'),{target:{value:'51F12345'}});fireEvent.click(screen.getByRole('button',{name:'Tìm xe đang gửi'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).includes('plateNumber=51F12345'))).toBe(true));
 });
 it('does not show an unpaid active session as zero-fee in history',async()=>{
  setupFetch(path=>path.includes('/parking-sessions?')?{items:[{...session,fee:null}],total:1,page:1,pageSize:20}:base(path));
  render(<ParkingPage user={user}/>);fireEvent.click(screen.getByRole('button',{name:'Tải lịch sử'}));
  const row=await screen.findByRole('row',{name:/51F12345 ACTIVE/});
  expect(within(row).getAllByRole('cell').at(-1)?.textContent).toBe('—');
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
 it('lets staff stop an uncertain observation, edit the plate, and explicitly confirm with a reason',async()=>{
  media();const onConfirm=vi.fn();setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:path.endsWith('/confirm')?{sourceEventId:'event',plateNumber:'51F99999'}:observation);
  render(<Camera mode="ENTRY" onConfirm={onConfirm} onInvalidate={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Mở camera'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Bắt đầu nhận dạng'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Bắt đầu nhận dạng'}));await waitFor(()=>expect((screen.getByLabelText('Biển số nhận dạng') as HTMLInputElement).value).toBe('51F12345'));
  expect(onConfirm).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Dừng nhận dạng'}));
  await waitFor(()=>expect((screen.getByLabelText('Biển số nhận dạng') as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Biển số nhận dạng'),{target:{value:'51F99999'}});
  const confirm=screen.getByRole('button',{name:'Xác nhận biển số'});expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do sửa biển số'),{target:{value:'Đối chiếu trực tiếp'}});fireEvent.click(confirm);
  await waitFor(()=>expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({plateNumber:'51F99999'})));
  const request=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/confirm'))!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({plateNumber:'51F99999',reason:'Đối chiếu trực tiếp'});
 });
 it('submits JPEG and waits for a frame response before sending another',async()=>{
  media();let finish:(value:any)=>void=()=>{};let frameRequests=0;let form:FormData|undefined;
  setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:observation);
  const f=vi.mocked(fetch),impl=f.getMockImplementation()!;
  f.mockImplementation(async(p,options)=>{
   if(String(p).endsWith('/frames')){frameRequests++;form=options?.body as FormData;return await new Promise(resolve=>{finish=resolve;});}return impl(p,options);
  });render(<Camera mode="ENTRY" onConfirm={()=>{}} onInvalidate={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Mở camera'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Bắt đầu nhận dạng'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Bắt đầu nhận dạng'}));await waitFor(()=>expect(frameRequests).toBe(1));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,600));});expect(frameRequests).toBe(1);
  expect(form?.get('sequence')).toBe('1');expect((form?.get('frame') as File).type).toBe('image/jpeg');
  await act(async()=>finish({ok:true,json:async()=>({...observation,state:'READY'})}));
  await screen.findByRole('button',{name:'Xác nhận biển số'});
 });
});

describe('admin forms',()=>{
 it('uses backend password length for user creation and password change',async()=>{
  setupFetch(path=>path.endsWith('/auth/me')?user:path.includes('/users?')?{items:[],total:0,page:1,pageSize:20}:base(path));
  const app=render(<App/>);await screen.findByText('Nhân viên: staff');
  expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).minLength).toBe(12);
  app.unmount();render(<AdminPage/>);
  expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).minLength).toBe(12);
 });
 it('keeps timezone-aware audit filters when moving to the next page',async()=>{
  setupFetch(path=>path.endsWith('/auth/csrf')?{csrfToken:'x'}:{items:[],total:21,page:1,pageSize:20});
  render(<AdminPage/>);const audit=screen.getByRole('button',{name:'Nhật ký kiểm toán'});
  await waitFor(()=>expect((audit as HTMLButtonElement).disabled).toBe(false));fireEvent.click(audit);
  const from=await screen.findByLabelText('Từ ngày (giờ máy này)');
  fireEvent.change(from,{target:{value:'2026-01-01T10:00'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Lọc nhật ký'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Lọc nhật ký'}));
  const expected=new Date('2026-01-01T10:00').toISOString();
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>new URL(String(p),'http://localhost').searchParams.get('dateFrom')===expected)).toBe(true));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Trang sau'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Trang sau'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p])=>{const q=new URL(String(p),'http://localhost').searchParams;return q.get('page')==='2' && q.get('dateFrom')===expected;})).toBe(true));
 });
});
