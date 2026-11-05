import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, CircleCheck, X, type LucideIcon } from 'lucide-react';

const cx=(...names:(string|false|null|undefined)[])=>names.filter(Boolean).join(' ');
export { cx };

// ---- Sheet / dialog: chỉ mount khi mở; Esc hoặc bấm nền để đóng ----
function useOverlay(open:boolean,onClose:()=>void){
 const panel=useRef<HTMLDivElement>(null),close=useRef(onClose);
 close.current=onClose;
 useEffect(()=>{
  if(!open)return;
  const previous=document.activeElement as HTMLElement|null;
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();close.current();}};
  document.addEventListener('keydown',onKey);
  const first=panel.current?.querySelector<HTMLElement>('input:not([type=radio]):not([readonly]),textarea,select')||panel.current?.querySelector<HTMLElement>('button');
  first?.focus();
  return ()=>{document.removeEventListener('keydown',onKey);previous?.focus?.();};
 },[open]);
 return panel;
}
type OverlayProps={open:boolean;onClose:()=>void;title:ReactNode;children:ReactNode;footer?:ReactNode;head?:ReactNode};
export function Sheet({open,onClose,title,children,footer,head}:OverlayProps){
 const panel=useOverlay(open,onClose);
 if(!open)return null;
 return createPortal(<><div className="overlay open" onClick={onClose}/>
  <div ref={panel} className="sheet open" role="dialog" aria-modal="true" aria-label={typeof title==='string'?title:undefined}>
   <div className="sheet-head">{head||<h2 className="h-section">{title}</h2>}<button type="button" className="btn btn-icon btn-sm ml-auto" onClick={onClose} aria-label="Đóng"><X/></button></div>
   <div className="sheet-body">{children}</div>
   {footer?<div className="sheet-foot">{footer}</div>:null}
  </div></>,document.body);
}
export function Dialog({open,onClose,title,children,footer,description}:OverlayProps&{description?:ReactNode}){
 const panel=useOverlay(open,onClose);
 if(!open)return null;
 return createPortal(<><div className="overlay open" onClick={onClose}/>
  <div ref={panel} className="dialog open" role="dialog" aria-modal="true" aria-label={typeof title==='string'?title:undefined}>
   <div className="p-5 pb-0"><h2 className="h-section">{title}</h2>{description?<p className="t-meta">{description}</p>:null}</div>
   <div className="p-5 grid gap-4">{children}</div>
   {footer?<div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-subtle rounded-b-[14px]">{footer}</div>:null}
  </div></>,document.body);
}

// ---- Toast ----
type Toast={id:number;message:string};
const ToastContext=createContext<(message:string)=>void>(()=>{});
export const useToast=()=>useContext(ToastContext);
export function ToastProvider({children}:{children:ReactNode}){
 const [toasts,setToasts]=useState<Toast[]>([]),next=useRef(0);
 const show=useCallback((message:string)=>{
  const id=++next.current;setToasts(list=>[...list,{id,message}]);
  window.setTimeout(()=>setToasts(list=>list.filter(item=>item.id!==id)),3600);
 },[]);
 return <ToastContext.Provider value={show}>{children}
  <div className="toasts" aria-live="polite">{toasts.map(t=><div key={t.id} className="toast" role="status"><CircleCheck/><span>{t.message}</span></div>)}</div>
 </ToastContext.Provider>;
}

// ---- Segmented control với nền trượt ----
type SegOption<T extends string>={value:T;label:ReactNode;icon?:LucideIcon};
export function Seg<T extends string>({value,options,onChange,label,size,block,disabled}:{value:T|null;options:SegOption<T>[];onChange:(value:T)=>void;label:string;size?:'lg';block?:boolean;disabled?:boolean}){
 const root=useRef<HTMLDivElement>(null),thumb=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const place=()=>{
   const on=root.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
   if(on && thumb.current){thumb.current.style.width=`${on.offsetWidth}px`;thumb.current.style.transform=`translateX(${on.offsetLeft-3}px)`;}
  };
  place();addEventListener('resize',place);document.fonts?.ready.then(place);
  return ()=>removeEventListener('resize',place);
 },[value,options.length]);
 return <div ref={root} className={cx('seg',size,block && 'block')} role="group" aria-label={label}>
  <span ref={thumb} className="thumb" aria-hidden="true"/>
  {options.map(({value:v,label:text,icon:Icon})=><button type="button" key={v} aria-pressed={v===value} disabled={disabled} onClick={()=>onChange(v)}>{Icon?<Icon/>:null}{text}</button>)}
 </div>;
}

