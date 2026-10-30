/** Explicit demo production only; never invoked by ordinary acceptance CI.
 * Hosted runner, after dependency/browser provisioning:
 * STANDBY_DEMO_URL=https://... STANDBY_DEMO_RELEASE=<40-char SHA> \
 *   node tools/demo/record.mjs --out .runtime/demo/<release> --beat all
 * Re-render one independent beat with --beat history --replace.
 * Resume all beats with --beat all --skip-existing; completed matching clips are
 * probed and kept. An incomplete existing destination needs explicit --replace.
 * No credentials, source rows, matrices or API result payloads are persisted.
 * These clips intentionally show public, publishable app pixels; final review
 * and provider-display rights remain the coordinator's publication gate.
 */
import {chromium, request as playwrightRequest} from 'playwright';
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {BEATS, FPS, VIEWPORT, storyboard} from './beats.mjs';
import {PresentedWindow,validateCompletedCapture,frameObservation} from './presented-window.mjs';

function argument(name, fallback) {const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];}
const base=process.env.STANDBY_DEMO_URL?.replace(/\/$/,'');
const releaseSha=process.env.STANDBY_DEMO_RELEASE;
const selected=argument('--beat','all');
const replace=process.argv.includes('--replace');
const skipExisting=process.argv.includes('--skip-existing');
const check=(condition,code)=>{if(!condition)throw new Error(code);};
check(base&&new URL(base).protocol==='https:','demo-url-must-be-https');
check(releaseSha&&/^[a-f0-9]{40}$/.test(releaseSha),'exact-release-sha-required');
check(selected==='all'||BEATS.some(beat=>beat.id===selected),'unknown-beat');
check(!skipExisting||selected==='all','skip-existing-requires-all-beats');
const out=path.resolve(argument('--out',`.runtime/demo/${releaseSha}`));
const raw=path.join(out,'raw');
const exact=name=>({name,exact:true});
let step='preflight',browser,context,activePage;
await mkdir(raw,{recursive:true});
const api=await playwrightRequest.newContext({timeout:30_000,ignoreHTTPSErrors:false});

