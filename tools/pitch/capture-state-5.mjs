/** Shared capture-state observations. No standalone browser, request or take. */
import {createHash} from 'node:crypto';

const check=(value,code)=>{if(!value)throw new Error(code);};
const pauseDefault=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function deadlineAdapters({bounded,pause=pauseDefault,now=()=>performance.now(),maximumMilliseconds=30_000}){
  check(typeof bounded==='function'&&Number.isFinite(maximumMilliseconds)&&maximumMilliseconds>0&&maximumMilliseconds<=30_000,'capture-observation-limit-invalid');
  const end=now()+maximumMilliseconds;
  function remaining(){const value=end-now();check(value>0,'capture-observation-deadline-exceeded');return value;}
  async function run(operation){const value=await bounded(operation,remaining());remaining();return value;}
  async function until(read,accept,code){
    for(;;){const value=await run(read);if(accept(value))return value;check(end-now()>0,code);await run(()=>pause(Math.min(50,remaining())));}
  }
  return{run,until,remaining};
}

async function runGeometry(page){
  return page.getByTestId('capacity-run').evaluate(element=>{
    const box=element.getBoundingClientRect(),style=getComputedStyle(element),topbar=document.querySelector('.topbar')?.getBoundingClientRect();
    return{x:box.x,y:box.y,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
      clearTop:Math.max(0,topbar?.bottom??0),visible:box.width>0&&box.height>0&&box.left>=0&&box.top>=Math.max(0,topbar?.bottom??0)&&box.right<=innerWidth&&box.bottom<=innerHeight&&style.visibility!=='hidden'&&style.display!=='none',
      enabled:!element.disabled&&element.getAttribute('aria-disabled')!=='true',label:element.getAttribute('aria-label'),
      state:document.querySelector('[data-testid="capacity-status"]')?.getAttribute('data-state')??null};
  });
}
const runReady=(geometry,expectedState)=>geometry.visible&&geometry.enabled&&geometry.label==='Run paired comparison'&&geometry.state===expectedState;

/** One real full-viewport PNG after current inputs and the Run framing settle.
 * Call only in raw preparation BEFORE a shot-start mark. The evidence callback
 * receives the original PNG once. It may retain two PNGs, never a frame sequence.
 * This operation forces a native screenshot; decoded recording frames still
 * determine whether the later idle/Run/result footage is suitable for release.
 */
export async function prepareRunPaint({page,shotId,expectedState,bounded,evidence,pause,now,maximumMilliseconds=30_000}){
  check(['S4','S7'].includes(shotId)&&['not_run','stale'].includes(expectedState)&&typeof evidence==='function','run-paint-contract-invalid');
  const limit=deadlineAdapters({bounded,pause,now,maximumMilliseconds});
  const button=page.getByTestId('capacity-run');
  await limit.run(()=>button.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})));
  const before=await limit.until(()=>runGeometry(page),geometry=>runReady(geometry,expectedState),'run-not-ready-before-paint');
  await limit.run(()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))));
  const png=await limit.run(()=>page.screenshot({type:'png',fullPage:false,animations:'disabled',timeout:Math.max(1,limit.remaining())}));
  check(Buffer.isBuffer(png)&&png.length>=33&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.subarray(12,16).toString('ascii')==='IHDR','run-paint-not-png');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),viewport=page.viewportSize();
  check(width===1536&&height===864&&viewport?.width===1536&&viewport?.height===864&&before.viewportWidth===1536&&before.viewportHeight===864,'run-paint-not-full-viewport');
  const geometry=await limit.run(()=>runGeometry(page));
  check(runReady(geometry,expectedState)&&['x','y','width','height'].every(key=>Math.abs(geometry[key]-before[key])<=.5),'run-ready-state-changed-during-paint');
  const pngSha256=createHash('sha256').update(png).digest('hex');
  await limit.run(()=>evidence({shotId,png,pngSha256,width,height,geometry}));
  return{shotId,pngSha256,width,height,geometry};
}

