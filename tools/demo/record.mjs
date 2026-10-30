/** Explicit demo production only; never invoked by ordinary acceptance CI.
 * Hosted runner, after dependency/browser provisioning:
 * STANDBY_DEMO_URL=https://... STANDBY_DEMO_RELEASE=<40-char SHA> \
 *   node tools/demo/record.mjs --out .runtime/demo/<release> --beat all
 * Re-render one independent beat with --beat history --replace.
 * No credentials, source rows, matrices or API result payloads are persisted.
 * These clips intentionally show public, publishable app pixels; final review
 * and provider-display rights remain the coordinator's publication gate.
 */
import {chromium, request as playwrightRequest} from 'playwright';
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {BEATS, FPS, VIEWPORT, storyboard} from './beats.mjs';

function argument(name, fallback) {const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];}
const base=process.env.STANDBY_DEMO_URL?.replace(/\/$/,'');
const releaseSha=process.env.STANDBY_DEMO_RELEASE;
const selected=argument('--beat','all');
const replace=process.argv.includes('--replace');
const check=(condition,code)=>{if(!condition)throw new Error(code);};
check(base&&new URL(base).protocol==='https:','demo-url-must-be-https');
check(releaseSha&&/^[a-f0-9]{40}$/.test(releaseSha),'exact-release-sha-required');
check(selected==='all'||BEATS.some(beat=>beat.id===selected),'unknown-beat');
const out=path.resolve(argument('--out',`.runtime/demo/${releaseSha}`));
const raw=path.join(out,'raw');
const exact=name=>({name,exact:true});
let step='preflight',browser,context,videoFile,completed=false;
await mkdir(raw,{recursive:true});
const api=await playwrightRequest.newContext({timeout:30_000,ignoreHTTPSErrors:false});

async function json(url) {const response=await api.get(url);check(response.status()===200,'demo-readiness-http-failure');return response.json();}
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
async function actions(page,id,anchor) {
  async function at(seconds,action) {await waitUntil(anchor+seconds*1000);check(performance.now()-anchor<(BEATS.find(beat=>beat.id===id).seconds-1)*1000,'demo-action-overran-beat');await action();}
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
    await at(5,()=>page.getByRole('button',exact('Spread')).click());
    await at(11,()=>page.getByRole('button',exact('Depot')).click());
    await at(17,()=>page.getByRole('combobox',exact('Road approach threshold')).selectOption('5'));
    await at(21,()=>evaluation(page));
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
    try {await stat(destination);check(replace,'existing-beat-requires-replace');}catch(error){if(error.code!=='ENOENT')throw error;}
    await assertRelease();
    context=await browser.newContext({viewport:VIEWPORT,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',recordVideo:{dir:raw,size:VIEWPORT}});
    const pageBornAt=performance.now(),page=await context.newPage();
    page.setDefaultTimeout(15_000);
    let pageError=false;page.on('pageerror',()=>{pageError=true;});
    const video=page.video();
    await setup(page,beat.id);
    await page.waitForTimeout(1000); // Stable real app pixels before the editing in-point.
    const anchor=performance.now(),trimStartSeconds=(anchor-pageBornAt)/1000;
    step=`${beat.id}:capture`;
    await actions(page,beat.id,anchor);
    await waitUntil(anchor+(beat.seconds+1)*1000); // Real-frame tail margin for media-clock offset.
    check(!pageError,'demo-page-runtime-error');
    check(await page.locator('.api-banner,.map-error').count()===0,'demo-visible-error-state');
    await assertRelease();
    await context.close();context=null;
    videoFile=await video.path();
    if(replace)await rm(destination,{force:true});
    await rename(videoFile,destination);videoFile=null;
    await writeFile(path.join(out,`${beat.id}.json`),JSON.stringify({schemaVersion:1,id:beat.id,releaseSha,datasetHash:manifest.dataset.hash,capturedAt:new Date().toISOString(),videoFile:`${beat.id}.webm`,trimStartSeconds,durationSeconds:beat.seconds,fps:FPS,viewport:VIEWPORT,narration:beat.narration,captions:beat.captions},null,2)+'\n');
    console.log(`PASS demo beat ${beat.id}; release ${releaseSha}`);
  }
  completed=true;
}catch(error) {
  const code=error instanceof Error&&/^[a-z][a-z-]+$/.test(error.message)?error.message:'demo-action-or-timeout';
  console.error(`FAIL ${step}: ${code}`);process.exitCode=1;
}finally {
  if(context)await context.close();
  if(videoFile&&!completed)await rm(videoFile,{force:true});
  if(browser)await browser.close();
  await api.dispose();
}
