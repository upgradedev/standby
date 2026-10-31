import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type PaginationState, type SortingState, type Updater } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Expand, MapPin, Minimize2, Search, X } from 'lucide-react';
import type { CapacityComparisonResult, CapacityJobType, CapacityReplayJob, CapacityUnit, CapacityUnservedReason } from '../../../../../packages/contracts/src/capacity';
import type { DemandZone, StandbySite } from '../../../../../packages/contracts/src/index';
import { jobPhase, JOB_PHASE_LABELS, type JobPhase } from '../../lib/capacityReplay';
import { capacityJobStages, capacityUnitPhase, type CapacityUnitSnapshot } from '../../lib/capacityUnitPhase';
import { integer, shortHash, timestamp } from '../../lib/format';
import { capacityRunKey } from '../../lib/capacity';
import { useStandby } from '../../state';
import { Badge, Busy, EmptyState, Modal } from '../ui';
import './capacity-jobs.css';

const CapacityJobMap=lazy(()=>import('./CapacityJobMap'));
const PAGE_SIZES=[10,25,50,100] as const;
const DEFAULT_PAGE_SIZE=25; // A complete modeled run has at most 200 jobs; page 25 keeps details easy to scan.
const JOB_TYPES:CapacityJobType[]=['battery','tyre','breakdown','collision'];
const SORT_FIELDS=['id','type','phase','unit','zone','arrival','queue','response'] as const;
const TABS=['Location','Summary','Timeline','Assumptions'] as const;
type DetailTab=typeof TABS[number];
type View='baseline'|'candidate';
interface Props {result:CapacityComparisonResult;view:View;minute:number}
interface MapSelection {zone:DemandZone;site:StandbySite|undefined;unit:CapacityUnit|undefined}
interface JobRow {job:CapacityReplayJob;phase:JobPhase;unitAtCursor:string|null;zoneName:string;queue:number|null;response:number|null}
const REASONS:Record<CapacityUnservedReason,string>={no_compatible_unit:'No compatible unit',no_route:'No route from a compatible home site',units_unavailable:'Compatible units are unavailable',no_shift_capacity:'No eligible shift capacity',horizon_queue:'Still queued at the planning horizon'};
const label=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
const duration=(value:number|null)=>value===null?'Not modeled':`${value.toFixed(1)} min`;
const phaseTone=(phase:JobPhase):'neutral'|'warning'|'danger'|'success'|'accent'=>phase==='unserved'?'danger':phase==='completed'?'success':phase==='queued'?'warning':phase==='not_arrived'?'neutral':'accent';
function queueAtCursor(job:CapacityReplayJob,phase:JobPhase,minute:number,horizon:number):number|null {
  if(job.assignedAtMinutes!==null&&job.assignedAtMinutes<=minute)return job.queueMinutes;
  if(phase==='queued'||(phase==='unserved'&&job.reason==='horizon_queue'))return Math.max(0,Math.min(minute,horizon)-job.arrivalMinutes);
  return null;
}
function queueLabel(row:JobRow):string {
  if(row.queue===null)return row.phase==='not_arrived'?'Not started':'Not queued';
  return `${duration(row.queue)}${row.phase==='queued'?' so far':row.phase==='unserved'&&row.job.reason==='horizon_queue'?' censored':''}`;
}