/** Metadata-only observations for a known modeled job; no text or URLs escape. */
export async function captureUiCounts(page,jobId='job-002'){
  return page.evaluate(jobId=>{
    const dialog=document.querySelector('dialog.capacity-job-drawer'),params=new URL(location.href).searchParams;
    const groups=[...document.querySelectorAll('[role="group"]')].filter(element=>element.getAttribute('aria-label')==='Replay fleet plan');
    const pressed=name=>groups[0]?[...groups[0].querySelectorAll('button')].find(element=>element.textContent?.trim()===name)?.getAttribute('aria-pressed')??null:null;
    return{dialogs:document.querySelectorAll('dialog.capacity-job-drawer').length,openDialogs:document.querySelectorAll('dialog.capacity-job-drawer[open]').length,
      jobLinks:document.querySelectorAll(`[data-testid="capacity-job-link-${jobId}"]`).length,
      statusCards:dialog?.querySelectorAll('[data-testid="capacity-unit-status"]').length??0,tabs:dialog?.querySelectorAll('[role="tab"]').length??0,
      summaryTabs:dialog?.querySelectorAll('[data-testid="capacity-job-tab-summary"]').length??0,
      summarySelected:dialog?.querySelector('[data-testid="capacity-job-tab-summary"]')?.getAttribute('aria-selected')??null,
      selectedJobMatches:params.get('jobSelected')===jobId,view:['baseline','candidate'].includes(params.get('view'))?params.get('view'):null,minute:params.has('t')?Number(params.get('t')):null,
      baselinePressed:pressed('Baseline'),candidatePressed:pressed('Candidate')};
  },jobId);
}

function expectedView(geometry,view,minute){
  return geometry.currentView===view&&geometry.currentMinute===minute&&geometry.baselinePressed===(view==='baseline'?'true':'false')&&geometry.candidatePressed===(view==='candidate'?'true':'false');
}

/** Stage one real job link against the committed replay URL, then click ONCE.
 * No fallback click, navigation, evaluation or timeout extension is allowed.
 * Native dialog and React job/cursor context must agree before returning.
 */