// ---- Switch ----
export function Switch({checked,onChange,label,disabled}:{checked:boolean;onChange:(value:boolean)=>void;label:string;disabled?:boolean}){
 return <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={()=>onChange(!checked)}/>;
}
export function SwitchRow({checked,onChange,title,hint,disabled}:{checked:boolean;onChange:(value:boolean)=>void;title:string;hint?:string;disabled?:boolean}){
 return <div className="switch-row" onClick={e=>{if(!disabled && !(e.target as HTMLElement).closest('.switch'))onChange(!checked);}}>
  <span><b className="font-medium block text-[14px]">{title}</b>{hint?<span className="t-meta">{hint}</span>:null}</span>
  <Switch checked={checked} onChange={onChange} label={title} disabled={disabled}/>
 </div>;
}

// ---- Nhỏ lẻ ----
type Tone='ok'|'warn'|'danger'|'primary';
export function Badge({tone,children,dot=true}:{tone?:Tone;children:ReactNode;dot?:boolean}){
 return <span className={cx('badge',tone && `badge-${tone}`)}>{dot?<span className="dot"/>:null}{children}</span>;
}
export function Plate({children,xl,className}:{children:ReactNode;xl?:boolean;className?:string}){
 return <span className={cx('plate',xl && 'plate-xl',className)}>{children}</span>;
}
export function Callout({tone,icon:Icon,children,role}:{tone?:'ok'|'warn'|'danger';icon:LucideIcon;children:ReactNode;role?:string}){
 return <div className={cx('callout',tone && `callout-${tone}`)} role={role}><Icon/><div className="grid gap-2 flex-1 min-w-0">{children}</div></div>;
}
export function Empty({icon:Icon,title,children}:{icon:LucideIcon;title:string;children?:ReactNode}){
 return <div className="py-14 px-6 grid justify-items-center text-center gap-2">
  <span className="grid place-items-center w-11 h-11 rounded-full bg-muted text-text-3 mb-1"><Icon className="ic-lg"/></span>
  <p className="h-section">{title}</p>{children}
 </div>;
}
export function Pager({page,total,pageSize=20,onPage,disabled,unit}:{page:number;total:number;pageSize?:number;onPage:(page:number)=>void;disabled?:boolean;unit:string}){
 if(total<=pageSize && page===1)return <div className="px-4 py-3 border-t border-border t-meta">{total} {unit}</div>;
 const from=(page-1)*pageSize+1,to=Math.min(page*pageSize,total);
 return <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border">
  <span className="t-meta tnum">{from}–{to} / {total} {unit}</span>
  <div className="flex gap-1">
   <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || page===1} onClick={()=>onPage(page-1)} aria-label="Trang trước"><ChevronLeft/>Trước</button>
   <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || page*pageSize>=total} onClick={()=>onPage(page+1)} aria-label="Trang sau">Sau<ChevronRight/></button>
  </div>
 </div>;
}
export function PageHead({title,description,children}:{title:string;description?:ReactNode;children?:ReactNode}){
 return <div className="flex flex-wrap items-end gap-3 mb-5">
  <div><h1 className="h-page">{title}</h1>{description?<p className="t-meta mt-0.5">{description}</p>:null}</div>
  {children?<div className="ml-auto flex items-center gap-2">{children}</div>:null}
 </div>;
}
export function ErrorText({error}:{error:string}){
 return error?<p className="callout callout-danger" role="alert">{error}</p>:null;
}

/** Nút có data-kbd="Enter|Space|F2" đang hiển thị sẽ được bấm khi nhấn phím đó (không áp dụng khi đang gõ hoặc có hộp thoại). */
export function useHotkeys(){
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{
   const name=e.key===' '?'Space':e.key;
   if(!['Enter','Space','F2'].includes(name) || e.repeat || e.metaKey || e.ctrlKey || e.altKey)return;
   if(document.querySelector('.sheet.open,.dialog.open'))return;
   const active=document.activeElement;
   if(active && /INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY/.test(active.tagName) && name!=='F2')return;
   const target=[...document.querySelectorAll<HTMLButtonElement>(`[data-kbd="${name}"]`)].find(el=>el.offsetParent && !el.disabled);
   if(target){e.preventDefault();target.click();}
  };
  document.addEventListener('keydown',onKey);
  return ()=>document.removeEventListener('keydown',onKey);
 },[]);
}
