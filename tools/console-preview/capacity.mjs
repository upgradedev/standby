#!/usr/bin/env node
/** Hosted CI only: locally built static UI at its approved public origin.
 * Documents/assets alone are overlaid. Config, API and AWS map traffic stay live
 * with natural browser headers and the live document's unmodified CSP. No deploy,
 * operator identity, routing build, provider-key logging or raw response artifact.
 */
import assert from 'node:assert/strict';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {validateMapGeometry, analyzeMapRgb} from '../demo/map-render-proof.mjs';

const HELP = `Standby functional Capacity lab review (hosted CI only)
Usage: node tools/console-preview/capacity.mjs [options]
  --dist <dir>    Built console (default apps/console/dist)
  --out <dir>     Pixels/receipt (default .runtime/capacity-preview)
  --source <sha>  Exact UI commit SHA (or GITHUB_SHA)
  --help         Print help without network or browser work
Fixed origin: https://d34x1513u5u1qs.cloudfront.net/capacity
New static build overlay + actual live API/AWS map; this is NOT a deployment.
Preserves live document CSP. Public response bodies/config stay in memory.
Runs three successful capacity evaluations (identical, candidate +1, zero jobs),
one actual schema-rejection request, and one deliberately aborted UI request.
Playwright/ffmpeg must already be installed by hosted CI; no local installation.
`;
if (process.argv.includes('--help')) {console.log(HELP); process.exit(0);}
const arg = (name, fallback) => {const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1];};
const source = arg('--source', process.env.GITHUB_SHA);
assert.match(source ?? '', /^[a-f0-9]{40}$/, 'An exact UI commit SHA is required.');
assert.equal(process.env.CI, 'true', 'Run browser/API verification in hosted CI only.');
const dist = path.resolve(arg('--dist', 'apps/console/dist'));
const out = path.resolve(arg('--out', '.runtime/capacity-preview'));
const origin = 'https://d34x1513u5u1qs.cloudfront.net';
const capacityPath = '/api/v1/public/capacity-evaluations';
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const receipt = {source, origin, startedAt: new Date().toISOString(), status: 'running',
  scope: 'CI new-static-build overlay with the actual live public Capacity API and AWS basemap; NOT a deployment.',
  exclusions: ['No operator authentication or protected writes', 'No route construction or dispatch', 'No raw responses, request bodies or map keys retained'],
  calls: {successfulCapacityEvaluations: 0, rejectedCapacityRequests: 0, deliberatelyAbortedRequests: 0}, checks: [], screenshots: []};
await mkdir(out, {recursive: true});
let browser, page, failure, securityHeaders, csp, config, manifest;