async function json(url) {const response=await api.get(url);check(response.status()===200,'demo-readiness-http-failure');return response.json();}
function mediaSeconds(filename) {
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',filename],{encoding:'utf8',timeout:30_000}));
  return Number(probe.format?.duration);
}
async function assertRelease() {
  const config=await json(`${base}/config.json`);
  const endpoint=new URL(config.apiBase.replace(/\/$/,'')+'/',base+'/').href.replace(/\/$/,'');
  const [health,manifest]=await Promise.all([json(`${endpoint}/health`),json(`${endpoint}/public/manifest`)]);
  check(config.release===releaseSha&&health.release===releaseSha&&manifest.release===releaseSha,'deployed-release-disagrees');
  check(health.status==='ready'&&manifest.matrix&&Date.parse(manifest.matrix.expiresAt)>Date.now(),'demo-model-not-ready');
  return {config,manifest,endpoint};
}
async function visible(locator) {await locator.waitFor({state:'visible',timeout:25_000});}
async function route(page,pathname,heading) {const response=await page.goto(`${base}${pathname}`,{waitUntil:'domcontentloaded',timeout:45_000});check(response?.status()===200,'demo-document-not-200');await visible(page.getByRole('heading',exact(heading)));await page.locator('.skeleton').first().waitFor({state:'hidden'});check(await page.locator('.api-banner').count()===0,'demo-api-banner-visible');}
async function evaluation(page) {
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/public/evaluations')&&response.request().method()==='POST',{timeout:30_000});
  await page.getByRole('button',exact('Compare positions')).click();
  const response=await responsePromise;check(response.status()===200,'demo-evaluation-failed');
  await page.waitForFunction(()=>!document.querySelector('.stale-banner')&&!document.querySelector('.map-controls button:disabled'));
  check(await page.locator('.api-banner').count()===0,'demo-evaluation-banner-visible');
}
async function mapReady(page) {
  await route(page,'/map','Coverage map');
  await visible(page.locator('.site-marker').first());
  check(await page.locator('.map-error').count()===0,'demo-basemap-not-ready');
  await page.getByRole('combobox',exact('Hypothetical fleet size')).selectOption('3');
  await page.getByRole('combobox',exact('Road approach threshold')).selectOption('10');
  await page.getByRole('combobox',exact('Evaluation cohort')).selectOption('holdout');
  await visible(page.getByRole('button',exact('Compare positions')));
  await evaluation(page);
  await page.getByRole('button',exact('Depot')).click();
  await page.locator('.map-panel').scrollIntoViewIfNeeded();
}
async function setup(page,id) {
  if(id==='overview') {await route(page,'/overview','Every minute starts here.');await visible(page.locator('.comparison-row.proposal'));return;}
  if(id==='history') {await route(page,'/incidents','Incident history');await visible(page.locator('table.data-table tbody tr').first());return;}
  if(id==='provenance') {await route(page,'/settings','Settings');await page.getByRole('tab',exact('Data & model')).click();await visible(page.getByRole('heading',exact('Source provenance')));return;}
  await mapReady(page);
  if(id==='unavailable') await page.getByRole('button',exact('Proposal')).click();
}
const waitUntil=async when=>{const remaining=when-performance.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));};
async function bounded(promise,milliseconds,code){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),milliseconds);})]);}finally{clearTimeout(timer);}}
async function recordPresentedBeat(page,destination,beat) {
  // Playwright >=1.59 supports explicit recording after setup; fps is >=1.64.
  // https://playwright.dev/docs/api/class-screencast#screencast-start
  // No context-wide recordVideo and no inferred pre-roll trimming remain.
  const clock=new PresentedWindow(VIEWPORT);
  const diagnostics={schemaVersion:1,beatId:beat.id,durationSeconds:beat.seconds,startRequestedAtUnixMs:Date.now(),startRequestedAtPerformanceMs:performance.now(),firstFrames:[],lastFrames:[],actions:[]};
  let firstResolve,firstReject,frameError,firstObservedAtPerformance,endResolve,endRequiredAtUnixMs=Infinity;
  const firstFrame=new Promise((resolve,reject)=>{firstResolve=resolve;firstReject=reject;});
  const endFrame=new Promise(resolve=>{endResolve=resolve;});
  let failure,receipt;
  try {
    await page.screencast.start({path:destination,size:VIEWPORT,fps:FPS,onFrame:frame=>{
      const observation=frameObservation(frame,Date.now(),performance.now());
      if(diagnostics.firstFrames.length<2)diagnostics.firstFrames.push(observation);
      diagnostics.lastFrames.push(observation);if(diagnostics.lastFrames.length>2)diagnostics.lastFrames.shift();
      try {
        const initial=clock.first===null;clock.observe(frame);
        if(initial){firstObservedAtPerformance=observation.observedAtPerformanceMs;diagnostics.firstCallbackAtUnixMs=observation.observedAtUnixMs;diagnostics.firstCallbackAtPerformanceMs=firstObservedAtPerformance;firstResolve();}
        if(clock.hasPresentedAtOrAfter(endRequiredAtUnixMs))endResolve();
      }catch(error){frameError=error;firstReject(error);}
    }});
    diagnostics.startResolvedAtUnixMs=Date.now();diagnostics.startResolvedAtPerformanceMs=performance.now();
    await bounded(firstFrame,15_000,'first-presented-frame-timeout');
    diagnostics.actionsAnchorAtPerformanceMs=firstObservedAtPerformance;
    await actions(page,beat.id,firstObservedAtPerformance,diagnostics,clock);
    const actionsCompletedAtUnixMs=Date.now();
    diagnostics.actionsCompletedAtUnixMs=actionsCompletedAtUnixMs;
    diagnostics.actionsCompletedAfterFirstPresentationSeconds=(actionsCompletedAtUnixMs-clock.first)/1000;
    diagnostics.actionsCompletedAfterFirstCallbackSeconds=(performance.now()-firstObservedAtPerformance)/1000;
    check(actionsCompletedAtUnixMs<=clock.first+beat.seconds*1000,'demo-actions-overran-captured-window');
    await waitUntil(firstObservedAtPerformance+beat.seconds*1000);
    // Synchronize the ending against a NEW real browser presentation. Hovering
    // an inactive navigation link changes the real app's existing hover style;
    // no overlay, fabricated frame, DOM mutation or guessed tail is introduced.
    endRequiredAtUnixMs=Math.max(clock.first+beat.seconds*1000,Date.now());
    diagnostics.endingPresentationTargetAtUnixMs=endRequiredAtUnixMs;
    await page.mouse.move(0,0);
    await page.locator('aside.sidebar nav .nav-item:not(.active)').first().hover();
    if(!clock.hasPresentedAtOrAfter(endRequiredAtUnixMs))await bounded(endFrame,10_000,'ending-presented-frame-timeout');
    if(frameError)throw frameError;
    receipt=clock.receipt(beat.seconds,actionsCompletedAtUnixMs);
  }catch(error){failure=error;}
  finally{
    diagnostics.stopRequestedAtUnixMs=Date.now();diagnostics.stopRequestedAtPerformanceMs=performance.now();
    try{await page.screencast.stop();}catch(error){if(!failure)failure=error;}
    diagnostics.stopResolvedAtUnixMs=Date.now();diagnostics.stopResolvedAtPerformanceMs=performance.now();
    diagnostics.finalFrameClock={firstPresentedAtUnixMs:clock.first,lastPresentedAtUnixMs:clock.last,framesObserved:clock.frames,spanSeconds:clock.first===null||clock.last===null?null:(clock.last-clock.first)/1000};
  }
  if(failure){failure.captureDiagnostics=diagnostics;throw failure;}
  return {receipt,diagnostics};
}
async function actions(page,id,anchor,diagnostics,clock) {
  async function at(seconds,action) {
    await waitUntil(anchor+seconds*1000);
    const startedAtUnixMs=Date.now(),startedAtPerformanceMs=performance.now();
    const event={index:diagnostics.actions.length,scheduledSeconds:seconds,startedAtUnixMs,startedAtPerformanceMs,startedAfterFirstPresentationSeconds:(startedAtUnixMs-clock.first)/1000,startedAfterFirstCallbackSeconds:(startedAtPerformanceMs-anchor)/1000};
    diagnostics.actions.push(event);
    try{check(performance.now()-anchor<(BEATS.find(beat=>beat.id===id).seconds-1)*1000,'demo-action-overran-beat');await action();event.status='SUCCEEDED';}
    catch(error){event.status='FAILED';throw error;}
    finally{event.endedAtUnixMs=Date.now();event.endedAtPerformanceMs=performance.now();event.endedAfterFirstPresentationSeconds=(event.endedAtUnixMs-clock.first)/1000;event.endedAfterFirstCallbackSeconds=(event.endedAtPerformanceMs-anchor)/1000;}
  }
  if(id==='overview') {
    await at(5,()=>page.locator('.hour-chart button').nth(16).hover());
    await at(11,()=>page.locator('.comparison-chart').scrollIntoViewIfNeeded());
    await at(15,()=>page.getByRole('heading',exact('Know the limits')).scrollIntoViewIfNeeded());
  } else if(id==='history') {
    const first=page.locator('table.data-table tbody tr').first();
    const zoneId=await first.locator('.zone-cell small').textContent();
    await at(3,()=>page.getByRole('textbox',exact('Filter all demand zones')).fill(zoneId));
    await at(7,()=>page.locator('table.data-table tbody tr').first().click());
    const drawer=page.locator('dialog.detail-drawer[open]');
    await visible(drawer);
    await at(11,()=>drawer.getByRole('tab',exact('Provenance')).click());
    await at(19,()=>drawer.getByRole('tab',exact('Coverage')).click());
    await at(23,()=>page.keyboard.press('Escape'));
  } else if(id==='baseline') {
    await at(4,()=>page.getByRole('button',exact('Spread')).click());
    await at(8,()=>page.getByRole('button',exact('Depot')).click());
    await at(11,()=>page.getByRole('combobox',exact('Road approach threshold')).selectOption('5'));
    await at(14,()=>evaluation(page));
    // Restore the visibly demonstrated input before the edit to the next beat:
    // depot/proposal/unavailable all begin with 3 units, 10 minutes, held-out 2025.
    await at(19,()=>page.getByRole('combobox',exact('Road approach threshold')).selectOption('10'));
    await at(22,()=>evaluation(page));
  } else if(id==='proposal') {
    await at(4,()=>page.getByRole('button',exact('Proposal')).click());
    await at(12,()=>page.getByRole('combobox',exact('Map layer')).selectOption('difference'));
    await at(21,async()=>{const gap=page.locator('.gap-card').first();if(await gap.count())await gap.click();});
    await at(25,()=>page.locator('.map-panel').scrollIntoViewIfNeeded());
  } else if(id==='unavailable') {
    await at(5,()=>page.getByRole('button',{name:/^unit-1, available\./}).click());
    await at(10,()=>evaluation(page));
    await at(19,()=>page.getByRole('heading',exact('Priority uncovered zones')).scrollIntoViewIfNeeded());
  } else if(id==='provenance') {
    await at(6,()=>page.getByRole('heading',exact('Road-time model')).scrollIntoViewIfNeeded());
    await at(11,()=>page.getByRole('heading',exact('Import quality')).scrollIntoViewIfNeeded());
  }
}