export function CapacityJobs({result,view,minute}:Props) {
  const {zones,manifest,preferences,scopeKey}=useStandby();
  const [params]=useSearchParams(),location=useLocation(),navigate=useNavigate();
  const listRef=useRef<HTMLElement>(null),opener=useRef<HTMLElement|null>(null),previousSelected=useRef<string|null>(null);
  const horizon=result.input.horizonMinutes,replay=result[view].replay,runKey=capacityRunKey(result);
  const detailScope=JSON.stringify([scopeKey,view,runKey,result.generatedAt,manifest?.dataset.hash??null]);
  const query=(params.get('jobQ')??'').slice(0,80);
  const type=JOB_TYPES.includes(params.get('jobType') as CapacityJobType)?params.get('jobType')!:'all';
  const phase=Object.hasOwn(JOB_PHASE_LABELS,params.get('jobPhase')??'')?params.get('jobPhase')!:'all';
  const rawSort=(params.get('jobSort')??'arrival.asc').split('.');
  const validSort=rawSort.length===2&&SORT_FIELDS.includes(rawSort[0] as typeof SORT_FIELDS[number])&&['asc','desc'].includes(rawSort[1]);
  const sortId=validSort?rawSort[0]:'arrival';
  const sortDesc=validSort&&rawSort[1]==='desc';
  const pageSize=PAGE_SIZES.includes(Number(params.get('jobSize')) as typeof PAGE_SIZES[number])?Number(params.get('jobSize')):DEFAULT_PAGE_SIZE;
  const rawPage=Number(params.get('jobPage')??1);
  const requestedPage=Number.isInteger(rawPage)&&rawPage>=1&&rawPage<=20?rawPage:1;
  const rawSelected=params.get('jobSelected'),selectedId=rawSelected&&/^job-[0-9]{3}$/.test(rawSelected)?rawSelected:null;
  const runMatches=params.get('jobRun')===runKey;
  const selected=runMatches?replay.jobs.find(job=>job.id===selectedId):undefined;
  const tab=TABS.includes(params.get('jobTab') as DetailTab)?params.get('jobTab') as DetailTab:'Location';
  const expanded=tab==='Location'&&params.get('jobMap')==='expanded';
  const zoneLookup=useMemo(()=>new Map((manifest?.dataset.hash===result.datasetHash?zones:[]).map(zone=>[zone.id,zone])),[zones,manifest?.dataset.hash,result.datasetHash]);
  const rows=useMemo<JobRow[]>(()=>replay.jobs.map(job=>{
    const current=jobPhase(job,minute,horizon);
    return {job,phase:current,unitAtCursor:job.assignedAtMinutes!==null&&job.assignedAtMinutes<=minute?job.unitId:null,
      zoneName:zoneLookup.get(job.zoneId)?.name??job.zoneId,queue:queueAtCursor(job,current,minute,horizon),
      response:job.arrivedAtMinutes!==null&&job.arrivedAtMinutes<=minute&&job.arrivedAtMinutes<=horizon?job.arrivedAtMinutes-job.arrivalMinutes:null};
  }),[replay.jobs,minute,horizon,zoneLookup]);
  const filtered=useMemo(()=>{const text=query.trim().toLowerCase();return rows.filter(row=>
    (type==='all'||row.job.type===type)&&(phase==='all'||row.phase===phase)&&
    (!text||`${row.job.id} ${row.job.type} ${row.job.zoneId} ${row.zoneName} ${row.unitAtCursor??''}`.toLowerCase().includes(text)));
  },[rows,type,phase,query]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
  const pagination:PaginationState={pageIndex:Math.min(requestedPage,pageCount)-1,pageSize};
  const sorting:SortingState=[{id:sortId,desc:sortDesc}];
  function target(values:Record<string,string|null>):string {
    const next=new URLSearchParams(params);
    for(const [key,value]of Object.entries(values)){if(value===null||value==='')next.delete(key);else next.set(key,value);}
    const search=next.toString();return `${location.pathname}${search?`?${search}`:''}${location.hash}`;
  }
  function update(values:Record<string,string|null>){void navigate(target(values),{replace:true,state:location.state});}
  function rowTarget(id:string){return target({jobSelected:id,jobRun:runKey,jobTab:null,jobMap:null});}
  const existingState=location.state&&typeof location.state==='object'&&!Array.isArray(location.state)?location.state:{};
  const drawerState={...existingState,capacityJobDrawer:{runKey,path:location.pathname}};
  function openRow(id:string,element:HTMLElement|null){opener.current=element;void navigate(rowTarget(id),{state:drawerState});}
  function closeDrawer(){
    if(!selectedId)return;
    const mark=(location.state as {capacityJobDrawer?:{runKey?:string;path?:string}}|null)?.capacityJobDrawer;
    if(mark?.runKey===runKey&&mark.path===location.pathname)void navigate(-1);
    else update({jobSelected:null,jobRun:null,jobTab:null,jobMap:null});
  }
  useEffect(()=>{
    const prior=previousSelected.current;previousSelected.current=selectedId;
    if(prior&&!selectedId){const frame=requestAnimationFrame(()=>{
      const candidate=opener.current?.isConnected?opener.current:document.getElementById(`capacity-job-link-${prior}`);
      (candidate??listRef.current)?.focus({preventScroll:true});opener.current=null;
    });return()=>cancelAnimationFrame(frame);}
  },[selectedId]);
  const columns=useMemo<ColumnDef<JobRow>[]>(()=>[
    {id:'id',header:'Modeled job',accessorFn:row=>row.job.id,cell:({row})=><Link id={`capacity-job-link-${row.original.job.id}`} data-testid={`capacity-job-link-${row.original.job.id}`} className="capacity-job-link" to={rowTarget(row.original.job.id)} state={drawerState} onClick={event=>{opener.current=event.currentTarget;}} aria-label={`${row.original.job.id}: open modeled job details`}>{row.original.job.id}</Link>},
    {id:'type',header:'Type',accessorFn:row=>row.job.type,cell:({row})=>label(row.original.job.type)},
    {id:'phase',header:'At cursor',accessorFn:row=>row.phase,cell:({row})=><Badge tone={phaseTone(row.original.phase)}>{JOB_PHASE_LABELS[row.original.phase]}</Badge>},
    {id:'unit',header:'Assigned unit',accessorFn:row=>row.unitAtCursor??'',cell:({row})=>row.original.unitAtCursor?<code>{row.original.unitAtCursor}</code>:<span className="muted">Unassigned</span>},
    {id:'zone',header:'Approximate zone',accessorFn:row=>row.zoneName},
    {id:'arrival',header:'Arrival (min)',accessorFn:row=>row.job.arrivalMinutes,cell:({row})=>duration(row.original.job.arrivalMinutes)},
    {id:'queue',header:'Queue wait',accessorFn:row=>row.queue??Number.POSITIVE_INFINITY,cell:({row})=>queueLabel(row.original)},
    {id:'response',header:'Response',accessorFn:row=>row.response??Number.POSITIVE_INFINITY,cell:({row})=>row.original.response===null?'Not reached':duration(row.original.response)},
  ],[params.toString(),location.pathname,location.hash,location.state,runKey]);
  const table=useReactTable({data:filtered,columns,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getPaginationRowModel:getPaginationRowModel(),state:{sorting,pagination},
    onSortingChange:(updater:Updater<SortingState>)=>{const next=typeof updater==='function'?updater(sorting):updater;update({jobSort:`${next[0]?.id??'arrival'}.${next[0]?.desc?'desc':'asc'}`,jobPage:null});},
    onPaginationChange:(updater:Updater<PaginationState>)=>{const next=typeof updater==='function'?updater(pagination):updater;update({jobPage:String(next.pageIndex+1),jobSize:String(next.pageSize)});},autoResetPageIndex:false});
  const hasFilters=!!query||type!=='all'||phase!=='all';
  const reset=()=>update({jobQ:null,jobType:null,jobPhase:null,jobPage:null});
  function convenienceOpen(event:MouseEvent<HTMLTableRowElement>,id:string){
    if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||window.getSelection()?.toString())return;
    if(event.target instanceof Element&&event.target.closest('a,button,input,select,textarea'))return;
    openRow(id,document.getElementById(`capacity-job-link-${id}`));
  }
  function changeTab(next:DetailTab){update({jobTab:next==='Location'?null:next,jobMap:null});}
  function tabKey(event:KeyboardEvent<HTMLButtonElement>,index:number){
    let next=index;
    if(event.key==='ArrowRight')next=(index+1)%TABS.length;else if(event.key==='ArrowLeft')next=(index+TABS.length-1)%TABS.length;
    else if(event.key==='Home')next=0;else if(event.key==='End')next=TABS.length-1;else return;
    event.preventDefault();changeTab(TABS[next]);document.getElementById(`capacity-job-tab-${TABS[next]}`)?.focus();
  }
  return <section className="capacity-jobs panel" ref={listRef} tabIndex={-1} aria-labelledby="capacity-jobs-title" data-testid="capacity-jobs">
    <header className="capacity-jobs-heading"><div><div className="eyebrow">First replication · {view}</div><h2 id="capacity-jobs-title">Modeled jobs</h2><p>Synthetic workload on actual Austin geography. These are not insured or operational incident records.</p><p className="capacity-job-run-stamp">Run <code>{shortHash(result.inputHash)}</code> · <time dateTime={result.generatedAt}>{timestamp(result.generatedAt,preferences.timezone)} · {preferences.timezone}</time></p></div><Badge tone="accent">Assumption-based</Badge></header>
    <div className="capacity-job-toolbar">
      <label className="capacity-job-search"><Search size={16}/><span className="sr-only">Filter all generated modeled jobs</span><input value={query} maxLength={80} aria-label="Filter all generated modeled jobs by ID, type, zone or assigned unit at cursor" placeholder="Filter modeled jobs…" onChange={event=>update({jobQ:event.target.value,jobPage:null})}/>{query?<button type="button" className="icon-button" aria-label="Clear modeled job search" onClick={()=>update({jobQ:null,jobPage:null})}><X size={16}/></button>:null}</label>
      <label>Type<select aria-label="Modeled job type filter" value={type} onChange={event=>update({jobType:event.target.value==='all'?null:event.target.value,jobPage:null})}><option value="all">All types</option>{JOB_TYPES.map(item=><option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>At cursor<select aria-label="Modeled job phase filter" value={phase} onChange={event=>update({jobPhase:event.target.value==='all'?null:event.target.value,jobPage:null})}><option value="all">All phases</option>{Object.entries(JOB_PHASE_LABELS).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>
      {hasFilters?<button type="button" className="button ghost" onClick={reset}>Reset filters</button>:null}
    </div>
    <p className="capacity-job-scope">{integer(filtered.length)} of {integer(rows.length)} generated jobs match · first replication only · cursor +{minute.toFixed(1)} min of {horizon} min. Search and sort cover the entire loaded run.</p>
    <div className="capacity-job-scroll" role="region" aria-label="Modeled jobs table" tabIndex={0}><table className="capacity-job-table"><caption className="sr-only">All generated jobs in the selected first replication; phases derived from simulator timestamps at the cursor.</caption>
      <thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=><th key={header.id} className={`capacity-job-col-${header.id}`} aria-sort={header.column.getIsSorted()==='asc'?'ascending':header.column.getIsSorted()==='desc'?'descending':'none'}><button type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header,header.getContext())}{header.column.getIsSorted()==='asc'?<ArrowUp aria-hidden="true" size={13}/>:header.column.getIsSorted()==='desc'?<ArrowDown aria-hidden="true" size={13}/>:<ArrowUpDown aria-hidden="true" size={12}/>}</button></th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row=><tr key={row.id} aria-current={selectedId===row.original.job.id?'true':undefined} onClick={event=>convenienceOpen(event,row.original.job.id)}>{row.getVisibleCells().map(cell=><td key={cell.id} className={`capacity-job-col-${cell.column.id}`}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody>
    </table></div>
    {!rows.length?<EmptyState title="This modeled workload has no jobs" description="The completed comparison used an incident count of zero. Increase the assumed workload and run another comparison to inspect generated jobs."/>:!filtered.length?<EmptyState title="No modeled jobs match these filters" description="Search covers every generated job in this run. Clear filters to see the complete first replication." action={<button type="button" className="button secondary" onClick={reset}>Reset filters</button>}/>:null}
    <footer className="capacity-job-pagination"><span>{filtered.length?`${pagination.pageIndex*pageSize+1}–${Math.min((pagination.pageIndex+1)*pageSize,filtered.length)} of ${integer(filtered.length)}`:'0'} matching jobs</span><div><label>Rows<select aria-label="Modeled jobs per page" value={pageSize} onChange={event=>update({jobSize:event.target.value,jobPage:null})}>{PAGE_SIZES.map(size=><option key={size} value={size}>{size}</option>)}</select></label><span>Page {pagination.pageIndex+1} of {pageCount}</span><button type="button" className="icon-button" aria-label="Previous modeled jobs page" disabled={!table.getCanPreviousPage()} onClick={()=>table.previousPage()}><ChevronLeft size={18}/></button><button type="button" className="icon-button" aria-label="Next modeled jobs page" disabled={!table.getCanNextPage()} onClick={()=>table.nextPage()}><ChevronRight size={18}/></button></div></footer>
    <Modal open={!!selectedId} onClose={closeDrawer} title={`Modeled job ${selectedId??''}`} className={`capacity-job-drawer ${expanded?'is-map-expanded':''}`}>
      {selected?<><div className="capacity-job-detail-context"><Badge tone="accent">Synthetic job · first replication</Badge><Badge tone={phaseTone(jobPhase(selected,minute,horizon))}>{JOB_PHASE_LABELS[jobPhase(selected,minute,horizon)]}</Badge><span>{view} · cursor +{minute.toFixed(1)} min</span></div>
      <div className="capacity-job-tabs" role="tablist" aria-label="Modeled job details">{TABS.map((item,index)=><button type="button" key={item} id={`capacity-job-tab-${item}`} data-testid={`capacity-job-tab-${item.toLowerCase()}`} role="tab" aria-selected={tab===item} aria-controls="capacity-job-detail-panel" tabIndex={tab===item?0:-1} onClick={()=>changeTab(item)} onKeyDown={event=>tabKey(event,index)}>{item}</button>)}</div>
      </>:selectedId?<div className="capacity-job-unavailable" role="alert"><h3>Modeled job unavailable</h3><p>{runMatches?'This job is not part of the selected result.':'This detail link does not match the current comparison. Select a job from the current list.'}</p><code>{runMatches?'JOB_NOT_FOUND':'RUN_MISMATCH'}</code></div>:null}
      <div id="capacity-job-detail-panel" className="capacity-job-detail-panel" role="tabpanel" aria-labelledby={`capacity-job-tab-${tab}`} tabIndex={0} hidden={!selected}>
        <JobDetail key={detailScope} result={result} job={selected} allowMapCache={rawSelected===null||!!selected} view={view} minute={minute} tab={tab} expanded={expanded} onExpand={()=>update({jobMap:expanded?null:'expanded'})}/>
      </div>
    </Modal>
  </section>;
}

function JobDetail({result,job,allowMapCache,view,minute,tab,expanded,onExpand}:{result:CapacityComparisonResult;job:CapacityReplayJob|undefined;allowMapCache:boolean;view:View;minute:number;tab:DetailTab;expanded:boolean;onExpand:()=>void}) {
  const {zones,manifest,preferences}=useStandby();
  const horizon=result.input.horizonMinutes,spatialMatch=manifest?.dataset.hash===result.datasetHash,zone=spatialMatch&&job?zones.find(item=>item.id===job.zoneId):undefined;
  const assigned=!!job&&job.assignedAtMinutes!==null&&job.assignedAtMinutes<=minute;
  const unitId=job?.unitId,unit=assigned?result.input[view].units.find(item=>item.id===unitId):undefined;
  const site=unit&&spatialMatch?manifest?.dataset.sites.find(item=>item.id===unit.siteId):undefined;
  const mapAllowed=allowMapCache&&spatialMatch&&(!job||!!zone);
  const currentMap=useMemo<MapSelection|null>(()=>job&&tab==='Location'&&zone?{zone,site,unit}:null,[job,tab,zone,site,unit]);
  // Retain geometry only, never an old job/card. The parent key bounds this one
  // resource to the exact result, policy, scope generation and geography.
  const [retainedMap,setRetainedMap]=useState<MapSelection|null>(null);
  useEffect(()=>{if(!mapAllowed)setRetainedMap(null);else if(currentMap)setRetainedMap(currentMap);},[mapAllowed,currentMap]);
  const mapSelection=mapAllowed?(currentMap??retainedMap):null;
  const mapSlot=<div hidden={!job||tab!=='Location'}>
    {job&&tab==='Location'?<div className="capacity-job-map-heading"><div><h3><MapPin size={17}/>Approximate modeled location</h3><p>The zone representative is not an exact incident or driver location.</p></div><button type="button" className="button secondary" onClick={onExpand} aria-label={expanded?'Exit expanded map':'Expand modeled job map'}>{expanded?<Minimize2 size={16}/>:<Expand size={16}/>}<span>{expanded?'Exit expanded map':'Expand map'}</span></button></div>:null}
    {mapSelection?<Suspense key="retained-map" fallback={<div className="capacity-map-wrap"><div className="capacity-map-message" role="status"><Busy label="Loading map view"/></div></div>}><CapacityJobMap zone={mapSelection.zone} site={mapSelection.site} unit={mapSelection.unit} expanded={!!job&&expanded}/></Suspense>:null}
  </div>;
  if(!job)return <>{mapSlot}</>;
  const jobs=result[view].replay.jobs,events=result[view].replay.events.filter(event=>event.jobId===job.id);
  const snapshot=capacityUnitPhase(job,unit,jobs,minute,horizon),activeJob=jobs.find(item=>item.id===snapshot.activeJobId);
  const stages=unit?capacityJobStages(job,unit.kind):null;
  const offset=(value:number|null)=>value===null?'Not modeled':`+${value.toFixed(1)} min${value>horizon?' · after horizon':value>minute?' · after cursor':''}`;
  const cycle=[['Queue before assignment',job.queueMinutes],['Preparation',job.prepMinutes],['Outbound Car approach',job.travelMinutes],[unit?.kind==='flatbed'?'On-site handling / loading allowance':'On-site service',job.onSiteMinutes],['Flatbed transport allowance',job.transportMinutes],['Flatbed drop-off / unloading allowance',job.dropoffMinutes],['Fixed-home recovery allowance',job.recoveryMinutes]] as const;
  const unitStatus=<UnitAtCursor unit={unit} snapshot={snapshot} activeJob={activeJob} assigned={assigned} offset={offset}/>;
  if(tab==='Location')return <>
    {mapSlot}
    {!zone?<div className="capacity-job-unavailable" role="alert"><h3>Location unavailable</h3><p>The selected result does not match the active geography, or its zone is unavailable. No coordinate is invented.</p><code>{spatialMatch?'ZONE_UNAVAILABLE':'DATASET_MISMATCH'}</code></div>:null}
    <div className="capacity-map-legend"><span><i className="capacity-map-zone-dot"/>Zone representative &amp; polygon</span>{site?<span><i className="capacity-map-site-dot"/>{unit?.id} · assumed home site</span>:<span>{assigned?'Assigned site metadata unavailable':'No assigned home site at cursor'}</span>}</div>
    {unitStatus}
    <dl className="capacity-job-definition"><dt>Approximate zone</dt><dd>{zone?.name??job.zoneId} · {job.zoneId}</dd><dt>Latitude / longitude</dt><dd>{zone?`${zone.position[1].toFixed(5)}, ${zone.position[0].toFixed(5)}`:'Not available'}</dd><dt>Assigned unit at cursor</dt><dd>{assigned?(job.unitId??'Not recorded'):'Unassigned at cursor'}</dd><dt>Home site</dt><dd>{site?`${site.name} · ${site.id} · Assumed`:assigned?'Site metadata unavailable':'Not assigned at cursor'}</dd><dt>Street / postal code</dt><dd>Not connected. The point is a geographic approximation.</dd></dl>
    <p className="capacity-job-notice">The unit label marks its assumed home, including while it is busy elsewhere in the replay. Actual vehicle GPS and workshop coordinates are not connected. No moving vehicle, return route or routed tow leg is shown.</p>
  </>;
  if(tab==='Summary')return <>
    {mapSlot}
    <div className="capacity-job-detail-cards"><div><span>Modeled type</span><strong>{label(job.type)}</strong></div><div><span>At selected cursor</span><strong>{JOB_PHASE_LABELS[jobPhase(job,minute,horizon)]}</strong></div><div><span>Assigned at cursor</span><strong>{assigned?(job.unitId??'Not recorded'):'Unassigned'}</strong></div></div>
    {unitStatus}
    <dl className="capacity-job-definition"><dt>Modeled arrival</dt><dd>{offset(job.arrivalMinutes)}</dd><dt>Modeled assignment</dt><dd>{offset(job.assignedAtMinutes)}</dd><dt>Modeled response arrival</dt><dd>{offset(job.arrivedAtMinutes)}</dd><dt>Modeled job clearance</dt><dd>{offset(job.completedAtMinutes)}</dd><dt>Unit available again</dt><dd>{offset(job.availableAgainMinutes)}</dd><dt>Horizon outcome</dt><dd>{job.status==='in_progress'?'In progress at horizon':label(job.status)}{job.reason?` · ${REASONS[job.reason]}`:''}</dd><dt>Target outcome at horizon</dt><dd>{result.input.responseTargetMinutes} min · Assumed{job.onTime===null?' · not reached by horizon':job.onTime?' · reached within target':' · reached late'}</dd></dl>
    <p className="capacity-job-notice">Insured/driver data is not connected. No operational incident start/end records are connected; these offsets belong to a simulated job.</p>
    {unit?.kind==='flatbed'?<p className="capacity-job-notice">One vehicle per flatbed is assumed. The dispatch slot stays reserved through loading, transport, unloading and recovery. Completing drop-off clears the modeled vehicle payload; the unit becomes available only after the fixed-home recovery allowance.</p>:null}
  </>;
  if(tab==='Timeline')return <>
    {mapSlot}
    {unitStatus}
    <h3 className="capacity-cycle-heading">Selected job · recorded unit cycle</h3>
    <p className="capacity-job-muted">Recorded elapsed-time segments for this job. Loading uses the on-site allowance; no separate loading-complete measurement or chosen garage is recorded.</p>
    {stages?.length?<ol className="capacity-job-cycle" aria-label="Selected job unit occupancy cycle" data-testid="capacity-job-cycle">{stages.map(stage=>{
      const current=stage.startMinutes<=minute&&minute<stage.endMinutes;
      const payload=unit?.kind!=='flatbed'?null:stage.phase==='handling_loading'?'Loading · up to 1 vehicle':stage.payloadCount===null?null:`${stage.payloadCount} of 1 vehicle`;
      return <li key={stage.phase} className={current?'is-current':''} data-phase={stage.phase}>
        <strong>{stage.label}</strong><span>{offset(stage.startMinutes)} → {offset(stage.endMinutes)}</span>
        <small>{current?'At cursor':minute>=stage.endMinutes?'Completed interval':'After cursor'}{payload?` · ${payload}`:''}</small>
      </li>;
    })}</ol>:<p className="capacity-job-muted">{!assigned?job.assignedAtMinutes===null?'No unit assignment was recorded for this job, so no unit cycle is available.':'No unit is assigned at this cursor. Move the replay to the recorded assignment to inspect its unit cycle.':stages===null?'Unit cycle timings could not be verified for this result.':'The recorded cycle has zero-duration intervals. Completion and release can share a timestamp; no positive-duration occupancy segment is shown.'}</p>}
    <h3>Simulator events · minutes since scenario start</h3><p className="capacity-job-muted">Events are emitted by the model. Accepted jobs may continue after the planning horizon; those entries are marked below.</p>
    <ol className="capacity-job-events">{events.map(event=><li key={event.sequence} className={event.atMinutes>horizon?'is-post-horizon':''}><span className="capacity-event-time">{offset(event.atMinutes)}</span><div><strong>{event.type.replace(/_/g,' ')}</strong>{event.unitId?<span>{event.unitId}</span>:null}{event.reason?<small>{event.reason.replace(/_/g,' ')}</small>:null}</div></li>)}</ol>
    <h3>Modeled occupancy components</h3><dl className="capacity-job-definition">{cycle.map(([name,value])=><div className="capacity-definition-row" key={name}><dt>{name}</dt><dd>{duration(value)}</dd></div>)}</dl>
    <p className="capacity-job-notice">Transport and drop-off are editable time allowances, without a chosen real workshop, garage queue or routed transfer. Payload is released at the end of drop-off; recovery still keeps the unit reserved until its available-again time. Fixed-home recovery is assumed, not a calculated return journey.</p>
  </>;
  const profile=result.input.typeProfiles[job.type];
  return <>
    {mapSlot}
    <h3>Assumptions frozen in this comparison</h3><dl className="capacity-job-definition"><dt>Type share</dt><dd>{(profile.share*100).toFixed(1)}% · Assumed</dd><dt>On-site triangular duration</dt><dd>{profile.onSiteMinutes.min} / {profile.onSiteMinutes.mode} / {profile.onSiteMinutes.max} min · min / mode / max · Assumed</dd><dt>Transport / drop-off</dt><dd>{profile.flatbedTransportMinutes} / {profile.flatbedDropoffMinutes} min · flatbeds only · Assumed</dd><dt>Travel sensitivity</dt><dd>{result.input.travelMultiplier}× · Car profile for every unit kind</dd><dt>Generated</dt><dd><time dateTime={result.generatedAt}>{timestamp(result.generatedAt,preferences.timezone)} · {preferences.timezone}</time></dd><dt>Input / model</dt><dd><code>{shortHash(result.inputHash)} / {result.modelVersion}</code></dd><dt>Dataset / matrix</dt><dd><code>{shortHash(result.datasetHash)} / {shortHash(result.matrix.hash)}</code></dd><dt>Routing snapshot expires</dt><dd>{timestamp(result.matrix.expiresAt,preferences.timezone)} · {preferences.timezone}</dd></dl>
    <details className="capacity-job-assumptions"><summary>Read all model limitations</summary><ul>{result.assumptions.map(item=><li key={item}>{item}</li>)}</ul></details>
    <p className="capacity-job-notice">Actual Austin geography and prepared Car road times support this scenario. Arrival time, type, roster and service duration are modeled assumptions, not measured service performance.</p>
  </>;
}

function UnitAtCursor({unit,snapshot,activeJob,assigned,offset}:{unit:CapacityUnit|undefined;snapshot:CapacityUnitSnapshot;activeJob:CapacityReplayJob|undefined;assigned:boolean;offset:(value:number|null)=>string}) {
  const payload=unit?.kind!=='flatbed'?'N/A · no towing payload modeled':snapshot.phase==='handling_loading'?'Loading · up to 1 vehicle':snapshot.payloadCount===null?'Unknown · one-vehicle limit':`${snapshot.payloadCount} of 1 vehicle · ${snapshot.payloadCount?'occupied':'empty'}`;
  const dispatch=snapshot.busy===true?`Busy · reserved through ${offset(activeJob?.availableAgainMinutes??null)}`:snapshot.phase==='available'?'Available at assumed home':snapshot.label;
  return <section className="capacity-unit-status" aria-label="Modeled assigned unit at cursor" data-testid="capacity-unit-status">
    <div className="capacity-unit-status-heading"><h3>Unit at selected cursor</h3><strong>{unit?`${unit.id} · ${label(unit.kind.replace(/_/g,' '))}`:assigned?'Unit specification unavailable':'Unassigned at cursor'}</strong><span>Scenario replay · not live telemetry</span></div>
    <dl>
      <div><dt>Unit phase</dt><dd data-testid="capacity-unit-phase" data-phase={snapshot.phase}>{snapshot.label}</dd></div>
      <div><dt>Physical payload · assumed</dt><dd data-testid="capacity-unit-payload" data-payload={snapshot.payloadCount??'unknown'}>{unit?payload:'Not determined'}</dd></div>
      <div><dt>Dispatch availability</dt><dd data-testid="capacity-dispatch-lock" data-busy={snapshot.busy??'unknown'}>{dispatch}</dd></div>
      <div><dt>Active modeled job</dt><dd data-testid="capacity-unit-active-job">{snapshot.activeJobId??(snapshot.busy===null?'Not determined':'None at cursor')}</dd></div>
      <div><dt>Actual vehicle GPS</dt><dd>Unknown · not connected</dd></div>
      <div><dt>Workshop destination</dt><dd>Unknown · not connected</dd></div>
    </dl>
    {snapshot.activeJobId&&!snapshot.servingSelectedJob?<p className="capacity-unit-other-job">This unit is now serving {snapshot.activeJobId}. Its phase, payload and reservation above describe that job. The selected older job's cycle and clearance times remain separate.</p>:null}
    {unit?.kind==='flatbed'?<p>One active job reserves this flatbed's dispatch slot. The physical loading instant is unknown within the on-site allowance; transport and unloading hold one vehicle. Recovery has zero payload and keeps the unit reserved for its configured allowance.</p>:!unit?<p>{assigned?'The assigned unit specification is unavailable; no unit position or capacity is invented.':'The selected job has no assigned unit at this cursor. No future assignment is shown as a current vehicle.'}</p>:null}
  </section>;
}