async function publicRead(pathname) {
  const response = await fetch(`${origin}${pathname}`, {redirect: 'error', signal: AbortSignal.timeout(15000)});
  assert.equal(response.status, 200, `Live readiness ${pathname} must return HTTP200.`);
  return response;
}
async function boundedJson(response) {
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) <= 5_000_000, 'Public JSON exceeds the review response bound.');
  return JSON.parse(body);
}
async function staticFiles(directory = dist, prefix = '') {
  const files = new Map();
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [key, value] of await staticFiles(path.join(directory, entry.name), relative)) files.set(key, value);
    else if (entry.isFile()) files.set(relative, path.join(directory, entry.name));
  }
  return files;
}
async function overlay(context, assets) {
  const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.json':'application/json'};
  await context.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    // Neither API/config traffic nor any provider request is proxied or rewritten.
    if (url.origin !== origin || url.pathname === '/config.json' || url.pathname.startsWith('/api/') || request.method() !== 'GET') return route.continue();
    const document = request.isNavigationRequest() && url.pathname === '/capacity';
    const filename = document ? assets.get('/index.html') : assets.get(url.pathname);
    if (!filename || (!document && request.resourceType() === 'document')) return route.continue();
    return route.fulfill({status: 200, headers: {...securityHeaders,
      'content-type': mime[path.extname(filename)] ?? 'application/octet-stream', 'cache-control':'no-store'}, body: await readFile(filename)});
  });
}
function telemetry(target) {
  const errors = [], provider = {successfulResponses: 0, hosts: new Set(), canceledRequests: 0};
  let capacityPosts = 0;
  target.on('pageerror', () => errors.push({kind:'uncaught-page-error'}));
  target.on('console', message => {if (message.type() === 'error') errors.push({kind:'console-error'});});
  target.on('request', request => {if (new URL(request.url()).pathname === capacityPath && request.method() === 'POST') capacityPosts++;});
  target.on('requestfailed', request => {
    // Never persist a URL: provider query strings contain the public restricted key.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') {provider.canceledRequests++;return;}
    errors.push({kind:'failed-request', resource:request.resourceType()});
  });
  target.on('response', response => {
    const url = new URL(response.url());
    if (response.status() >= 400) errors.push({kind:'http-error', status:response.status(), source:url.origin === origin ? 'owned-app' : 'provider'});
    if (url.hostname.endsWith('.amazonaws.com') && response.status() >= 200 && response.status() < 300) {
      provider.successfulResponses++; provider.hosts.add(url.hostname);
    }
  });
  return {errors, provider, capacityPosts:() => capacityPosts};
}
async function ready(target) {
  target.setDefaultTimeout(20000);
  const response = await target.goto(`${origin}/capacity?theme=dark`, {waitUntil:'domcontentloaded'});
  assert.equal(response.status(), 200, 'New static Capacity document must load.');
  assert.equal(await response.headerValue('content-security-policy'), csp, 'The overlay must preserve the actual live document CSP verbatim.');
  await target.locator('main#main[data-ready="true"]').waitFor();
  await target.getByTestId('capacity-form').waitFor();
  await target.getByTestId('capacity-run').waitFor({state:'visible'});
  assert.equal(await target.getByTestId('capacity-status').getAttribute('data-state'), 'not_run');
  assert.equal(await target.getByTestId('capacity-results').count(), 0, 'No modeled results may appear before an actual evaluation.');
  assert.equal(await target.locator('.api-banner').count(), 0, 'Normal readiness cannot contain an API outage banner.');
}
async function noOverflow(target, width) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No document overflow is allowed at ${width}px.`);
}
async function shot(name, target = page, options = {}) {
  await target.screenshot({path:path.join(out, name), fullPage:true, animations:'disabled', ...options});
  receipt.screenshots.push(name);
}
async function evaluate(target) {
  const pending = target.waitForResponse(response => new URL(response.url()).pathname === capacityPath && response.request().method() === 'POST', {timeout:30000});
  await target.getByTestId('capacity-run').click();
  const response = await pending;
  assert.equal(response.status(), 200, 'A normal Capacity evaluation must use the actual successful API.');
  const result = await boundedJson(response);
  assert.equal(result.modelVersion, 'fixed-home-capacity-v1');
  assert.equal(result.datasetHash, manifest.dataset.hash, 'Actual capacity result must match the active geography.');
  assert.equal(result.matrix.hash, manifest.matrix.hash, 'Actual capacity result must match the active road snapshot.');
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
  assert.match(result.pairedSamplesHash, /^[a-f0-9]{64}$/);
  await target.getByTestId('capacity-results').waitFor();
  await target.getByTestId('capacity-run').waitFor({state:'visible'});
  await target.locator('[data-testid="capacity-status"][data-state="success"]').waitFor();
  receipt.calls.successfulCapacityEvaluations++;
  assert.ok(receipt.calls.successfulCapacityEvaluations <= 3, 'The preview evaluation budget is three successful scenarios.');
  return result;
}
async function editAssumptions(target) {
  const open = target.getByRole('button', {name:'Edit assumptions',exact:true});
  if (await open.count()) await open.click();
}
function identical(result) {
  assert.equal(digest(result.input.baseline), digest(result.input.candidate), 'Initial policies must be identical.');
  assert.equal(digest(result.baseline), digest(result.candidate), 'Identical fleet plans must produce identical actual results.');
  for (const [key, range] of Object.entries(result.delta)) if (range !== null) {
    for (const stat of ['mean','min','max']) assert.equal(range[stat], 0, `Identical plans must have zero paired ${key}/${stat}.`);
  }
}
async function setPeak(target, result, view) {
  await target.getByRole('group', {name:'Replay fleet plan', exact:true}).getByRole('button', {name:view === 'baseline' ? 'Baseline' : 'Candidate', exact:true}).click();
  const peak = target.getByTestId('capacity-peak-interval'), replay = result[view].replay, horizon = result.input.horizonMinutes;
  const waiting = minute => replay.jobs.filter(job => job.arrivalMinutes <= minute &&
    (job.assignedAtMinutes === null ? job.reason === 'horizon_queue' : minute < job.assignedAtMinutes)).length;
  // Inspect only timestamps emitted by the actual server run; no resampling or
  // second dispatch simulation. A bin boundary can retain an existing queue.
  const recorded = [...new Set(replay.events.map(event => event.atMinutes))].sort((a,b)=>a-b);
  const bins = Array.from({length:Math.ceil(horizon/60)},(_,index)=>{
    const start=index*60,end=Math.min(horizon,start+60), times=[start,...recorded.filter(minute=>minute>start&&minute<end)];
    return times.reduce((best,minute)=>waiting(minute)>best.queue?{value:String(index),queue:waiting(minute),minute}:best,{value:String(index),queue:-1,minute:start});
  });
  assert.equal(await peak.locator('option').count(), bins.length);
  const maximum = Math.max(...bins.map(option => option.queue));
  assert.equal(maximum, result[view].replay.metrics.maxQueue, 'Displayed interval peak must match the actual first-replication queue maximum.');
  // Selecting a different bin first ensures the change event also runs for bin0.
  const selected = bins.find(option => option.queue === maximum);
  if (bins.length > 1) await peak.selectOption(bins.find(option => option.value !== selected.value).value);
  await peak.selectOption(selected.value);
  // The native range visually rounds to its .1 step; the URL preserves the full
  // scenario cursor supplied by the interval selector and used by all views.
  const displayed = Number(new URL(target.url()).searchParams.get('t'));
  assert.equal(displayed, selected.minute, 'Peak selection must preserve its exact recorded event time.');
  assert.equal(waiting(displayed), maximum, 'The peak cursor must reproduce the actual waiting jobs at that event.');
  const queued = target.locator('.capacity-replay-counts > div').filter({has:target.locator('span', {hasText:/^Queued$/})}).locator('strong');
  assert.equal(Number(await queued.innerText()), maximum, 'Queue count at the exact cursor must agree with the API event log.');
  receipt.peak = {view, queue:maximum, interval:selected.value, cursorMatchesRecordedPeak:true};
}
async function mapProof(target) {
  const container = target.getByTestId('capacity-job-map');
  await target.locator('.capacity-map-wrap[data-map-ready="true"]').waitFor({timeout:60000});
  await target.waitForLoadState('networkidle',{timeout:20000});
  await container.scrollIntoViewIfNeeded();
  const geometry = await container.evaluate(element => {
    const canvas = element.querySelector('canvas.maplibregl-canvas'); if (!canvas) return null;
    const rect = node => {const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const intersection = (a,b) => {const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};};
    const clipped = node => {let result=rect(node);for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return {x:0,y:0,width:0,height:0};
      if(/hidden|clip|scroll|auto/.test(`${style.overflowX} ${style.overflowY}`))result=intersection(result,rect(ancestor));
    }return result;};
    const viewport={x:0,y:0,width:innerWidth,height:innerHeight};
    return {container:rect(element),canvas:rect(canvas),unclipped:clipped(canvas),inViewport:intersection(clipped(canvas),viewport),
      visibleZoomControls:[...element.querySelectorAll('.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out')].filter(node=>{const r=intersection(clipped(node),viewport);return r.width>=5&&r.height>=5;}).length};
  });
  assert.ok(geometry, 'The actual AWS map needs a canvas.');
  // Capacity points/polygon are GeoJSON canvas layers, not DOM site-marker nodes.
  validateMapGeometry(geometry);
  assert.ok(geometry.inViewport.width >= 200 && geometry.inViewport.height >= 200, 'The detail map must be visible and usable in the viewport.');
  assert.equal(geometry.visibleZoomControls, 2, 'Both real map zoom controls must be visible.');
  let proof;
  for (let attempt=0;attempt<3;attempt++) {
    const pixels = await container.screenshot({type:'png', animations:'disabled', scale:'css'});
    let rgb;
    try {rgb=execFileSync('ffmpeg',['-v','error','-f','image2pipe','-i','pipe:0','-vf','crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,scale=96:64:flags=area,format=rgb24','-frames:v','1','-f','rawvideo','pipe:1'],{input:pixels,timeout:30000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});}
    catch {throw new Error('The required in-memory map pixel decoder failed.');}
    try {proof=analyzeMapRgb(rgb);break;}
    catch {if(attempt===2)throw new Error('The actual map did not show nonblank geographic paint.');await target.waitForTimeout(750);}
  }
  return {...proof, geometry:'PASS', features:'Rendered GeoJSON points/polygon; no fabricated DOM marker count'};
}
function cleanFailure(error) {
  // Do not leak provider query strings if a browser exception contains a URL.
  return (error instanceof Error ? error.message : 'Capacity preview failed.').replace(/https?:\/\/[^\s"')]+/g, value => {try {const url=new URL(value);return `${url.origin}${url.pathname}`;}catch{return '[redacted URL]';}}).slice(0,1500);
}

try {
  const root = await publicRead('/');
  csp = root.headers.get('content-security-policy');
  assert.ok(csp && /script-src 'self'(;|$)/.test(csp), 'The actual public document must provide its restrictive CSP.');
  securityHeaders = {};
  for (const name of ['content-security-policy','content-security-policy-report-only','cross-origin-opener-policy','cross-origin-resource-policy','permissions-policy','referrer-policy','strict-transport-security','x-content-type-options','x-frame-options']) {
    if (root.headers.has(name)) securityHeaders[name] = root.headers.get(name);
  }
  config = await boundedJson(await publicRead('/config.json'));
  assert.equal(new URL(config.apiBase, origin).href.replace(/\/$/, ''), `${origin}/api/v1`);
  const health = await boundedJson(await publicRead('/api/v1/health'));
  manifest = await boundedJson(await publicRead('/api/v1/public/manifest'));
  assert.equal(health.status, 'ready');assert.equal(health.release, config.release);assert.equal(manifest.release, config.release);
  assert.match(config.release, /^[a-f0-9]{40}$/);
  assert.equal(manifest.capabilities?.capacity?.modelVersion, 'fixed-home-capacity-v1');
  assert.ok(manifest.matrix && Date.parse(manifest.matrix.expiresAt) > Date.now());
  receipt.live = {serviceRelease:config.release, datasetHash:manifest.dataset.hash, matrixHash:manifest.matrix.hash, matrixExpiresAt:manifest.matrix.expiresAt};
  receipt.overlay = {document:'/capacity', staticBuildSource:source, cspSha256:digest(csp), securityHeadersPreserved:Object.keys(securityHeaders), configAndApi:'live and unmodified', providerHeaders:'natural browser origin/referrer; not spoofed'};
  const assets = await staticFiles();
  assert.ok(assets.has('/index.html') && assets.has('/theme.js'), 'The reviewed built document and external theme script must exist.');
  receipt.overlay.documentSha256 = digest(await readFile(assets.get('/index.html')));
  const decoder = spawnSync('ffmpeg', ['-version'], {stdio:'ignore', timeout:5000});
  assert.ok(!decoder.error && decoder.status === 0, 'Hosted CI must install ffmpeg for mandatory actual-map pixel proof.');
  const {chromium} = await import('playwright');
  browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce', serviceWorkers:'block'});
  await overlay(context, assets);
  page = await context.newPage();
  const normal = telemetry(page);
  await ready(page);
  await shot('capacity-initial-not-evaluated.png');
  const first = await evaluate(page);
  assert.equal(first.input.jobCount, 24);assert.equal(first.replications, 10);assert.equal(first.input.seed, 42);
  assert.equal(first.input.baseline.units.length, 3);assert.equal(first.input.candidate.units.length, 3);
  identical(first);
  const renderedChanges=await page.locator('.capacity-comparison-table tbody td:last-child strong').allTextContents();
  assert.equal(renderedChanges.length,7,'All seven comparison rows must render.');
  assert.ok(renderedChanges.every(value=>value==='N/A'||Number.parseFloat(value)===0),'The initial UI must show zero for every defined paired change.');
  receipt.identical = {inputHash:first.inputHash, pairedSamplesHash:first.pairedSamplesHash, baselineHash:digest(first.baseline), allDefinedPairedDeltasZero:true};
  receipt.checks.push('Actual default24/10/42 evaluation; identical3-unit policies have zero paired changes');
  await shot('capacity-identical-policies.png');
  await editAssumptions(page);
  await page.getByTestId('capacity-add-candidate-unit').click();
  assert.equal(await page.getByTestId('capacity-status').getAttribute('data-state'),'stale');
  await page.locator('.capacity-previous-result').waitFor();
  assert.match(await page.locator('.capacity-previous-result').innerText(), /Previous result/);
  await shot('capacity-inputs-changed-previous-result.png');
  const candidate = await evaluate(page);
  assert.equal(candidate.input.candidate.units.length, 4);assert.equal(candidate.input.baseline.units.length, 3);
  assert.equal(candidate.pairedSamplesHash, first.pairedSamplesHash, 'Adding a candidate unit must preserve the paired workload.');
  assert.equal(digest(candidate.baseline), digest(first.baseline), 'Editing only candidate must preserve the entire baseline result.');
  assert.notEqual(candidate.inputHash, first.inputHash);
  receipt.candidate = {inputHash:candidate.inputHash, pairedSamplesHash:candidate.pairedSamplesHash, baselineUnchanged:true, baselineUnits:3, candidateUnits:4};
  receipt.checks.push('Candidate+1 uses the same paired samples and unchanged baseline; edits visibly mark previous results');
  await setPeak(page, candidate, 'baseline');
  await noOverflow(page, 1440);
  await shot('capacity-1440-dark.png');
  await page.locator('.capacity-result-provenance > summary').click();
  await page.locator('.capacity-result-provenance').screenshot({path:path.join(out,'capacity-provenance.png'),animations:'disabled'});
  receipt.screenshots.push('capacity-provenance.png');
  assert.ok((await page.locator('.capacity-result-provenance').innerText()).includes(candidate.pairedSamplesHash.slice(0,12)));
  receipt.checks.push('Recorded exact peak cursor and frozen assumptions/provenance are inspectable');
  const jobs = page.getByTestId('capacity-jobs');
  await jobs.getByRole('combobox', {name:'Modeled jobs per page',exact:true}).selectOption('10');
  assert.equal(await jobs.locator('tbody tr').count(), 10);
  const firstPage = await jobs.locator('.capacity-job-link').allTextContents();
  await jobs.getByRole('button', {name:'Next modeled jobs page',exact:true}).click();
  assert.equal(await jobs.locator('tbody tr').count(), 10);
  const secondPage = await jobs.locator('.capacity-job-link').allTextContents();
  assert.equal(firstPage.some(id => secondPage.includes(id)), false, 'Paging must expose a different slice of actual modeled jobs.');
  await shot('capacity-jobs-page2.png');
  await jobs.getByRole('combobox', {name:'Modeled job type filter',exact:true}).selectOption(candidate.baseline.replay.jobs[0].type);
  assert.equal(new URL(page.url()).searchParams.get('jobPage'), null, 'A changed filter resets pagination.');
  const matching = candidate.baseline.replay.jobs.filter(job=>job.type===candidate.baseline.replay.jobs[0].type).length;
  assert.equal(await jobs.locator('tbody tr').count(), Math.min(10,matching));
  await jobs.getByRole('columnheader').getByRole('button', {name:'Type',exact:true}).click();
  assert.equal(await jobs.locator('th.capacity-job-col-type').getAttribute('aria-sort'), 'ascending');
  await shot('capacity-jobs-filtered-sorted.png');
  await jobs.getByRole('button', {name:'Reset filters',exact:true}).click();
  const search=jobs.getByRole('textbox',{name:'Filter all generated modeled jobs by ID, type, zone or assigned unit at cursor',exact:true});
  await search.fill(candidate.baseline.replay.jobs[0].id);
  assert.equal(await jobs.locator('tbody tr').count(),1,'Global modeled-job search must inspect all24 loaded jobs.');
  await jobs.getByRole('button',{name:'Clear modeled job search',exact:true}).click();
  await jobs.getByRole('combobox',{name:'Modeled job phase filter',exact:true}).selectOption('queued');
  assert.equal(await jobs.locator('tbody tr').count(),Math.min(10,receipt.peak.queue),'Phase filtering must use the exact recorded peak cursor.');
  await jobs.getByRole('button', {name:'Reset filters',exact:true}).click();
  const link = jobs.locator('.capacity-job-link').first(), jobId = (await link.innerText()).trim();
  await link.click();
  const drawer = page.getByRole('dialog', {name:`Modeled job ${jobId}`,exact:true});
  await drawer.waitFor();
  receipt.map = await mapProof(page);
  await shot('capacity-job-detail-map.png');
  await drawer.getByRole('button', {name:'Expand modeled job map',exact:true}).click();
  assert.ok((await drawer.getAttribute('class')).includes('is-map-expanded'));
  receipt.expandedMap = await mapProof(page);
  await shot('capacity-job-expanded-map.png');
  await drawer.getByRole('button', {name:'Exit expanded map',exact:true}).click();
  for (const tab of ['summary','timeline','assumptions']) {
    await page.getByTestId(`capacity-job-tab-${tab}`).click();
    await shot(`capacity-job-${tab}.png`);
  }
  await page.getByTestId('capacity-job-tab-location').click();
  await mapProof(page);
  await page.setViewportSize({width:390,height:844});
  await noOverflow(page,390);
  receipt.mobileMap = await mapProof(page);
  await shot('capacity-job-map-390-dark.png');
  await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
  assert.ok(await link.evaluate(element=>document.activeElement===element), 'Closing job detail returns keyboard focus to its real list link.');
  await shot('capacity-390-dark.png');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByTestId('theme-toggle').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await noOverflow(page,1440);await shot('capacity-1440-light.png');
  await page.getByTestId('theme-toggle').click();
  receipt.checks.push('Actual generated-job pagination/filter/sort; native detail tabs/map expansion/Escape/focus return', '1440dark/390dark/1440light; actual AWS map painted at desktop and mobile sizes');
  assert.ok(normal.provider.successfulResponses > 0, 'Map verification requires successful requests to the real AWS basemap.');
  receipt.basemap = {successfulResponses:normal.provider.successfulResponses, providerHosts:[...normal.provider.hosts].sort(), canceledRequests:normal.provider.canceledRequests, actualPaintRequired:true};
  const posts = normal.capacityPosts();
  await editAssumptions(page);
  const count = page.getByRole('spinbutton', {name:/Modeled incidents/});
  await count.fill('');await page.getByTestId('capacity-run').click();
  assert.ok(await count.evaluate(element=>!element.validity.valid), 'A blank count must remain invalid rather than coerce to zero.');
  await count.fill('201');await page.getByTestId('capacity-run').click();
  assert.ok(await count.evaluate(element=>element.validity.rangeOverflow), 'Native max200 validation must prevent oversized UI submission.');
  assert.equal(normal.capacityPosts(),posts,'Invalid UI input cannot issue an evaluation request.');
  await page.locator('.capacity-previous-result').waitFor();await shot('capacity-invalid-input.png');
  await count.fill('24');
  const invalid = await context.request.post(`${origin}${capacityPath}`, {data:{...candidate.input,jobCount:201},timeout:15000});
  assert.equal(invalid.status(),400,'The actual canonical server schema must still reject an oversized workload.');
  const invalidBody = await boundedJson(invalid);
  assert.ok(!invalidBody.baseline&&!invalidBody.candidate,'A schema failure cannot return fabricated model results.');
  receipt.calls.rejectedCapacityRequests++;receipt.checks.push('Native blank/max validation prevents requests; actual invalid API request returns400 without model results');
  await count.fill('0');
  const empty = await evaluate(page);
  assert.equal(empty.baseline.replay.jobs.length,0);assert.equal(empty.candidate.replay.jobs.length,0);
  assert.equal(empty.baseline.aggregate.onTimePct,null);assert.equal(empty.baseline.aggregate.p90ResponseMinutes,null);
  await page.getByText('This modeled workload has no jobs',{exact:true}).waitFor();
  assert.match(await page.getByTestId('capacity-results').innerText(),/N\/A/);
  assert.doesNotMatch(await page.getByTestId('capacity-results').innerText(),/NaN|Infinity/);
  await shot('capacity-zero-jobs.png');
  receipt.checks.push('Actual zero-job run shows an explicit empty list and undefined metrics asN/A');
  assert.deepEqual(normal.errors,[],'Normal live UI/API/map interactions cannot emit console, page, failed-request or HTTP errors.');
  assert.equal(normal.capacityPosts(),3,'Only three successful UI evaluations are allowed in this review.');
  await context.close();
  const fault = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  await overlay(fault,assets);
  await fault.route(`${origin}${capacityPath}`,route=>{receipt.calls.deliberatelyAbortedRequests++;return route.abort('failed');});
  const faultPage = await fault.newPage();await ready(faultPage);
  await faultPage.getByTestId('capacity-run').click();
  await faultPage.locator('[data-testid="capacity-status"][data-state="error"]').waitFor();
  await faultPage.getByTestId('capacity-error').waitFor();
  assert.equal(await faultPage.getByTestId('capacity-results').count(),0,'A network failure cannot show fabricated KPI/results.');
  assert.equal(await faultPage.getByTestId('capacity-jobs').count(),0,'A network failure cannot show fabricated job rows.');
  await shot('capacity-forced-network-error.png',faultPage);
  assert.equal(receipt.calls.deliberatelyAbortedRequests,1);
  receipt.checks.push('A deliberately aborted Capacity request has a distinct unavailable state without fake results');
  await fault.close();receipt.status='pass';
} catch(error) {
  failure=cleanFailure(error);receipt.status='fail';receipt.failure=failure;
  if(page&&!page.isClosed())try {await shot('capacity-failure.png');}catch {/* Preserve the original bounded failure. */}
} finally {
  if(browser)await browser.close();receipt.finishedAt=new Date().toISOString();
  await writeFile(path.join(out,'receipt.json'),`${JSON.stringify(receipt,null,2)}\n`,'utf8');
}
if(failure)throw new Error(failure);
console.log(JSON.stringify({capacityPreview:'pass',source,serviceRelease:receipt.live.serviceRelease,successfulEvaluations:receipt.calls.successfulCapacityEvaluations,screenshots:receipt.screenshots.length,out}));