try {
  const {manifest}=await assertRelease();
  const plan=storyboard(releaseSha);
  let prior;
  try {prior=JSON.parse(await readFile(path.join(out,'project.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  check(!prior||(prior.releaseSha===releaseSha&&prior.datasetHash===manifest.dataset.hash),'output-directory-belongs-to-different-release');
  await writeFile(path.join(out,'project.json'),JSON.stringify({...plan,baseUrl:base,datasetHash:manifest.dataset.hash,createdAt:prior?.createdAt??new Date().toISOString()},null,2)+'\n');
  await writeFile(path.join(out,'captions.json'),JSON.stringify({schemaVersion:1,releaseSha,durationSeconds:plan.durationSeconds,fps:FPS,cues:plan.cues},null,2)+'\n');
  await writeFile(path.join(out,'transcript.json'),JSON.stringify({schemaVersion:1,releaseSha,beats:plan.beats},null,2)+'\n');
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  for(const beat of BEATS.filter(beat=>selected==='all'||beat.id===selected)) {
    step=`${beat.id}:prepare`;
    const destination=path.join(out,`${beat.id}.webm`);
    let exists=false;
    try {await stat(destination);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(exists&&skipExisting) {
      try {
        const metadata=JSON.parse(await readFile(path.join(out,`${beat.id}.json`),'utf8'));
        validateCompletedCapture(metadata,{beat,releaseSha,datasetHash:manifest.dataset.hash,capturedSeconds:mediaSeconds(destination),viewport:VIEWPORT,fps:FPS});
        console.log(`SKIP verified existing demo beat ${beat.id}; release ${releaseSha}`);
        continue;
      }catch(error){if(!replace)throw error;}
    }
    check(!exists||replace,'existing-beat-requires-replace');
    await assertRelease();
    context=await browser.newContext({viewport:VIEWPORT,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
    const page=await context.newPage();activePage=page;
    page.setDefaultTimeout(15_000);
    let pageError=false;page.on('pageerror',()=>{pageError=true;});
    await setup(page,beat.id);
    step=`${beat.id}:capture`;
    const captured=path.join(raw,`${beat.id}-${Date.now()}.webm`);
    let captureClock,captureDiagnostics;
    try{const capture=await recordPresentedBeat(page,captured,beat);captureClock=capture.receipt;captureDiagnostics=capture.diagnostics;}
    catch(error){
      let sourceActualSeconds=null;try{const measured=mediaSeconds(captured);if(Number.isFinite(measured))sourceActualSeconds=measured;}catch{/* A failed recording still retains its bounded clock receipt. */}
      const failureCode=error instanceof Error&&/^[a-z][a-z-]+$/.test(error.message)?error.message:'demo-action-or-timeout';
      await writeFile(path.join(out,`${beat.id}.failure.json`),JSON.stringify({schemaVersion:1,beatId:beat.id,releaseSha,datasetHash:manifest.dataset.hash,failureCode,rawVideoFile:path.relative(out,captured).replace(/\\/g,'/'),sourceActualSeconds,diagnostics:error.captureDiagnostics??null},null,2)+'\n');
      throw error;
    }
    const capturedSeconds=mediaSeconds(captured);
    await writeFile(path.join(out,`${beat.id}.clock.json`),JSON.stringify({schemaVersion:1,beatId:beat.id,releaseSha,datasetHash:manifest.dataset.hash,sourceActualSeconds:capturedSeconds,diagnostics:captureDiagnostics},null,2)+'\n');
    check(Number.isFinite(capturedSeconds)&&capturedSeconds>=beat.seconds,'actual-screencast-media-too-short');
    check(!pageError,'demo-page-runtime-error');
    check(await page.locator('.api-banner,.map-error').count()===0,'demo-visible-error-state');
    await assertRelease();
    await context.close();context=null;activePage=null;
    if(replace)await rm(destination,{force:true});
    await rename(captured,destination);
    await writeFile(path.join(out,`${beat.id}.json`),JSON.stringify({schemaVersion:2,id:beat.id,releaseSha,datasetHash:manifest.dataset.hash,capturedAt:new Date().toISOString(),videoFile:`${beat.id}.webm`,trimStartSeconds:0,captureClock,capturedSeconds,durationSeconds:beat.seconds,fps:FPS,viewport:VIEWPORT,narration:beat.narration,captions:beat.captions},null,2)+'\n');
    console.log(`PASS demo beat ${beat.id}; release ${releaseSha}`);
  }
}catch(error) {
  const code=error instanceof Error&&/^[a-z][a-z-]+$/.test(error.message)?error.message:'demo-action-or-timeout';
  console.error(`FAIL ${step}: ${code}`);process.exitCode=1;
}finally {
  if(activePage)await activePage.screencast.stop().catch(()=>{});
  if(context)await context.close();
  if(browser)await browser.close();
  await api.dispose();
}
