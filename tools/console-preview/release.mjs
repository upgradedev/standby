#!/usr/bin/env node
/** Hosted-only public console QA. UI bytes are overlaid at the approved origin;
 * source responses are real, allowlisted and cached only in this process. Fault
 * fixtures are explicit failures, never invented historical/model successes.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {assertRenderedMap} from '../demo/map-render-proof.mjs';

const HELP=`Standby final public console QA (hosted CI only)
Usage: node tools/console-preview/release.mjs [options]
  --dist <dir>    Built console (default apps/console/dist)
  --out <dir>     Reports/contact sheets/shots (default .runtime/console-release-qa)
  --source <sha>  Exact UI source SHA (or GITHUB_SHA)
  --help         Print help without network/browser/dependency work
Requires hosted CI Node22, Playwright Chromium, explicitly installed axe-core,
and ffmpeg. Does not install dependencies or deploy. Public routes only.
Authoritative matrix: six routes x320/390/768/1440 xdark/light at approved origin.
Forced loading/error/malformed/403-unavailable/no-match, capability-unavailable,
partial-source failure and storage-blocked checks are labeled separately.
At most four live JSON reads and two distinct live public evaluation POSTs;
subsequent identical responses are transient real-data cache hits. AWS basemap
requests retain natural browser headers. Live CSP is preserved, never bypassed.
Unchanged skill shoot.mjs runs a small loopback Overview/keyboard contact sheet;
mandatory axe and real-origin map proofs belong to the authoritative matrix.
No credentials, provider keys, raw JSON responses or request bodies are saved.
Human keyboard, visual review and authenticated role judgment remain PENDING.
`;
if(process.argv.includes('--help')){console.log(HELP);process.exit(0);}
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const source=arg('--source',process.env.GITHUB_SHA);
assert.match(source??'',/^[a-f0-9]{40}$/,'Exact UI source SHA is required.');
assert.equal(process.env.CI,'true','Browser/API QA runs in hosted CI only.');
const origin='https://d34x1513u5u1qs.cloudfront.net';
const routes=['overview','incidents','capacity','queues','map','settings'];
const widths=[320,390,768,1440],themes=['dark','light'];
const dist=path.resolve(arg('--dist','apps/console/dist'));
const out=path.resolve(arg('--out','.runtime/console-release-qa'));
const scripts=path.dirname(fileURLToPath(import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const scrub=error=>String(error instanceof Error?error.message:error).replace(/https?:\/\/[^\s"')]+/g,value=>{try{const url=new URL(value);return `${url.origin}${url.pathname}`;}catch{return '[URL redacted]';}}).slice(0,1400);
const receipt={source,startedAt:new Date().toISOString(),status:'running',origin,
  scope:'New static build overlay; actual public API responses cached transiently; real AWS basemap. NOT a deployment or authenticated-role verification.',
  human:{keyboard:'PENDING human pass at1440/390',roles:'PENDING authorized test identities and human role matrix',visual:'PENDING contact-sheet and individual-shot inspection'},
  calls:{liveJsonReads:0,liveEvaluations:0,cacheHits:0},responses:[],checks:[],records:[]};
await mkdir(path.join(out,'shots'),{recursive:true});
let browser,server,csp,headers,assets,axeFile,axeVersion,manifest,config,zones;
const cache=new Map(),readPaths=new Set(['/config.json','/api/v1/health','/api/v1/public/manifest','/api/v1/public/zones']);
const postPaths=new Set(['/api/v1/public/evaluations','/api/v1/public/capacity-evaluations']);

async function actual(pathname,{method='GET',body}={}){
  assert.ok(method==='GET'?readPaths.has(pathname):method==='POST'&&postPaths.has(pathname),'QA cannot access an unapproved endpoint.');
  const key=`${method} ${pathname} ${body??''}`;
  if(cache.has(key)){receipt.calls.cacheHits++;return cache.get(key);}
  if(method==='POST')assert.ok(receipt.calls.liveEvaluations<2,'At most two distinct public model evaluations are allowed.');
  const pending=(async()=>{
    const response=await fetch(`${origin}${pathname}`,{method,body,headers:body?{'content-type':'application/json'}:undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,`Actual public source ${pathname} must return200.`);
    const text=await response.text();assert.ok(Buffer.byteLength(text)<=5_000_000,'Actual public response exceeds the QA bound.');
    const json=JSON.parse(text);
    method==='POST'?receipt.calls.liveEvaluations++:receipt.calls.liveJsonReads++;
    receipt.responses.push({method,path:pathname,...(body?{requestSha256:sha(body)}:{}),responseSha256:sha(text)});
    return {json,text,hash:sha(text)};
  })();
  cache.set(key,pending);return pending;
}
async function files(directory=dist,prefix=''){
  const found=new Map();for(const entry of await readdir(directory,{withFileTypes:true})){
    const relative=`${prefix}/${entry.name}`;
    if(entry.isDirectory())for(const pair of await files(path.join(directory,entry.name),relative))found.set(...pair);
    else if(entry.isFile())found.set(relative,path.join(directory,entry.name));
  }return found;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
function faultJson(state){return state==='malformed'?{}:{code:state==='unavailable'?'FORCED_QA_ACCESS_UNAVAILABLE':'FORCED_QA_SOURCE_OUTAGE',message:state==='unavailable'?'Source access is unavailable in this forced QA context.':'The source is unavailable in this forced QA context.',requestId:`forced-qa-${state}`,retryable:state!=='unavailable'};}
async function install(context,state='normal'){
  let release;const held=new Promise(resolve=>{release=resolve;}),pendingHeld=[];
  await context.route(`${origin}/**`,async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(pathname==='/__standby_qa__/axe.min.js')return route.fulfill({status:200,headers:{...headers,'content-type':mime['.js']},body:await readFile(axeFile)});
    if(readPaths.has(pathname)||postPaths.has(pathname)){
      if(state==='loading'&&pathname==='/api/v1/public/manifest'){
        let finished;pendingHeld.push(new Promise(resolve=>{finished=resolve;}));
        await held;
        try{
          const response=await actual(pathname);await route.fulfill({status:200,contentType:'application/json',body:response.text});
        }catch{/* A timed-out loading request remains a failed loading check. */}finally{finished();}
        return;
      }
      const forced=pathname==='/api/v1/public/manifest'&&['error','malformed','unavailable'].includes(state)||state==='partial-source'&&pathname==='/api/v1/public/zones';
      if(forced)return route.fulfill({status:state==='malformed'?200:state==='unavailable'?403:503,contentType:'application/json',body:JSON.stringify(faultJson(state))});
      let response;
      try{response=await actual(pathname,{method:request.method(),body:request.method()==='POST'?request.postData():undefined});}
      catch{return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'QA_REAL_SOURCE_UNAVAILABLE',message:'The actual public source did not provide a valid QA response.',requestId:'qa-real-source-unavailable',retryable:true})});}
      if(state==='capability-unavailable'&&pathname==='/api/v1/public/manifest')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...response.json,capabilities:{}})});
      return route.fulfill({status:200,contentType:'application/json',body:response.text});
    }
    if(pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'QA_ROUTE_NOT_ALLOWED',message:'This QA run allows public reads and evaluations only.'})});
    const document=request.isNavigationRequest()&&routes.some(name=>pathname===`/${name}`);
    const filename=document?assets.get('/index.html'):assets.get(pathname);
    if(filename&&request.method()==='GET')return route.fulfill({status:200,headers:{...headers,'content-type':mime[path.extname(filename)]??'application/octet-stream','cache-control':'no-store'},body:await readFile(filename)});
    return route.continue();
  });
  return async()=>{release();await Promise.allSettled(pendingHeld);};
}
function telemetry(page,record){
  record.events=[];
  const expectedApi=pathname=>record.state==='partial-source'?pathname==='/api/v1/public/zones':['error','unavailable'].includes(record.state)&&pathname==='/api/v1/public/manifest';
  page.on('pageerror',()=>record.events.push({kind:'page-error',expected:false}));
  page.on('console',message=>{
    if(message.type()==='error')record.events.push({kind:'console-error',expected:['error','unavailable','partial-source'].includes(record.state)&&/Failed to load resource.*(403|503)/.test(message.text())});
    else if(message.type()==='warning')record.events.push({kind:/Warning:|React.*(key|effect)/.test(message.text())?'react-warning':'console-warning',expected:false});
  });
  page.on('requestfailed',request=>{const canceled=request.failure()?.errorText==='net::ERR_ABORTED';record.events.push({kind:canceled?'canceled-request':'failed-request',resource:request.resourceType(),expected:canceled});});
  page.on('response',response=>{
    const url=new URL(response.url());
    if(response.status()>=400)record.events.push({kind:'http-error',status:response.status(),source:url.origin===origin?'owned-app':'provider',expected:expectedApi(url.pathname)});
    if(url.hostname.endsWith('.amazonaws.com')&&response.ok())record.awsResponses=(record.awsResponses??0)+1;
  });
}
async function paint(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function geometry(page){
  await paint(page);
  const value=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
  assert.ok(value.width<=value.viewport+1,'Document reflow must stay within viewport+1px.');return value;
}
async function runAxe(page,record){
  await page.addScriptTag({url:`${origin}/__standby_qa__/axe.min.js`});
  let timer;
  const running=page.evaluate(async()=>{
    if(!window.axe?.run)throw new Error('axe-core did not load under the unchanged CSP.');
    const scan=await window.axe.run(document);
    return {version:scan.testEngine.version,passes:scan.passes.length,incomplete:scan.incomplete.map(item=>({id:item.id,impact:item.impact})),violations:scan.violations.map(item=>({id:item.id,impact:item.impact,help:item.help,helpUrl:item.helpUrl,targets:item.nodes.slice(0,6).flatMap(node=>node.target)}))};
  });
  let result;
  try{result=await Promise.race([running,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Mandatory axe scan exceeded20seconds.')),20000);})]);}
  finally{clearTimeout(timer);}
  assert.equal(result.version,axeVersion,'The explicitly installed axe-core must run.');
  assert.ok(result.passes>0,'An empty accessibility run cannot count as a pass.');
  record.axe=result;
}
async function ready(page,route,state,theme){
  const response=await page.goto(`${origin}/${route}?theme=${theme}${route==='overview'&&state==='normal'?'&state=error':''}`,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);assert.equal(await response.headerValue('content-security-policy'),csp,'Live CSP must remain byte-identical.');
  if(state==='loading'){
    await page.locator('main .loading-state').waitFor();
    assert.doesNotMatch(await page.locator('main .loading-state').innerText(),/\d/,'Loading placeholders cannot invent numbers.');
    const pulse=await page.locator('.skeleton').first().evaluate(element=>getComputedStyle(element).animationDuration.split(',').some(duration=>parseFloat(duration)>.01));
    assert.equal(pulse,false,'Reduced-motion loading must not pulse.');return;
  }
  await page.locator('main#main[data-ready="true"]').waitFor();
  if(['error','malformed','unavailable','partial-source'].includes(state)){
    await page.locator('main .error-state').waitFor();
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
    assert.equal(await page.locator('.kpi-card,.data-table tbody tr,[data-testid="capacity-results"],[data-testid="capacity-jobs"]').count(),0,'Source failure must not display fallback KPIs or rows.');
    if(state==='unavailable')await page.getByRole('heading',{name:'Access restricted',exact:true}).waitFor();return;
  }
  await page.waitForFunction(()=>!document.querySelector('.skeleton')&&!document.querySelector('.api-banner'));
  if(route==='overview')await page.locator('.comparison-row.proposal').waitFor();
  if(route==='capacity'){
    if(state==='capability-unavailable'){
      await page.locator('[data-testid="capacity-status"][data-state="unavailable"]').waitFor();
      assert.equal(await page.getByTestId('capacity-results').count(),0);return;
    }
    await page.getByTestId('capacity-run').click();
    await page.locator('[data-testid="capacity-status"][data-state="success"]').waitFor();
    await page.getByTestId('capacity-results').waitFor();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('t')==='480');
  }
  if(route==='map'){
    await page.locator('.map-canvas.maplibregl-map canvas').waitFor();
    await page.locator('.map-loading').waitFor({state:'hidden'});
    assert.equal(await page.locator('.map-error').count(),0,'The map must actually load at the approved origin.');
    await page.waitForLoadState('networkidle');
  }
  assert.equal(await page.locator('[data-testid="demo-banner"]').count(),0);
  assert.doesNotMatch(await page.title(),/\[Demo\]/);
}
async function keyboard(page,route,width){
  await page.locator('a.skip-link').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement?.id==='main');
  await page.keyboard.press('/');
  const search=page.getByRole('textbox',{name:'Search all demand zones, candidate sites and scenarios',exact:true});
  await search.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Search all demand zones, candidate sites and scenarios');
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Global search',exact:true}).waitFor({state:'hidden'});
  if(width<768){
    const trigger=page.getByRole('button',{name:'Open navigation',exact:true});await trigger.focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Navigation',exact:true});await dialog.waitFor();
    assert.equal(await dialog.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link').count(),6);
    for(let index=0;index<3;index++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(element=>element.contains(document.activeElement)),'Mobile navigation keeps keyboard focus inside its native dialog.');}
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open navigation');
  }else{
    const nav=page.getByRole('navigation',{name:'Main navigation',exact:true});assert.equal(await nav.getByRole('link').count(),6);
    if(route==='overview'){
      await page.getByRole('button',{name:'Collapse sidebar',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.app-shell.sidebar-collapsed').waitFor();
      assert.equal(await nav.getByRole('link').count(),6);
      await page.getByRole('button',{name:'Expand sidebar',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.app-shell:not(.sidebar-collapsed)').waitFor();
    }
  }
  if(route==='settings'){
    await page.getByRole('tab',{name:'Preferences',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await page.locator('[role="tab"][aria-selected="true"]').filter({hasText:'Data & model'}).waitFor();
  }
  return {skipLink:true,slashSearch:true,navigation:true,scope:'automated smoke only; human focus/order/role judgment remains pending'};
}
async function noMatch(page,route){
  if(route==='incidents'){
    await page.getByRole('textbox',{name:'Filter all demand zones',exact:true}).fill('__standby_qa_no_match__');
    await page.getByRole('heading',{name:'No zones match these filters',exact:true}).waitFor();
    assert.equal(await page.locator('.data-table tbody tr').count(),0);await page.getByRole('button',{name:'Clear filters',exact:true}).waitFor();
  }else if(route==='capacity'){
    await page.getByRole('textbox',{name:'Filter all generated modeled jobs by ID, type, zone or assigned unit at cursor',exact:true}).fill('__standby_qa_no_match__');
    await page.getByRole('heading',{name:'No modeled jobs match these filters',exact:true}).waitFor();
    assert.equal(await page.locator('.capacity-job-table tbody tr').count(),0);await page.getByRole('button',{name:'Reset filters',exact:true}).waitFor();
  }else if(route==='queues'){
    await page.getByRole('tab',{name:/Reviewed/}).click();
    await page.getByRole('heading',{name:'No plans marked reviewed',exact:true}).waitFor();
  }else{
    await page.locator('#main').focus();await page.keyboard.press('/');
    await page.getByRole('textbox',{name:'Search all demand zones, candidate sites and scenarios',exact:true}).fill('__standby_qa_no_match__');
    await page.getByText('No matching zones, sites or scenarios.',{exact:true}).waitFor();
  }
}
async function capture(route,width,theme,state='normal'){
  const record={route,width,theme,state,status:'running',file:`shots/${route}--${state}--${width}--${theme}.png`};receipt.records.push(record);
  if(state==='unavailable')record.stateScope='Forced source403, not a real-role authorization test.';
  if(state==='no-match')record.stateScope=route==='queues'?'Actual empty device-local Reviewed queue; no synthetic/cloud records.':['incidents','capacity'].includes(route)?'Real loaded rows filtered through the page controls.':'Shell search over the actual public snapshot; the underlying page stays valid.';
  if(state==='loading')record.stateScope='Manifest transport held by QA; no demo state parameter or fabricated success.';
  const context=await browser.newContext({viewport:{width,height:width<768?844:1000},reducedMotion:'reduce',colorScheme:theme,serviceWorkers:'block'});
  const release=await install(context,state);
  if(state==='storage-blocked')await context.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked for QA','SecurityError');}}));
  const page=await context.newPage();page.setDefaultTimeout(15000);telemetry(page,record);
  try{
    await ready(page,route,state,theme);
    if(state==='no-match')await noMatch(page,route);
    record.geometry=await geometry(page);
    if(route==='map'&&state==='normal'){
      // The map proof is independent of axe, SDK initialization and success UI.
      record.mapProof=await assertRenderedMap(page,{requirePixels:true});
      assert.ok(record.awsResponses>0,'Real map requests must reach AWS with natural browser origin headers.');
    }
    await page.screenshot({path:path.join(out,record.file),animations:'disabled',fullPage:false});
    await runAxe(page,record);
    if(state==='normal'&&theme==='dark')record.keyboard=await keyboard(page,route,width);
    if(state==='loading')assert.equal(await page.locator('main .loading-state').count(),1,'Loading must remain a loading state during its scan.');
    const unexpected=record.events.filter(event=>!event.expected&&event.kind!=='console-warning');
    assert.equal(unexpected.length,0,'Unexpected console/page/network errors must not be hidden by the screenshot exit status.');
    assert.equal(record.axe.violations.filter(item=>['serious','critical'].includes(item.impact)).length,0,'Axe serious and critical findings are release blockers.');
    record.status='pass';
  }catch(error){record.status='fail';record.failure=scrub(error);try{await page.screenshot({path:path.join(out,record.file),animations:'disabled'});}catch{record.file=null;}}
  finally{await release();await context.close();}
}
async function command(args){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,'Copied skill screenshot command must succeed.');
}
async function skillOverview(){
  // The copied script has no browser-context routing hook. Its isolated loopback
  // scope is Overview only: no map, no allowed-origin spoofing, no axe CSP bypass.
  server=http.createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://127.0.0.1');
      if(readPaths.has(url.pathname)||postPaths.has(url.pathname)){
        let body='';for await(const chunk of request){body+=chunk;assert.ok(Buffer.byteLength(body)<=16000);}
        const cached=await actual(url.pathname,{method:request.method,body:body||undefined});
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return response.end(cached.text);
      }
      const filename=assets.get(url.pathname)??(!path.extname(url.pathname)?assets.get('/index.html'):null);
      if(!filename){response.writeHead(404);return response.end();}
      response.writeHead(200,{...headers,'content-type':mime[path.extname(filename)]??'application/octet-stream','cache-control':'no-store'});response.end(await readFile(filename));
    }catch{response.writeHead(503,{'content-type':'application/json'});response.end('{"code":"QA_SOURCE_UNAVAILABLE","message":"Real public source unavailable"}');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const skill=path.join(scripts,'shoot.mjs');await command([skill,'--help']);
  receipt.skill={sha256:sha(await readFile(skill)),scope:'Unmodified skill Overview loopback screenshot/keyboard only. Mandatory axe and map checks are in the separate authoritative real-origin matrix.'};
  await command([skill,'--url',`http://127.0.0.1:${server.address().port}/`,'--routes','overview','--widths','390,1440','--themes','dark','--keyboard','--concurrency','1','--settle','0','--project',process.cwd(),'--out',path.join(out,'skill-overview')]);
  const report=JSON.parse(await readFile(path.join(out,'skill-overview','report.json'),'utf8'));
  assert.equal(report.shots.length,2);
  for(const shot of report.shots)for(const field of ['consoleErrors','pageErrors','failedRequests','httpErrors'])assert.equal(shot[field].length,0,`Copied skill ${field} must be empty.`);
  receipt.skill.shots=2;receipt.skill.keyboardWarnings=report.summary.keyboardWarnings;
  await new Promise(resolve=>server.close(resolve));server=null;
}
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function contacts(){
  const groups=[['contact-sheet-normal',receipt.records.filter(record=>record.state==='normal')],['contact-sheet-states',receipt.records.filter(record=>record.state!=='normal')]];
  for(const route of routes)groups.push([`contact-sheet-${route}`,receipt.records.filter(record=>record.route===route)]);
  for(const [name,records]of groups){
    const html=`<!doctype html><meta charset="utf-8"><title>Standby public console QA</title><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#111820;color:#e2edf4;font:14px system-ui}h1{font-size:23px}p{max-width:1200px;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0;border:2px solid #2a6954;padding:6px;background:#192330}.fail{border-color:#f58b91}img{width:100%;height:240px;object-fit:cover;object-position:top;display:block}figcaption{padding:8px;font-size:12px;overflow-wrap:anywhere}</style><h1>Standby · ${escape(name)}</h1><p>UI source ${source}. Actual public source responses cached in memory; AWS map uses its real allowed origin and unchanged CSP. Intentional fault states are labeled. Automated results do not replace pending human keyboard, role or visual review.</p><div class="grid">${records.map(record=>`<figure class="${record.status==='pass'?'':'fail'}">${record.file?`<a href="${escape(record.file)}"><img src="${escape(record.file)}" alt="${escape(`${record.route} ${record.state} ${record.width} ${record.theme}`)}"></a>`:'No screenshot'}<figcaption>${escape(`${record.route} · ${record.state} · ${record.width}px · ${record.theme} · ${record.status}`)}${record.failure?`<br>${escape(record.failure)}`:''}</figcaption></figure>`).join('')}</div>`;
    const filename=path.join(out,`${name}.html`);await writeFile(filename,html,'utf8');
    const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
    await page.goto(pathToFileURL(filename).href);await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});await context.close();
  }
}
try{
  const require=createRequire(import.meta.url);axeFile=require.resolve('axe-core/axe.min.js');
  axeVersion=JSON.parse(await readFile(require.resolve('axe-core/package.json'),'utf8')).version;
  receipt.axe={required:true,version:axeVersion,sourceSha256:sha(await readFile(axeFile)),injection:'Same-origin QA-only external static script; original script-src self preserved'};
  const root=await fetch(`${origin}/`,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(root.status,200);
  csp=root.headers.get('content-security-policy');assert.ok(csp&&/script-src 'self'(;|$)/.test(csp));headers={};
  for(const name of ['content-security-policy','content-security-policy-report-only','referrer-policy','strict-transport-security','x-content-type-options','x-frame-options','cross-origin-opener-policy','cross-origin-resource-policy','permissions-policy'])if(root.headers.has(name))headers[name]=root.headers.get(name);
  config=(await actual('/config.json')).json;const health=(await actual('/api/v1/health')).json;
  manifest=(await actual('/api/v1/public/manifest')).json;zones=(await actual('/api/v1/public/zones')).json;
  assert.equal(config.release,health.release);assert.equal(config.release,manifest.release);assert.equal(health.status,'ready');
  assert.equal(new URL(config.apiBase,origin).href.replace(/\/$/,''),`${origin}/api/v1`);
  assert.ok(manifest.matrix&&Date.parse(manifest.matrix.expiresAt)>Date.now());assert.ok(zones.zones.length>0);
  receipt.live={release:config.release,datasetHash:manifest.dataset.hash,matrixHash:manifest.matrix.hash,matrixExpiresAt:manifest.matrix.expiresAt,zoneCount:zones.zones.length,cspSha256:sha(csp)};
  assets=await files();assert.ok(assets.has('/index.html')&&assets.has('/theme.js'));
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  for(const width of widths)for(const theme of themes)for(const route of routes)await capture(route,width,theme);
  for(const state of ['loading','error','malformed','unavailable','partial-source','no-match'])for(const route of routes)await capture(route,390,'dark',state);
  await capture('capacity',390,'dark','capability-unavailable');await capture('overview',390,'dark','storage-blocked');
  let skillFailure;
  try{await skillOverview();}catch(error){skillFailure=scrub(error);receipt.skill={...receipt.skill,failure:skillFailure};}
  await contacts();
  receipt.checks.push('All six public routes across four widths and two themes', 'Mandatory axe scan on every primary record', 'Actual rendered AWS map proof at each normal width/theme', 'No fake success in explicit fault states', 'Only public anonymous API paths; no operator auth or protected writes', 'Human keyboard/roles/visual judgment remains pending');
  assert.equal(receipt.records.filter(record=>record.state==='normal').length,48);
  assert.equal(receipt.records.length,86);
  assert.equal(receipt.records.filter(record=>!record.axe).length,0,'Axe must never be silently skipped.');
  assert.equal(receipt.records.filter(record=>record.status!=='pass').length,0,'Every automated record must pass.');
  assert.equal(receipt.calls.liveJsonReads,4,'Only the four allowlisted live JSON reads are permitted.');
  assert.equal(receipt.calls.liveEvaluations,2,'Exactly one actual historical and one actual capacity evaluation support this matrix.');
  assert.ok(!skillFailure,'The unchanged copied skill Overview run must also pass.');
  receipt.status='pass';
}catch(error){receipt.status='fail';receipt.failure=scrub(error);}
finally{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  receipt.finishedAt=new Date().toISOString();
  receipt.summary={records:receipt.records.length,failed:receipt.records.filter(record=>record.status!=='pass').length,
    missingAxe:receipt.records.filter(record=>!record.axe).length,seriousCritical:receipt.records.reduce((total,record)=>total+(record.axe?.violations??[]).filter(item=>['serious','critical'].includes(item.impact)).length,0)};
  await writeFile(path.join(out,'receipt.json'),`${JSON.stringify(receipt,null,2)}\n`,'utf8');
  await writeFile(path.join(out,'report.html'),`<!doctype html><meta charset="utf-8"><title>Standby release QA</title><h1>Automated public console QA: ${escape(receipt.status)}</h1><p>Human keyboard, role matrix and visual approval: PENDING. This run does not deploy.</p><p><a href="contact-sheet-normal.html">Normal matrix</a> · <a href="contact-sheet-states.html">Forced states</a> · <a href="receipt.json">Full structured receipt</a></p><table><tr><th>Route</th><th>State</th><th>Width/theme</th><th>Result</th><th>Serious/critical axe</th></tr>${receipt.records.map(record=>`<tr><td>${escape(record.route)}</td><td>${escape(record.state)}</td><td>${record.width}/${record.theme}</td><td>${escape(record.status)} ${escape(record.failure??'')}</td><td>${(record.axe?.violations??[]).filter(item=>['serious','critical'].includes(item.impact)).length}</td></tr>`).join('')}</table>`,'utf8');
}
if(receipt.status!=='pass')throw new Error(receipt.failure??'Public console QA failed; inspect the receipt/contact sheets.');
console.log(JSON.stringify({publicConsoleQa:'pass',source,records:receipt.records.length,seriousCritical:receipt.summary.seriousCritical,liveEvaluations:receipt.calls.liveEvaluations,humanKeyboard:'PENDING',humanRoles:'PENDING',out}));
