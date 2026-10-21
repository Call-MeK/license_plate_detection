import { beforeEach, expect, it, vi } from 'vitest';
beforeEach(()=>vi.resetModules());
it('shares one in-memory csrf request across simultaneous mutations',async()=>{
 const requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{requests.push(path);return {ok:true,json:async()=>({csrfToken:'signed'})};}));
 const {post}=await import('./api');await Promise.all([post('/one',{}),post('/two',{})]);
 expect(requests.filter(path=>path.endsWith('/auth/csrf'))).toHaveLength(1);
 for(const [,options] of vi.mocked(fetch).mock.calls.filter(([p])=>!String(p).endsWith('/auth/csrf'))){expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe('signed');}
});
it('refreshes csrf after logout before a new login',async()=>{
 let tokens=0;vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,json:async()=>path.endsWith('/auth/csrf')?{csrfToken:String(++tokens)}:{ok:true}})));
 const {post}=await import('./api');await post('/auth/logout');await post('/auth/login',{username:'x',password:'123456789012'});
 expect(tokens).toBe(2);
});
it.each([[413,'FRAME_TOO_LARGE'],[422,'INVALID_FRAME'],[503,'AI_UNAVAILABLE']])('shows an actionable frame error for HTTP %s even without JSON',async(status,code)=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/auth/csrf')?{ok:true,json:async()=>({csrfToken:'x'})}:{ok:false,status,json:async()=>{throw new SyntaxError('not JSON');}}));
 const {api,ApiError}=await import('./api');
 const error=await api('/recognition/sessions/r/frames',{method:'POST',body:new FormData()}).catch(e=>e);
 expect(error).toBeInstanceOf(ApiError);
 if(!(error instanceof ApiError))throw error;
 expect(error.code).toBe(code);expect(error.message).toMatch(/thủ công|video/);
});
