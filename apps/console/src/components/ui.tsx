import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Check, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useStandby } from '../state';

export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'warning'|'danger'|'accent'}) {return <span className={`badge badge-${tone}`}>{children}</span>;}
export function PageHeading({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description:string;actions?:ReactNode}) {return <header className="page-heading"><div><div className="eyebrow">{eyebrow ?? 'Austin study area'}</div><h1>{title}</h1><p>{description}</p></div>{actions?<div className="heading-actions">{actions}</div>:null}</header>;}
export function Panel({title,kicker,action,children,className=''}:{title?:string;kicker?:string;action?:ReactNode;children:ReactNode;className?:string}){return <section className={`panel ${className}`}>{title?<div className="panel-heading"><div>{kicker?<div className="eyebrow">{kicker}</div>:null}<h2>{title}</h2></div>{action}</div>:null}{children}</section>;}
export function EmptyState({title,description,action}:{title:string;description:string;action?:ReactNode}) {return <div className="empty-state"><div className="empty-icon"><ArrowUpRight size={22}/></div><h2>{title}</h2><p>{description}</p>{action}</div>;}
export function ErrorState({error,retry}:{error:Error;retry:()=>void}) {return <div className="error-state" role="alert"><AlertCircle/><h2>{error instanceof ApiError && error.status===403?'Access restricted':'We could not load this view'}</h2><p>{error.message}</p>{error instanceof ApiError && error.requestId?<code>Request {error.requestId}</code>:null}<button className="button secondary" onClick={retry}><RefreshCw size={15}/>Try again</button></div>;}
// lint-ui-ignore unavailable-state -- Fixed skeleton placeholders are not API records; DataGate handles terminal data states.
export function LoadingState(){return <div role="status" aria-busy="true" aria-label="Loading page data" className="loading-state"><div className="skeleton skeleton-title"/><div className="kpi-grid">{[0,1,2,3].map(n=><div key={n} className="skeleton skeleton-card"/>)}</div><div className="skeleton skeleton-content"/><span className="sr-only">Loading real source data</span></div>;}
export function DataGate({children}:{children:ReactNode}){const{loading,error,zones,reload}=useStandby();if(loading)return <LoadingState/>;if(error)return <ErrorState error={error} retry={reload}/>;if(!zones.length)return <EmptyState title="No published zones in this snapshot" description="The source import did not contain eligible demand zones. Refresh the snapshot or inspect source quality." action={<button className="button secondary" onClick={reload}>Reload dataset</button>}/>;return children;}
export function Modal({open,onClose,title,children,className=''}:{open:boolean;onClose:()=>void;title:string;children:ReactNode;className?:string}){
 const ref=useRef<HTMLDialogElement>(null),label=useId();
 useEffect(()=>{const dialog=ref.current;if(open&&!dialog?.open)dialog?.showModal();if(!open&&dialog?.open)dialog.close();},[open]);
 function trapTab(event:KeyboardEvent<HTMLDialogElement>){
  if(event.key!=='Tab'||event.altKey||event.ctrlKey||event.metaKey)return;
  const dialog=event.currentTarget;
  const focusable=Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]')).filter(element=>element.tabIndex>=0&&!element.matches(':disabled')&&!element.closest('[inert]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden');
  event.preventDefault();
  if(!focusable.length){dialog.focus();return;}
  const current=focusable.indexOf(document.activeElement as HTMLElement);
  const next=current<0?(event.shiftKey?focusable.length-1:0):(current+(event.shiftKey?-1:1)+focusable.length)%focusable.length;
  focusable[next].focus();
 }
 return <dialog ref={ref} tabIndex={-1} className={`modal ${className}`} aria-labelledby={label} onKeyDown={trapTab} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget){const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose();}}}><div className="modal-heading"><h2 id={label}>{title}</h2><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={20} aria-hidden="true"/></button></div>{children}</dialog>;
}
function ToastMessage({id,message,kind,dismiss}:{id:string;message:string;kind:'success'|'error'|'info';dismiss:(id:string)=>void}){
 const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
 useEffect(()=>{if(kind==='error'||hovered||focused)return;const timer=setTimeout(()=>dismiss(id),6000);return()=>clearTimeout(timer);},[id,kind,hovered,focused,dismiss]);
 return <div className={`toast ${kind}`} role={kind==='error'?'alert':'status'} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>setFocused(event.currentTarget.contains(event.relatedTarget))}>{kind==='error'?<AlertCircle size={18}/>:<Check size={18}/>}<span>{message}</span><button aria-label="Dismiss notification" className="icon-button" onClick={()=>dismiss(id)}><X size={16} aria-hidden="true"/></button></div>;
}
export function Toasts(){const{toasts,dismissToast}=useStandby();return <div className="toast-stack" aria-live="polite" aria-atomic="false">{toasts.map(t=><ToastMessage key={t.id} {...t} dismiss={dismissToast}/>)}</div>;}
export function Busy({label='Computing'}:{label?:string}){return <span className="inline-flex items-center gap-2"><LoaderCircle className="spin" size={15} aria-hidden="true"/>{label}</span>;}
export function SourceNote(){const{manifest}=useStandby();return <div className="source-note"><span className="source-dot"/><span>Historical coverage uses a hypothetical placement fleet and modeled Car approach. Capacity analysis needs explicit workload and service assumptions.</span><a href={manifest?.dataset.source.url ?? 'https://data.austintexas.gov/d/dx9v-zd7x'} target="_blank" rel="noreferrer">Source & provenance <ArrowUpRight size={13}/></a></div>;}
