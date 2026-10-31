#!/usr/bin/env node
/** Review sealed deterministic scenes in hosted CI. Never opens the application. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

if(process.argv.includes('--help')){
  console.log('Usage: node tools/pitch/scene-review.mjs --project <sealed CI temp folder>\nHosted CI only. Produces half-scale scene previews, contact sheets and geometry/determinism/negative-control receipts. No app, capture, audio or release build.');
  process.exit(0);
}
const position=process.argv.indexOf('--project');
if(position<0||!process.argv[position+1]||process.env.GITHUB_ACTIONS!=='true')throw new Error('A sealed project and hosted CI are required');
const project=path.resolve(process.argv[position+1]);
const temp=path.resolve(process.env.RUNNER_TEMP);
if(!project.startsWith(temp+path.sep))throw new Error('Project must be outside the checkout in CI temp');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const config=JSON.parse(await fs.readFile(path.join(project,'scene-review.json'),'utf8'));
const timeline=JSON.parse(await fs.readFile(path.join(project,'timeline.json'),'utf8'));
if(config.mode!=='SCENE_REVIEW_ONLY_NO_RELEASE'||config.live_capture_allowed!==false||config.network_allowed!==false)throw new Error('Unexpected review scope');
if(config.width!==1920||config.height!==1080||config.fps!==25||config.jobs.length!==4)throw new Error('Unexpected scene contract');
const out=path.join(project,'out','scene-review');
await fs.mkdir(out,{recursive:true});
const receipt={mode:'SCENE_REVIEW_ONLY_NOT_A_RELEASE',sourcePlanSha256:config.source_plan_sha256,status:'running',scenes:[],overlays:[],negativeControls:[],captures:0,paidCalls:0,networkAllowed:false};
const digest=value=>createHash('sha256').update(value).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const writeReceipt=()=>fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const run=(command,args,expected=0)=>{
  const result=spawnSync(command,args,{cwd:project,env:process.env,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
  check(!result.error&&result.status===expected,'Subprocess did not return expected status: '+path.basename(args[0]||command));
  return result;
};
const urlFor=render=>{
  const index=render.indexOf('?');
  check(index>0,'Missing scene query');
  const relative=render.slice(0,index),query=render.slice(index+1);
  check(/^scenes\/(S1|S3|S8|S9|overlays)\.html$/.test(relative)&&!render.includes('{{'),'Unexpected scene path/token');
  const params=new URLSearchParams(query);
  check([...params.keys()].length===new Set(params.keys()).size,'Duplicate query key');
  const url=pathToFileURL(path.join(project,relative));url.search=query;
  return url.href;
};
let browser;
try{
  for(const [command,args] of [['node',['scripts/render_scene.mjs','--help']],['python',['scripts/contact_sheet.py','--help']],['python',['scripts/check_timing.py','--help']],['python',['scripts/compose.py','--help']]])run(command,args);
  const timing=run('python',['scripts/check_timing.py','--narration','narration.json','--timeline','timeline.json']);
  check((timing.stdout.match(/FIT \(estimate\)/g)||[]).length===9,'All nine estimate windows must fit');
  await fs.writeFile(path.join(out,'timing-estimates.txt'),timing.stdout);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const page=await context.newPage();
  let blocked=[],errors=[];
  await page.route('**/*',route=>{
    const scheme=new URL(route.request().url()).protocol;
    if(['file:','data:','blob:','about:'].includes(scheme))return route.continue();
    blocked.push(scheme);return route.abort();
  });
  page.on('pageerror',error=>errors.push(error.name));
  for(const job of config.jobs){
    check(['S1','S3','S8','S9'].includes(job.id)&&job.scale===0.5,'Unexpected scene job');
    blocked=[];errors=[];
    await page.goto(urlFor(job.render));
    await page.waitForFunction(()=>window.READY===true,null,{timeout:10000});
    check(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').length)===0,'Free-running animation');
    const times=[1.5,Math.max(2,job.duration*0.7),1.5];
    const hashes=[];
    for(const time of times){
      await page.evaluate(value=>window.seek(value),time);
      hashes.push(digest(await page.screenshot()));
    }
    check(hashes[0]===hashes[2],'Seek is not deterministic: '+job.id);
    const snapshots=[];
    for(const time of [0,0.5,job.duration/2,job.duration-0.1]){
      await page.evaluate(value=>window.seek(value),time);
      const snapshot=await page.evaluate(({label,lines})=>{
        const shown=node=>{
          for(let element=node.parentElement;element;element=element.parentElement){const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<=0.001)return false;}
          return true;
        };
        const texts=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())){
          if(!node.nodeValue.trim()||node.parentElement.closest('script,style')||!shown(node))continue;
          const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();
          if(rect.width&&rect.height)texts.push({text:node.nodeValue.trim(),x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom});
        }
        const proof=document.getElementById('proof')||document.getElementById('label');
        const r=proof?.getBoundingClientRect();
        return {duration:window.DURATION,labelText:proof?.textContent,labelBox:r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom}:null,texts,allLinesVisible:lines.every(line=>texts.some(text=>text.text===line)),labelVisible:texts.some(text=>text.text===label)};
      },{label:job.label,lines:job.lines});
      check(snapshot.duration===job.duration&&snapshot.labelText===job.label&&snapshot.labelVisible,'Permanent label/duration mismatch: '+job.id);
      check(Math.abs(snapshot.labelBox.x-24)<1&&Math.abs(snapshot.labelBox.y-24)<1,'Proof label moved: '+job.id);
      check(snapshot.texts.every(text=>text.x>=-1&&text.y>=-1&&text.right<=1921&&text.bottom<=901),'Text escaped safe area: '+job.id);
      check(snapshot.texts.every(text=>[job.label,...job.lines].includes(text.text)),'Unapproved visible text: '+job.id);
      snapshots.push({time,...snapshot});
    }
    check(snapshots.at(-1).allLinesVisible,'Final authored line missing: '+job.id);
    if(job.id==='S9'){
      await page.evaluate(value=>window.seek(value),job.duration-1.9);const held=digest(await page.screenshot());
      await page.evaluate(value=>window.seek(value),job.duration-0.1);check(held===digest(await page.screenshot()),'Closing hold is not static');
    }
    await page.screenshot({path:path.join(out,job.id+'-final.png')});
    check(blocked.length===0&&errors.length===0,'Scene browser requested network or raised pageerror: '+job.id);
    const preview=path.join(out,job.id+'-preview.mp4');
    run('node',['scripts/render_scene.mjs',job.render,preview,'--fps','25','--scale','0.5']);
    const record=JSON.parse(await fs.readFile(preview.replace('.mp4','.json'),'utf8'));
    check(record.blocked_requests===0,'Renderer blocked an unexpected network request: '+job.id);
    const sheet=path.join(out,job.id+'-contact.jpg');
    run('python',['scripts/contact_sheet.py',preview,'--at',job.keyframes.join(','),'--out',sheet]);
    receipt.scenes.push({id:job.id,seekHashes:hashes,snapshots,preview:path.basename(preview),renderRecord:record,contact:path.basename(sheet),status:'pass'});
    await writeReceipt();
  }
  // Deliberately omit just one required parameter; retain all other raw query bytes.
  const control=config.jobs[0];
  const [scene,query]=control.render.split('?');
  const invalid=scene+'?'+query.split('&').filter(pair=>decodeURIComponent(pair.split('=')[0])!=='label').join('&');
  const badFile=path.join(out,'negative-missing-label.mp4');
  const negative=run('node',['scripts/render_scene.mjs',invalid,badFile,'--scale','0.5','--to','0.2','--timeout-ready','1000'],1);
  check(!(await fs.stat(badFile.replace('.mp4','.json')).catch(()=>null)),'Failed render left a matching record');
  receipt.negativeControls.push({name:'missing required label',failedAsExpected:true,exit:negative.status,renderRecordExists:false});
  // The guard must actually intercept an attempted external request.
  const fixture=path.join(out,'network-negative.html');
  await fs.writeFile(fixture,'<!doctype html><img src="https://scene-network.invalid/blocked"><script>window.READY=true;</script>');
  blocked=[];await page.goto(pathToFileURL(fixture).href);await page.waitForLoadState('load');
  check(blocked.length===1,'Network negative control never exercised the abort path');
  receipt.negativeControls.push({name:'external request abort',blocked:blocked.length,status:'pass'});
  // Resolve overlay token values using the canonical copied composer function.
  const resolveCode="import importlib.util,json,pathlib; p=pathlib.Path('scripts/compose.py'); s=importlib.util.spec_from_file_location('composer',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); t=json.loads(pathlib.Path('timeline.json').read_text()); print(json.dumps([{**o,'render':m.fill_query(o['render'],t['values'])} for o in t['overlays']]))";
  const overlays=JSON.parse(run('python',['-c',resolveCode]).stdout);
  for(const kind of ['chip','count-band']){
    const overlay=overlays.find(item=>new URLSearchParams(item.render.split('?')[1]).get('kind')===kind);
    check(overlay,'Missing overlay kind: '+kind);blocked=[];errors=[];
    await page.goto(urlFor(overlay.render));await page.waitForFunction(()=>window.READY===true,null,{timeout:10000});
    await page.evaluate(()=>window.seek(0.5));
    const geometry=await page.evaluate(()=>({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,item:(()=>{const element=document.querySelector('#root > div'),r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};})()}));
    check(geometry.html==='rgba(0, 0, 0, 0)'&&geometry.body==='rgba(0, 0, 0, 0)','Overlay background is not transparent');
    check(geometry.item.x>=0&&geometry.item.right<=1920&&geometry.item.y>=0&&geometry.item.bottom<=1080&&geometry.item.scrollWidth<=geometry.item.clientWidth,'Overlay overflows its reserved area');
    if(kind==='count-band')check(geometry.item.x===240&&geometry.item.y===905&&geometry.item.width===1440&&geometry.item.height===40,'Count band left the caption-safe rectangle');
    check(blocked.length===0&&errors.length===0,'Overlay network/page error');
    await page.screenshot({path:path.join(out,'overlay-'+kind+'.png'),omitBackground:true});
    const output=path.join(out,'overlay-'+kind+'-preview.mov');
    run('node',['scripts/render_scene.mjs',overlay.render,output,'--alpha','--scale','0.5','--to','2']);
    const record=JSON.parse(await fs.readFile(output.replace('.mov','.json'),'utf8'));check(record.blocked_requests===0,'Overlay requested network');
    receipt.overlays.push({kind,geometry,status:'pass',previewOnly:true});
  }
  await context.close();await browser.close();browser=undefined;
  const strict=run('python',['scripts/compose.py','--timeline','timeline.json','--strict','--dry-run'],1);
  const expectedProblems=[
    ...Array.from({length:9},(_,index)=>`narration S${index+1}: audio/S${index+1}.mp3 is missing, so this segment would be silent`),
    ...['S1','S3','S8','S9'].map(id=>`${id}: rendered/${id}.mp4 not rendered yet`),
    ...['S2','S4','S5','S6','S7'].map(id=>`${id}: clip live/${id}.mp4 not found`),
    ...['S2-live','S4-live','S4-count','S5-live','S5-count','S6-live','S6-count','S7-live','S7-count'].map(id=>`overlay rendered/${id}.mov not found; shown without it`),
    'captions file captions.ass not found (run make_captions.py)',
  ];
  const actualProblems=[...strict.stderr.matchAll(/^\s*\d+\. (.+)$/gm)].map(match=>match[1].trim());
  check(strict.stdout.trim()===''&&!/Traceback|^\s*(?:ERROR|Error):/m.test(strict.stderr)&&strict.stderr.includes(`--strict refuses this build: ${expectedProblems.length} problem(s)`)&&strict.stderr.includes('dry run: nothing encoded'),'Composer did not complete the expected strict dry run');
  check(actualProblems.length===expectedProblems.length&&new Set(actualProblems).size===expectedProblems.length&&expectedProblems.every(problem=>actualProblems.includes(problem)),'Strict dry run did not report exactly the missing voice, capture, captions and release renders');
  await fs.writeFile(path.join(out,'strict-release-blockers.txt'),strict.stdout+'\n'+strict.stderr);
  receipt.negativeControls.push({name:'strict release refuses all unproduced inputs',failedAsExpected:true,exit:strict.status,expectedProblems:expectedProblems.length,actualProblems:actualProblems.length});
  receipt.strictRelease='BLOCKED_AS_EXPECTED_MISSING_CAPTURE_VOICE_CAPTIONS_AND_RELEASE_RENDERS';
  receipt.status='pass';await writeReceipt();
  console.log('PASS scene review: four deterministic half-scale scenes, overlays and fail-closed negative controls. Not a release.');
}catch(error){
  receipt.status='fail';receipt.errorClass=error.name;receipt.error=error.message;await writeReceipt();
  await browser?.close().catch(()=>{});throw error;
}