export async function openRecordedJob({page,jobId,view,minute,bounded,onStage=()=>{},pause,now,maximumMilliseconds=30_000}){
  check(/^job-[0-9]{3}$/.test(jobId)&&['baseline','candidate'].includes(view)&&Number.isFinite(minute),'job-open-contract-invalid');
  const limit=deadlineAdapters({bounded,pause,now,maximumMilliseconds});
  const link=page.getByTestId(`capacity-job-link-${jobId}`);
  onStage('link-frame');
  await limit.run(()=>link.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})));
  onStage('link-current-href');
  await limit.until(()=>link.evaluate((element,jobId)=>{
    const box=element.getBoundingClientRect(),topbar=document.querySelector('.topbar')?.getBoundingClientRect(),current=new URL(location.href),href=new URL(element.href,current);
    const group=[...document.querySelectorAll('[role="group"]')].find(item=>item.getAttribute('aria-label')==='Replay fleet plan');
    const pressed=name=>[...(group?.querySelectorAll('button')??[])].find(item=>item.textContent?.trim()===name)?.getAttribute('aria-pressed')??null;
    return{currentView:current.searchParams.get('view'),currentMinute:current.searchParams.has('t')?Number(current.searchParams.get('t')):null,
      currentSelected:current.searchParams.has('jobSelected'),baselinePressed:pressed('Baseline'),candidatePressed:pressed('Candidate'),
      visible:box.width>0&&box.height>0&&box.left>=0&&box.top>=Math.max(0,topbar?.bottom??0)&&box.right<=innerWidth&&box.bottom<=innerHeight,
      hrefScope:href.origin===current.origin&&href.pathname===current.pathname,
      hrefView:href.searchParams.get('view'),hrefMinute:href.searchParams.has('t')?Number(href.searchParams.get('t')):null,
      hrefJobMatches:href.searchParams.get('jobSelected')===jobId,hrefRunPresent:!!href.searchParams.get('jobRun'),
      correctLabel:element.getAttribute('aria-label')===`${jobId}: open modeled job details`};
  },jobId),geometry=>expectedView(geometry,view,minute)&&!geometry.currentSelected&&geometry.visible&&geometry.hrefScope&&geometry.hrefView===view&&geometry.hrefMinute===minute&&geometry.hrefJobMatches&&geometry.hrefRunPresent&&geometry.correctLabel,'job-link-not-current');
  onStage('link-click');await limit.run(()=>link.click({timeout:Math.max(1,limit.remaining())}));
  onStage('native-react-open');
  const opened=await limit.until(()=>page.evaluate(({jobId,view,minute})=>{
    const dialogs=[...document.querySelectorAll('dialog.capacity-job-drawer')],dialog=dialogs[0],params=new URL(location.href).searchParams;
    const card=dialog?.querySelector('[data-testid="capacity-unit-status"]'),context=dialog?.querySelector('.capacity-job-detail-context');
    return{dialogCount:dialogs.length,open:!!dialog?.open,rectangles:dialog?.getClientRects().length??0,
      titleMatches:dialog?.querySelector('.modal-heading h2')?.textContent?.trim()===`Modeled job ${jobId}`,
      selectedMatches:params.get('jobSelected')===jobId,viewMatches:params.get('view')===view,timeMatches:Number(params.get('t'))===minute,
      cards:dialog?.querySelectorAll('[data-testid="capacity-unit-status"]').length??0,
      contextMatches:!!context&&[...context.children].some(element=>element.textContent?.trim()===`${view} · cursor +${minute.toFixed(1)} min`),
      unitPhase:card?.querySelector('[data-testid="capacity-unit-phase"]')?.getAttribute('data-phase')??null,
      unitPayload:card?.querySelector('[data-testid="capacity-unit-payload"]')?.getAttribute('data-payload')??null,
      unitBusy:card?.querySelector('[data-testid="capacity-dispatch-lock"]')?.getAttribute('data-busy')??null};
  },{jobId,view,minute}),value=>value.dialogCount===1&&value.open&&value.rectangles>0&&value.titleMatches&&value.selectedMatches&&value.viewMatches&&value.timeMatches&&value.cards===1&&value.contextMatches,'job-native-react-open-not-committed');
  onStage('open-committed');return opened;
}

/** Preserve useful error classes without exposing a Playwright message, URL,
 * selector value, response, token or absolute filesystem path. */
export function safeCaptureError(error){
  const message=typeof error?.message==='string'?error.message:'';
  const methods=new Set(['locator.click','locator.setChecked','locator.evaluate','locator.evaluateAll','locator.waitFor','locator.innerText','locator.scrollIntoViewIfNeeded','locator.count','locator.inputValue','locator.getAttribute','page.screenshot','page.evaluate','page.waitForURL']);
  const method=message.match(/^([A-Za-z]+\.[A-Za-z]+):/)?.[1];
  const frames=[];for(const match of String(error?.stack??'').matchAll(/(?:^|[\\/])(take-driver(?:-[45])?\.mjs|capture-state(?:-5)?\.mjs):(\d+):(\d+)/gm))frames.push({file:match[1],line:Number(match[2]),column:Number(match[3])});
  return{code:/^[a-z][a-z0-9-]+$/.test(message)?message:'browser-action-or-timeout',
    errorName:['Error','TimeoutError','AssertionError','TypeError','ReferenceError','RangeError','DOMException','InvalidStateError'].includes(error?.name)?error.name:'UnknownError',
    method:methods.has(method)?method:'unknown',strictModeViolation:/strict mode violation/i.test(message),
    timedOut:error?.name==='TimeoutError'||/\btimeout\b[^\n]{0,50}\bexceeded\b/i.test(message),sourceFrames:frames.slice(0,8)};
}


