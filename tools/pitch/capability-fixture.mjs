/** Hosted, localhost-only actual React component control. Never product footage. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

if(process.argv.includes('--help')){
  console.log('Hosted offline actual CapacityAssumptions control.\nnode tools/pitch/capability-fixture.mjs --out .runtime/pitch-capability\nRequires pinned repository CI dependencies and capture-state-5.mjs. No product requests or takes.');
  process.exit(0);
}
assert.equal(process.env.CI,'true','Hosted CI only; no local build/browser');
const outIndex=process.argv.indexOf('--out');assert(outIndex>=0&&process.argv[outIndex+1],'--out required');
const out=path.resolve(process.argv[outIndex+1]);await mkdir(path.dirname(out),{recursive:true});await mkdir(out,{recursive:false});
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const helperPath=path.join(here,'capture-state-5.mjs');
const sourcePaths=['apps/console/src/components/capacity/CapacityAssumptions.tsx','apps/console/src/components/capacity/capacity-assumptions.css','apps/console/src/styles.css','apps/console/src/theme.css','apps/console/src/pages/capacity.css','packages/contracts/src/capacity.ts'];
const receipt={status:'running',scope:'OFFLINE_ACTUAL_COMPONENT_NOT_PRODUCT_FOOTAGE',applicationRequests:0,productTakes:0,voiceCalls:0,externalOrNonGetRequests:[],pageErrors:[],cases:[],sourceSha256:{},limitations:['Isolated actual component and frozen CSS, without application Provider, WebGL or product API.','An old sequence pass does not reproduce or explain the spent Take4 failure.']};
for(const source of sourcePaths)receipt.sourceSha256[source]=sha(await readFile(path.join(repo,source)));
receipt.helperSha256=sha(await readFile(helperPath));
assert.equal(receipt.helperSha256,'1707bca377b7e5137662997b697fb1bc382a8d6f7990f4f37489afe0ebb5b91a','Fixture must exercise the reviewed actual helper5 bytes');
const save=()=>writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n','utf8');
await save();
let server,browser;
try{
  const [{build},{default:react},{default:tailwindcss},{chromium},{setRecordedCheckbox}]=await Promise.all([
    import('vite'),import('@vitejs/plugin-react'),import('@tailwindcss/vite'),import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright'),import(pathToFileURL(helperPath).href),
  ]);
  const bundle=path.join(out,'bundle');
  await build({configFile:false,root:repo,plugins:[react(),tailwindcss()],logLevel:'warn',define:{'process.env.NODE_ENV':'"production"'},
    build:{outDir:bundle,emptyOutDir:false,sourcemap:false,target:'es2022',lib:{entry:path.join(here,'capability-fixture.tsx'),formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}});
  const html='<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8"><title>Offline actual capacity component</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
  const assets=new Map([['/',{type:'text/html',bytes:Buffer.from(html)}],['/fixture.js',{type:'text/javascript',bytes:await readFile(path.join(bundle,'fixture.js'))}],['/fixture.css',{type:'text/css',bytes:await readFile(path.join(bundle,'fixture.css'))}]]);
  receipt.bundleSha256=Object.fromEntries([...assets].map(([name,asset])=>[name,sha(asset.bytes)]));
  server=createServer((request,response)=>{const asset=request.method==='GET'?assets.get(request.url):null;if(!asset){response.writeHead(404);response.end();return;}response.setHeader('Content-Type',asset.type);response.end(asset.bytes);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({headless:true});
  const exact=name=>({name,exact:true});
  const caps=[['Battery',false],['Tyre',false],['Breakdown',true],['Collision',true]];
  const labelFor=name=>`${name} capability: Candidate unit-4`;
  // Frozen take scenario, independent of the component's default factory.
  const approvedUnits=[
    {id:'unit-1',kind:'motorcycle',siteId:'site-01',capabilities:['battery','tyre'],available:true,shiftStartMinutes:0,shiftEndMinutes:480},
    {id:'unit-2',kind:'service_van',siteId:'site-02',capabilities:['battery','tyre','breakdown'],available:true,shiftStartMinutes:0,shiftEndMinutes:480},
    {id:'unit-3',kind:'flatbed',siteId:'site-03',capabilities:['breakdown','collision'],available:true,shiftStartMinutes:0,shiftEndMinutes:480},
  ];
  const approvedInput={schemaVersion:'1',seed:42,horizonMinutes:480,replications:1,jobCount:2,responseTargetMinutes:30,arrivalWeights:[1,0,0,0,0,0,0,0],dispatchPrepMinutes:3,recoveryMinutes:10,travelMultiplier:1,
    typeProfiles:{battery:{share:0,onSiteMinutes:{min:10,mode:20,max:40},flatbedTransportMinutes:0,flatbedDropoffMinutes:0},tyre:{share:0,onSiteMinutes:{min:15,mode:30,max:60},flatbedTransportMinutes:0,flatbedDropoffMinutes:0},breakdown:{share:0,onSiteMinutes:{min:20,mode:45,max:90},flatbedTransportMinutes:20,flatbedDropoffMinutes:10},collision:{share:1,onSiteMinutes:{min:60,mode:60,max:60},flatbedTransportMinutes:60,flatbedDropoffMinutes:15}},baseline:{units:approvedUnits},candidate:{units:structuredClone(approvedUnits)}};
  const input=async page=>JSON.parse(await page.getByTestId('fixture-input').textContent());
  async function fresh(name){
    const context=await browser.newContext({viewport:{width:1536,height:864},deviceScaleFactor:1,serviceWorkers:'block'});
    await context.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin===new URL(url).origin&&request.method()==='GET')return route.continue();receipt.externalOrNonGetRequests.push({case:name,method:request.method(),external:new URL(request.url()).origin!==new URL(url).origin});return route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(30_000);
    page.on('pageerror',error=>receipt.pageErrors.push({case:name,name:error.name,message:error.message}));
    await page.goto(url,{waitUntil:'networkidle'});await page.getByTestId('fixture-input').waitFor();
    assert.deepEqual(await input(page),approvedInput,'Fixture must start with the exact frozen 3/3 scenario');
    return{context,page};
  }
  async function configureFourth(page){
    await page.getByTestId('capacity-add-candidate-unit').click();
    const editor=page.locator('details.capacity-unit-editor').filter({has:page.locator('summary code').filter({hasText:/^unit-4$/})});
    assert.equal(await editor.count(),1);
    await editor.locator(':scope > summary').click();
    await page.getByRole('combobox',exact('Vehicle kind: Candidate unit-4')).selectOption('flatbed');
    await page.getByRole('combobox',exact('Home standby site: Candidate unit-4')).selectOption('site-03');
    await page.getByRole('spinbutton',exact('Duty start (min): Candidate unit-4')).fill('0');
    await page.getByRole('spinbutton',exact('Duty end (min): Candidate unit-4')).fill('480');
    await page.getByRole('checkbox',exact('Available in this scenario: Candidate unit-4')).setChecked(true);
    return editor;
  }
  async function diagnostics(page,label){
    return page.getByRole('checkbox',{...exact(label),includeHidden:true}).evaluateAll(elements=>elements.map(element=>{
      const box=element.getBoundingClientRect();let detailsOpen=true;for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement&&!parent.open)detailsOpen=false;
      return{checked:element.checked,disabledProperty:element.disabled,disabledEffective:element.matches(':disabled'),detailsOpen,geometry:{x:box.x,y:box.y,width:box.width,height:box.height},hitTarget:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===element};
    }));
  }
  const bounded=async(operation,milliseconds)=>{let timer;try{return await Promise.race([operation(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('fixture-bounded-deadline')),milliseconds))]);}finally{clearTimeout(timer);}};
  function expectedCandidate(initial){const expected=structuredClone(initial);expected.candidate.units.push({id:'unit-4',kind:'flatbed',siteId:'site-03',capabilities:['breakdown','collision'],available:true,shiftStartMinutes:0,shiftEndMinutes:480});return expected;}

  // Preserve the original unframed native control sequence exactly once. Observation
  // between edits would change its scheduling; capture before/after only.
  {
    const {context,page}=await fresh('old-sequence');const initial=await input(page);
    const record={name:'old-sequence',status:'running',method:'locator.setChecked',attempts:1,labels:caps.map(([name])=>labelFor(name)),initialSha256:sha(JSON.stringify(initial))};
    receipt.cases.push(record);await configureFourth(page);
    record.before=await diagnostics(page,labelFor('Battery'));
    let currentLabel=null,method='locator.setChecked';
    try{
      for(const[name,checked]of caps){currentLabel=labelFor(name);await page.getByRole('checkbox',exact(currentLabel)).setChecked(checked);}
      method='fixture.assertReactInput';
      assert.deepEqual(await input(page),expectedCandidate(initial));
      record.status='passed';record.reproducedTake4Failure=false;
      record.interpretation='Old sequence passed in isolated fixture. Take4 cause remains unestablished.';
    }catch(error){record.status='failed';record.reproducedTake4Failure='unknown-not-established';record.error={name:error.name,message:error.message,label:currentLabel,method};record.interpretation='Isolated failure retained; correspondence to Take4 requires evidence.';}
    record.after=await diagnostics(page,currentLabel??labelFor('Battery'));record.finalInput=await input(page);
    await context.close();await save();
  }
  {
    const {context,page}=await fresh('recorded-helper');const initial=await input(page);await configureFourth(page);
    const record={name:'recorded-helper',status:'running',stages:[],edits:[],evidence:[]};receipt.cases.push(record);
    for(const[name,checked]of caps){
      const label=labelFor(name);
      record.edits.push(await setRecordedCheckbox({page,label,checked,bounded,onStage:stage=>record.stages.push(stage),evidence:async({png,...metadata})=>{await writeFile(path.join(out,`checkbox-${name.toLowerCase()}.png`),png);record.evidence.push(metadata);}}));
    }
    assert.equal(record.evidence.length,4);assert(record.edits.every(edit=>edit.afterChecked===edit.requestedChecked));
    record.finalInput=await input(page);assert.deepEqual(record.finalInput,expectedCandidate(initial),'Complete React-controlled scenario must equal exact approved edit');
    record.finalInputSha256=sha(JSON.stringify(record.finalInput));record.status='passed';await context.close();await save();
  }
  async function negative(name,prepare,expectedCode){
    const {context,page}=await fresh(name);await prepare(page);const before=await input(page);
    const record={name,status:'running',expectedCode,stages:[],evidenceCount:0,before:await diagnostics(page,labelFor('Battery'))};receipt.cases.push(record);
    let caught;
    try{await setRecordedCheckbox({page,label:labelFor('Battery'),checked:false,bounded,maximumMilliseconds:2_000,onStage:stage=>record.stages.push(stage),evidence:async()=>{record.evidenceCount++;}});}catch(error){caught=error;record.error={name:error.name,message:error.message};}
    assert(caught,`${name}: helper must refuse`);assert.equal(caught.message,expectedCode);
    assert.equal(record.evidenceCount,0);assert(!record.stages.some(stage=>stage.endsWith('-setChecked')),'Guard must refuse before native action');
    assert.deepEqual(await input(page),before,'Refusal must preserve actual React input');record.status='passed';await context.close();await save();
  }
  await negative('missing-checkbox',async()=>{},'checkbox-cardinality-not-one');
  await negative('closed-details',async page=>{const editor=await configureFourth(page);await editor.locator(':scope > summary').click();},'checkbox-details-closed');
  await negative('disabled-fieldset',async page=>{await configureFourth(page);await page.getByRole('button',exact('Disable fixture controls')).click();},'checkbox-disabled');
  await negative('blocked-pointer',async page=>{await configureFourth(page);await page.getByRole('button',exact('Block fixture pointer')).click();},'checkbox-not-hit-target');
  assert.deepEqual(receipt.externalOrNonGetRequests,[]);assert.deepEqual(receipt.pageErrors,[]);
  receipt.status='passed';await save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.map(({name,status})=>({name,status})),applicationRequests:0,productTakes:0,voiceCalls:0}));
}catch(error){receipt.status='failed';receipt.error={name:error.name,message:error.message};await save();throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
