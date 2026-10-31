#!/usr/bin/env node
/** One additional, explicitly bounded towing case. The existing three-run
 * Capacity preview budget and every original map/axe threshold stay intact. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {prepareCandidateUI} from '../../tests/browser/static-overlay.mjs';
import {analyzeMapRgb} from '../demo/map-render-proof.mjs';

const HELP=`Standby one-car towing UI proof (hosted CI only)
Usage: node tools/console-preview/towing.mjs [--out <directory>] [--help]
Requires the built STANDBY_UI_DIST, exact STANDBY_UI_SOURCE and service release.
Uses exactly one actual public Capacity evaluation, no operator identity,
workshop lookup, paid routing, generated vehicle trajectory or deployment.
Outputs bounded synthetic-run assertions and UI captures, never raw API data.
`;
if(process.argv.includes('--help')){console.log(HELP);process.exit(0);}
assert.equal(process.env.CI,'true');
const base='https://d34x1513u5u1qs.cloudfront.net',apiPath='/api/v1/public/capacity-evaluations';
const index=process.argv.indexOf('--out'),out=path.resolve(index<0?'.runtime/towing-preview':process.argv[index+1]);
await mkdir(out,{recursive:true});
const receipt={source:process.env.STANDBY_UI_SOURCE,startedAt:new Date().toISOString(),status:'running',
  scope:'Candidate static UI; actual public API and AWS basemap, unchanged CSP. Assumed towing scenario, not real dispatch or a deployment.',
  budget:{maximumSuccessfulEvaluations:1,paidRouteBuilds:0},calls:{evaluations:0},checks:[],shots:[]};
let step='initialization',browser,page,axeVersion;
const check=(value,code)=>{if(!value)throw new Error(code);};
const exact=name=>({name,exact:true});
async function shot(page,name,locator){
  const target=locator??page;
  await target.screenshot({path:path.join(out,name),animations:'disabled',...(locator?{}:{fullPage:false})});receipt.shots.push(name);
}
async function attribute(page,id,name,value){await page.locator(`[data-testid="${id}"][${name}="${value}"]`).waitFor();}
async function fill(page,name,value){await page.getByRole('spinbutton',exact(name)).fill(String(value));}
async function move(page,minute){
  await page.getByTestId('capacity-replay-time').fill(String(minute));
  await page.waitForFunction(value=>Number(new URL(location.href).searchParams.get('t'))===value,minute);
}
async function openJob(page,id){
  await page.getByTestId('capacity-jobs').getByRole('textbox',{name:/^Filter all generated modeled jobs/}).fill(id);
  await page.getByTestId('capacity-jobs').getByRole('link',exact(`${id}: open modeled job details`)).click();
  const drawer=page.getByRole('dialog',exact(`Modeled job ${id}`));await drawer.waitFor();return drawer;
}
async function readDrawerState(page){
  return page.evaluate(()=>{
    const dialog=document.querySelector('dialog.capacity-job-drawer');
    return dialog?{exists:true,open:dialog.open,rectangles:dialog.getClientRects().length,
      headingCleared:dialog.querySelector('.modal-heading h2')?.textContent?.trim()==='Modeled job',
      detailCards:dialog.querySelectorAll('[data-testid="capacity-unit-status"]').length}:{exists:false};
  });
}
function drawerStateClosed(value){return value.exists&&!value.open&&value.rectangles===0&&value.headingCleared&&value.detailCards===0;}
async function beforeDeadline(operation,deadline){
  const remaining=deadline-performance.now();check(remaining>0,'drawer-close-state-timeout');let timer;
  try{
    const value=await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('drawer-close-state-timeout')),remaining);})]);
    check(performance.now()<=deadline,'drawer-close-state-timeout');return value;
  }finally{clearTimeout(timer);}
}
async function closeJob(page,drawer){
  check(new URL(page.url()).searchParams.has('jobSelected'),'close-control-has-no-selection');
  check(await page.locator('dialog.capacity-job-drawer[open]').count()===1,'close-control-is-not-open');
  check(await page.locator('dialog.capacity-job-drawer').getByTestId('capacity-unit-status').count()===1,'close-control-has-no-detail');
  const initial=await beforeDeadline(()=>readDrawerState(page),performance.now()+25_000);check(!drawerStateClosed(initial),'close-control-already-satisfies-closed-gate');
  receipt.closeChecks??=[];const record={observer:'host-driven-read-only-dom',negativeControl:initial,samples:0};receipt.closeChecks.push(record);
  // Arm the history observer before Escape; URL teardown and native closure are
  // separate requirements. Preserve both checks and their original 25s bounds.
  step='close-url';await Promise.all([
    page.waitForURL(url=>!url.searchParams.has('jobSelected'),{waitUntil:'commit',timeout:25_000}),
    page.keyboard.press('Escape'),
  ]);
  // Read the identical native+React predicates from the runner clock, without
  // a long-lived in-page poller. Each read and the entire barrier stay bounded.
  step='close-hidden';const started=performance.now(),deadline=started+25_000;
  for(;;){
    const snapshot=await beforeDeadline(()=>readDrawerState(page),deadline);record.samples++;record.last=snapshot;
    if(drawerStateClosed(snapshot)){
      check(!await beforeDeadline(()=>drawer.isVisible(),deadline),'closed-drawer-remains-visible');
      record.elapsedMilliseconds=Math.round(performance.now()-started);return;
    }
    await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(0,deadline-performance.now()))));
  }
}
const mid=(start,end)=>{const value=Math.round((start+end)*5)/10;assert.ok(start<value&&value<end);return value;};
async function axe(page,label){
  if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({url:base+'/standby-towing-qa-axe.js'});
  let timer;
  const running=page.evaluate(async()=>{
    const scan=await window.axe.run(document);
    const summarize=items=>items.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.length}));
    return{version:scan.testEngine.version,passes:scan.passes.length,violations:summarize(scan.violations),incomplete:summarize(scan.incomplete)};
  });
  let result;
  try{result=await Promise.race([running,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('towing-axe-timeout')),20000);})]);}
  finally{clearTimeout(timer);}
  receipt.axe.scans.push({label,...result});
  check(result.version===axeVersion&&result.passes>0,'mandatory-towing-axe-instrument-failed');
  check(result.violations.length===0,'towing-axe-violation');
}

try{
  const require=createRequire(import.meta.url),axeFile=require.resolve('axe-core/axe.min.js');
  axeVersion=JSON.parse(await readFile(require.resolve('axe-core/package.json'),'utf8')).version;
  check(axeVersion==='4.11.0','unexpected-towing-axe-version');
  // Ephemeral QA-only self-origin asset, served by the existing bounded static overlay.
  // No inline script, CSP relaxation, application dependency or release asset is introduced.
  await copyFile(axeFile,path.join(path.resolve(process.env.STANDBY_UI_DIST),'standby-towing-qa-axe.js'));
  receipt.axe={required:true,version:axeVersion,sha256:createHash('sha256').update(await readFile(axeFile)).digest('hex'),scans:[]};
  const install=await prepareCandidateUI(base),{chromium}=await import('playwright');
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  page=await context.newPage();const overlay=await install(context,page);page.setDefaultTimeout(25_000);
  let posts=0;const errors=[];
  page.on('pageerror',()=>errors.push('page-error'));
  page.on('request',request=>{if(new URL(request.url()).pathname===apiPath&&request.method()==='POST')posts++;});
  step='configure-real-ui';
  const document=await page.goto(base+'/capacity?view=baseline',{waitUntil:'domcontentloaded'});
  check(document?.status()===200&&document.headers()['x-standby-qa-source']===receipt.source,'candidate-document-missing');
  await page.locator('main[data-ready="true"]').waitFor();
  await page.getByTestId('capacity-assumption-label').waitFor();
  const config=await context.request.get(base+'/config.json');check(config.status()===200,'config-not-ready');
  const settings=await config.json();await config.dispose();
  check(settings.release===process.env.STANDBY_EXPECTED_RELEASE,'service-release-mismatch');
  receipt.serviceRelease=settings.release;
  await fill(page,'Modeled incidents',2);await fill(page,'Replications',1);
  await page.getByText('Service & cycle assumptions',{exact:true}).click();
  await fill(page,'Recovery allowance (min)',10);
  for(const [label,value] of [['Battery',0],['Tyre',0],['Breakdown',0],['Collision',1]])await fill(page,`Type share (0-1): ${label}`,value);
  for(const label of ['Minimum','Most likely','Maximum'])await fill(page,`${label} onsite (min): Collision`,60);
  await fill(page,'Flatbed transport (min): Collision',60);await fill(page,'Flatbed dropoff (min): Collision',15);
  await page.getByText('Hourly arrival weights',{exact:false}).first().click();
  for(let at=0;at<8;at++)await fill(page,`Minute ${at*60}-${(at+1)*60}`,at===0?1:0);
  step='one-actual-towing-evaluation';
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname===apiPath&&response.request().method()==='POST');
  await page.getByTestId('capacity-run').click();const response=await pending;
  check(response.status()===200,'towing-evaluation-not-successful');const result=await response.json();
  receipt.calls.evaluations++;check(posts===1&&receipt.calls.evaluations===1,'towing-evaluation-budget-exceeded');
  await attribute(page,'capacity-status','data-state','success');
  check(result.modelVersion==='fixed-home-capacity-v1'&&result.input.jobCount===2&&result.replications===1,'towing-input-mismatch');
  check(result.input.arrivalWeights.every((value,at)=>value===(at===0?1:0)),'towing-arrivals-not-configured');
  const replay=result.baseline.replay,jobs=[...replay.jobs].sort((a,b)=>a.assignedAtMinutes-b.assignedAtMinutes);
  check(jobs.length===2&&jobs.every(job=>job.type==='collision'&&job.unitId),'two-tows-not-assigned');
  const [first,second]=jobs,unit=result.input.baseline.units.find(value=>value.id===first.unitId);
  check(unit?.kind==='flatbed'&&second.unitId===first.unitId,'towing-not-serialized-on-one-flatbed');
  check(second.assignedAtMinutes===first.availableAgainMinutes&&second.assignedAtMinutes>first.completedAtMinutes,'towing-reassigned-before-release');
  check(second.arrivalMinutes<first.completedAtMinutes&&second.queueMinutes>0,'towing-case-does-not-overlap');
  check(first.transportMinutes===60&&first.dropoffMinutes===15&&first.recoveryMinutes===10,'towing-allowances-mismatch');
  receipt.checks.push('Two overlapping collision jobs use one flatbed; second assignment waits through unloading and recovery');
  receipt.inputHash=result.inputHash;
  receipt.observed={unitId:unit.id,firstCompleted:first.completedAtMinutes,firstAvailableAgain:first.availableAgainMinutes,
    secondAssigned:second.assignedAtMinutes,secondWait:second.queueMinutes,source:'Actual API-computed synthetic scenario; not operational measurements'};
  await page.getByRole('group',exact('Replay fleet plan')).getByRole('button',exact('Baseline')).click();
  const onSiteEnd=first.arrivedAtMinutes+first.onSiteMinutes,transportEnd=onSiteEnd+first.transportMinutes;
  for(const [phase,start,end,payload] of [['transporting',onSiteEnd,transportEnd,'1'],['unloading',transportEnd,first.completedAtMinutes,'1'],['recovering',first.completedAtMinutes,first.availableAgainMinutes,'0']]){
    step=`cursor-${phase}`;await move(page,mid(start,end));step=`open-${phase}`;const drawer=await openJob(page,first.id);
    step=`assert-${phase}`;
    await attribute(page,'capacity-unit-phase','data-phase',phase);await attribute(page,'capacity-unit-payload','data-payload',payload);
    await attribute(page,'capacity-dispatch-lock','data-busy','true');
    check((await page.getByTestId('capacity-unit-active-job').innerText()).includes(first.id),'active-tow-context-wrong');
    await axe(page,`${phase}-1440-dark`);
    await shot(page,`towing-${phase}.png`,page.getByTestId('capacity-unit-status'));
    if(phase==='transporting'){
      const marker=page.getByTestId('capacity-unit-home-marker');await marker.waitFor();
      check((await marker.innerText()).includes(unit.id),'unit-id-not-on-map');
      await page.locator('.capacity-map-wrap[data-map-ready="true"]').waitFor();
      const region=page.getByTestId('capacity-job-map');await region.scrollIntoViewIfNeeded();
      const bounds=await marker.evaluate(element=>{const map=element.closest('.capacity-job-map'),a=element.getBoundingClientRect(),b=map?.getBoundingClientRect();return !!b&&a.width>0&&a.height>0&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;});
      check(bounds,'unit-home-label-clipped');
      const png=await region.screenshot({animations:'disabled'});
      const rgb=execFileSync('ffmpeg',['-v','error','-f','image2pipe','-i','pipe:0','-vf','crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,scale=96:64:flags=area,format=rgb24','-frames:v','1','-f','rawvideo','pipe:1'],{input:png,timeout:30000,maxBuffer:1048576,stdio:['pipe','pipe','pipe']});
      receipt.towingMap=analyzeMapRgb(rgb);await shot(page,'towing-unit-home-map.png',region);
      await page.setViewportSize({width:390,height:844});await page.getByTestId('capacity-unit-status').scrollIntoViewIfNeeded();
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile-towing-overflow');
      await axe(page,'transporting-390-dark');
      await shot(page,'towing-unit-status-390.png',page.getByTestId('capacity-unit-status'));await page.setViewportSize({width:1440,height:1000});
    }
    await closeJob(page,drawer);
  }
  step='later-job-does-not-reuse-selected-job-state';
  await move(page,mid(second.assignedAtMinutes,second.departAtMinutes));const drawer=await openJob(page,first.id);
  await attribute(page,'capacity-unit-phase','data-phase','preparing');await attribute(page,'capacity-dispatch-lock','data-busy','true');
  check((await page.getByTestId('capacity-unit-active-job').innerText()).includes(second.id),'old-job-hides-current-unit-assignment');
  await axe(page,'later-job-1440-dark');
  await shot(page,'towing-later-job-context.png',page.getByTestId('capacity-unit-status'));await closeJob(page,drawer);
  receipt.checks.push('Payload stays occupied during transport/unloading, clears at drop-off while recovery still blocks dispatch',
    'Selected old job cannot overwrite the later active unit assignment',
    'Actual AWS map has labeled assumed home and nonblank geographic pixels;390px unit card reflows');
  overlay.assertHealthy();check(posts===1&&errors.length===0,'unexpected-towing-request-or-runtime-error');
  await context.close();receipt.status='pass';console.log('PASS actual one-car towing cycle, queue, payload, later assignment and unit-home UI');
}catch(error){
  const code=error instanceof Error&&/^[a-z][a-z0-9-]+$/.test(error.message)?error.message:'browser-action-or-assertion';
  receipt.status='fail';receipt.failure={step,code};console.error(`FAIL towing:${step}: ${code}`);process.exitCode=1;
  receipt.failure.instrument={method:error instanceof Error?error.message.match(/^(?:locator|keyboard|page)\.[A-Za-z]+/)?.[0]??null:null,
    timedOut:error instanceof Error&&(/Timeout \d+ms exceeded/.test(error.message)||error.message==='drawer-close-state-timeout'),
    frames:error instanceof Error?[...error.stack?.matchAll(/towing\.mjs:\d+:\d+/g)??[]].slice(0,3).map(match=>match[0]):[]};
  if(page&&!page.isClosed()){
    receipt.failure.ui=await page.evaluate(()=>({cursor:new URL(location.href).searchParams.get('t'),
      selectedInUrl:new URL(location.href).searchParams.has('jobSelected'),
      nativeDrawer:(()=>{const element=document.querySelector('dialog.capacity-job-drawer');return element?{
        open:element.open,rectangles:element.getClientRects().length,display:getComputedStyle(element).display,
        visibility:getComputedStyle(element).visibility,
        reactSelectionCleared:element.querySelector('.modal-heading h2')?.textContent?.trim()==='Modeled job',
        detailCards:element.querySelectorAll('[data-testid="capacity-unit-status"]').length}:null;})(),
      phase:document.querySelector('[data-testid="capacity-unit-phase"]')?.getAttribute('data-phase')??null,
      payload:document.querySelector('[data-testid="capacity-unit-payload"]')?.getAttribute('data-payload')??null,
      openDialog:!!document.querySelector('dialog[open]')})).catch(()=>null);
    await shot(page,'failure.png').catch(()=>{});
  }
}finally{
  if(browser)await browser.close();receipt.finishedAt=new Date().toISOString();
  await writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n','utf8');
}