const checkboxPaintCounts=new WeakMap();
/** A native checkbox action in raw preparation only. No click/force/retry or
 * checked-property assignment is used. The final form/request guard must still
 * verify the complete React-controlled roster before any live submission.
 */
export async function setRecordedCheckbox({page,label,checked,bounded,onStage=()=>{},evidence,maximumMilliseconds=30_000}){
  check(typeof label==='string'&&/^(Battery|Tyre|Breakdown|Collision) capability: Candidate unit-4$/.test(label)&&typeof checked==='boolean'&&(evidence===undefined||typeof evidence==='function'),'checkbox-contract-invalid');
  const limit=deadlineAdapters({bounded,maximumMilliseconds});
  const checkbox=page.getByRole('checkbox',{name:label,exact:true,includeHidden:true});
  const prefix=label.split(' ')[0].toLowerCase();
  const stage=name=>onStage(`checkbox-${prefix}-${name}`);
  stage('cardinality');check(await limit.run(()=>checkbox.count())===1,'checkbox-cardinality-not-one');
  const read=()=>checkbox.evaluate(element=>{
    const box=element.getBoundingClientRect(),style=getComputedStyle(element),topbar=document.querySelector('.topbar')?.getBoundingClientRect();
    let detailsOpen=true;for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement&&!parent.open)detailsOpen=false;
    return{native:element instanceof HTMLInputElement&&element.type==='checkbox',checked:element.checked,hitTarget:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===element,
      detailsOpen,enabled:!element.matches(':disabled')&&element.getAttribute('aria-disabled')!=='true',
      visible:box.width>0&&box.height>0&&box.left>=0&&box.top>=Math.max(0,topbar?.bottom??0)&&box.right<=innerWidth&&box.bottom<=innerHeight&&style.visibility!=='hidden'&&style.display!=='none',
      x:box.x,y:box.y,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight,clearTop:Math.max(0,topbar?.bottom??0)};
  });
  stage('preconditions');const initial=await limit.run(read);
  check(initial.native,'checkbox-not-native');check(initial.detailsOpen,'checkbox-details-closed');check(initial.enabled,'checkbox-disabled');
  stage('frame');await limit.run(()=>checkbox.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})));
  stage('ready');const before=await limit.until(read,value=>value.native&&value.detailsOpen&&value.enabled&&value.visible,'checkbox-not-ready');check(before.hitTarget,'checkbox-not-hit-target');
  stage('paint');await limit.run(()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))));
  check((checkboxPaintCounts.get(page)??0)<4,'checkbox-paint-budget-exceeded');
  const png=await limit.run(()=>page.screenshot({type:'png',fullPage:false,animations:'disabled',timeout:Math.max(1,limit.remaining())}));
  check(Buffer.isBuffer(png)&&png.length>=33&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.subarray(12,16).toString('ascii')==='IHDR','checkbox-paint-not-png');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),viewport=page.viewportSize();
  check(width===1536&&height===864&&viewport?.width===1536&&viewport?.height===864,'checkbox-paint-not-full-viewport');
  const geometry=await limit.run(read);check(geometry.native&&geometry.detailsOpen&&geometry.enabled&&geometry.visible&&geometry.hitTarget&&['x','y','width','height'].every(key=>Math.abs(geometry[key]-before[key])<=.5),'checkbox-ready-state-changed-during-paint');
  const pngSha256=createHash('sha256').update(png).digest('hex');checkboxPaintCounts.set(page,(checkboxPaintCounts.get(page)??0)+1);
  const record={label,requestedChecked:checked,beforeChecked:geometry.checked,pngSha256,width,height,geometry};
  if(evidence)await limit.run(()=>evidence({...record,png}));
  stage('setChecked');await limit.run(()=>checkbox.setChecked(checked,{timeout:Math.max(1,limit.remaining())}));
  stage('commit');await limit.run(()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))));
  const after=await limit.until(read,value=>value.native&&value.detailsOpen&&value.enabled&&value.checked===checked,'checkbox-checked-not-committed');
  stage('committed');return{...record,afterChecked:after.checked};
}
