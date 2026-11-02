/** Offline only: exercise the actual recorder and Run preparation, then inspect decoded pixels. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

if(process.argv.includes('--help')){
  console.log('Hosted CI offline recorder paint check. node tools/pitch/check-capture-paint.mjs --out .runtime/pitch-paint\nNo product, provider, voice or external browser access.');
  process.exit(0);
}
assert.equal(process.env.CI,'true','Hosted CI only');
const at=process.argv.indexOf('--out');assert(at>=0&&process.argv[at+1]);
const out=path.resolve(process.argv[at+1]);await mkdir(path.dirname(out),{recursive:true});await mkdir(out,{recursive:false});
const here=path.dirname(fileURLToPath(import.meta.url));
const helper=path.join(here,'capture-state.mjs'),recorder=path.join(here,'fixtures/capture_app.mjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireIdleBeforeOutcome(bytes){
  assert(bytes.length>3*25&&bytes.length%3===0,'Incomplete source pixel decode');
  let greenRun=0,longestGreenRun=0,firstPurple=null,lastGreen=null;
  for(let f=0;f<bytes.length/3;f++){
    const [r,g,b]=bytes.subarray(f*3,f*3+3);const green=r<40&&g>160&&b>45&&b<130,purple=r>130&&g<40&&b>155;
    if(purple&&firstPurple===null)firstPurple=f;
    if(green&&firstPurple===null){greenRun++;lastGreen=f;longestGreenRun=Math.max(longestGreenRun,greenRun);}else greenRun=0;
  }
  assert(firstPurple!==null,'No actual Run outcome pixels');assert(longestGreenRun>=20,'No contiguous0.8s of actual idle Run pixels before trigger');assert(lastGreen<firstPurple);
  return{frames:bytes.length/3,longestGreenRun,firstPurple,lastGreen,idleBeforeOutcome:true};
}
const receipt={status:'running',scope:'OFFLINE_SYNTHETIC_RECORDER_FIXTURE_NOT_PRODUCT_FOOTAGE',applicationRequests:0,productTakes:0,voiceCalls:0,helperSha256:hash(await readFile(helper)),recorderSha256:hash(await readFile(recorder))};
const save=()=>writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n','utf8');
await save();
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b1220;color:white;font:24px sans-serif}.topbar{position:fixed;top:0;height:64px;width:100%;background:#091019;z-index:1}main{padding:100px 120px}.fields{height:2200px;background:#442222}button{display:block;width:500px;height:100px;background:rgb(0,204,85);color:black;border:0;font:32px sans-serif}#result{height:160px}</style><div class="topbar">OFFLINE FIXTURE</div><main><div class="fields"><label>Fixture duration<input id="duration" value="120"></label></div><span data-testid="capacity-status" data-state="not_run">Not run</span><button data-testid="capacity-run" aria-label="Run paired comparison">Run paired comparison</button><div id="result"></div></main><script>document.querySelector('button').onclick=()=>{const b=document.querySelector('button');b.disabled=true;b.style.background='rgb(170,0,204)';b.textContent='Evaluating';setTimeout(()=>document.querySelector('#result').textContent='Offline result ready',300);};</script>`;
const server=createServer((req,res)=>{if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/';
const fixture=path.join(out,'driver.mjs');
await writeFile(fixture,`import {prepareRunPaint} from ${JSON.stringify(pathToFileURL(helper).href)};\nimport {writeFile} from 'node:fs/promises';\nimport path from 'node:path';\nexport default async({page,context,url,out,mark})=>{let external=0;await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin&&route.request().method()==='GET')return route.continue();external++;return route.abort();});await page.goto(url);await page.locator('#duration').fill('60');const bounded=async(fn,ms)=>{let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('fixture-bounded-timeout')),ms))]);}finally{clearTimeout(timer);}};await prepareRunPaint({page,shotId:'S4',expectedState:'not_run',bounded,evidence:async({png,...metadata})=>{await writeFile(path.join(out,'prepared.png'),png);await writeFile(path.join(out,'prepared.json'),JSON.stringify(metadata,null,2)+'\\n','utf8');}});mark('fixture-idle-ready');await new Promise(r=>setTimeout(r,1200));mark('fixture-run-click');await page.getByTestId('capacity-run').click();await page.getByText('Offline result ready',{exact:true}).waitFor();await new Promise(r=>setTimeout(r,1200));if(external)throw new Error('fixture-external-request');};\n`,'utf8');
const capture=path.join(out,'capture');const profile=path.join(out,'profile');
const args=[recorder,'record','--url',url,'--driver',fixture,'--headless','--size','1536x864','--max-seconds','45','--out',capture,'--profile',profile];
// The server remains responsive while the child recorder runs.
try{
  const {spawn}=await import('node:child_process');
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('offline-recorder-deadline'));},60_000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
  await writeFile(path.join(out,'capture.log'),log,'utf8');assert.equal(exit,0,'Actual offline recorder failed');
  const {readdir}=await import('node:fs/promises');
  const raw=path.join(capture,'video',(await readdir(path.join(capture,'video'))).find(x=>x.endsWith('.webm')));
  const probe=spawnSync('ffprobe',['-v','error','-show_streams','-of','json',raw],{encoding:'utf8',timeout:10_000});
  assert.equal(probe.status,0);const streams=JSON.parse(probe.stdout).streams;
  assert.equal(streams.length,1);assert.equal(streams[0].r_frame_rate,'25/1');assert.equal(streams[0].width,1536);assert.equal(streams[0].height,864);
  const prepared=JSON.parse(await readFile(path.join(capture,'prepared.json'),'utf8'));
  const geometry=prepared.geometry;
  const x=Math.floor(geometry.x+geometry.width*.1),y=Math.floor(geometry.y+geometry.height*.5);
  const decoded=spawnSync('ffmpeg',['-v','error','-i',raw,'-vf',`crop=2:2:${x}:${y},scale=1:1,format=rgb24`,'-f','rawvideo','pipe:1'],{maxBuffer:1024*1024,timeout:30_000});
  assert.equal(decoded.status,0,'Source pixel decode failed');
  const pixels=requireIdleBeforeOutcome(decoded.stdout);
  // Exercise the same gate against the actual observed outcome followed by idle.
  const noIdle=decoded.stdout.subarray(pixels.firstPurple*3);
  assert.throws(()=>requireIdleBeforeOutcome(noIdle),/No contiguous0.8s/);
  const wrongOrder=Buffer.concat([noIdle,decoded.stdout]);
  assert.throws(()=>requireIdleBeforeOutcome(wrongOrder),/No contiguous0.8s/);
  receipt.status='pass';receipt.rawSha256=hash(await readFile(raw));receipt.prepared=prepared;receipt.decoded=pixels;receipt.negativeControls={missingIdleRejected:true,outcomeBeforeIdleRejected:true};receipt.externalRequests=0;
}catch(error){receipt.status='fail';receipt.error=error.message;throw error;}
finally{await save();server.close();spawnSync(process.execPath,[recorder,'cleanup','--profile',profile],{timeout:15_000,stdio:'ignore'});}
console.log('PASS actual offline recorder: prepared idle Run pixels precede actual evaluating pixels. No product requests.');
