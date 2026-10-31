/** Optional hosted-CI candidate UI. API, Cognito and maps remain actual services. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export async function prepareCandidateUI(base) {
  const directory=process.env.STANDBY_UI_DIST;
  if(!directory)return async()=>({assertHealthy(){}});
  assert.equal(process.env.CI,'true','Candidate UI overlays run in hosted CI only.');
  assert.equal(base,'https://d34x1513u5u1qs.cloudfront.net','Candidate UI is bound to the approved app origin.');
  const source=process.env.STANDBY_UI_SOURCE??process.env.GITHUB_SHA;
  assert.match(source??'',/^[a-f0-9]{40}$/,'Candidate UI needs an exact source SHA.');
  const files=new Map(),dist=path.resolve(directory);
  let totalBytes=0;
  async function visit(folder,prefix=''){
    for(const item of await readdir(folder,{withFileTypes:true})){
      const key=`${prefix}/${item.name}`,filename=path.join(folder,item.name);
      if(item.isDirectory())await visit(filename,key);
      else if(item.isFile()){
        const bytes=await readFile(filename);totalBytes+=bytes.length;
        assert.ok(bytes.length<=8*1024*1024&&totalBytes<=32*1024*1024&&files.size<200,'Candidate static assets exceed the bounded overlay.');
        files.set(key,bytes.toString('base64'));
      }
    }
  }
  await visit(dist);
  assert.ok(files.has('/index.html')&&files.has('/theme.js'),'Build the candidate UI first.');
  const response=await fetch(base+'/',{redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,'The live judge URL must be ready.');
  const csp=response.headers.get('content-security-policy');
  assert.ok(csp&&/script-src 'self'(;|$)/.test(csp),'Live restrictive CSP must be present.');
  await response.arrayBuffer();
  const headers={};
  for(const name of ['content-security-policy','referrer-policy','strict-transport-security','x-content-type-options','x-frame-options','cross-origin-opener-policy','cross-origin-resource-policy','permissions-policy'])if(response.headers.has(name))headers[name]=response.headers.get(name);
  const routes=new Set(['/','/overview','/incidents','/capacity','/queues','/map','/settings','/auth/callback']);
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
  const assets=[...files.keys()].filter(key=>key!=='/index.html'&&key!=='/config.json'&&!key.startsWith('/api/')&&mime[path.extname(key)]);
  assert.ok(assets.every(key=>/^\/[A-Za-z0-9_./-]+$/.test(key)),'Candidate static paths contain unsupported pattern characters.');
  console.log(JSON.stringify({candidateUI:source,mode:'Chromium CDP static overlay only; live API/Cognito/maps and unchanged CSP',cspSha256:createHash('sha256').update(csp).digest('hex')}));
  return async(context,page)=>{
    assert.ok(page&&page.context()===context,'Install the overlay on its page before navigation.');
    assert.equal(context.browser()?.browserType().name(),'chromium','Candidate redirect overlays require Chromium.');
    const session=await context.newCDPSession(page),errors=new Set();
    let closed=false;
    session.on('close',()=>{closed=true;});
    page.once('close',()=>{closed=true;});
    const failure=code=>{
      if(closed||errors.has(code))return;
      errors.add(code);
      process.exitCode=1;
      // Fixed codes only: CDP exceptions can contain OAuth URLs or request details.
      console.error(JSON.stringify({candidateOverlayError:code}));
    };
    const handle=async event=>{
      let phase='invalid-paused-request';
      try{
        const {requestId,request,resourceType}=event;
        if(typeof requestId!=='string'||typeof request?.url!=='string')throw new Error('invalid-event');
        const url=new URL(request.url);
        const excluded=url.origin!==base||request.method!=='GET'||url.pathname==='/config.json'||url.pathname==='/api'||url.pathname.startsWith('/api/');
        const document=!excluded&&resourceType==='Document'&&routes.has(url.pathname);
        const key=document?'/index.html':!excluded&&resourceType!=='Document'&&assets.includes(url.pathname)?url.pathname:null;
        if(!key){
          phase='continue-request';
          await session.send('Fetch.continueRequest',{requestId});
          return;
        }
        // A local/protocol failure must never fall back to an older live UI bundle.
        if(errors.size)throw new Error('overlay-already-failed');
        phase='fulfill-static-request';
        const responseHeaders=Object.entries({...headers,'content-type':mime[path.extname(key)]??'application/octet-stream','cache-control':'no-store','x-standby-qa-source':source}).map(([name,value])=>({name,value}));
        await session.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders,body:files.get(key)});
      }catch{
        failure(phase);
        if(!closed&&typeof event.requestId==='string')await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'}).catch(()=>{});
      }
    };
    session.on('Fetch.requestPaused',event=>{void handle(event);});
    // Fetch reports subsequent redirect requests individually. No auth handling,
    // response-stage interception, header overrides or API request patterns are used.
    // https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Fetch.pdl
    try{
      await session.send('Fetch.enable',{handleAuthRequests:false,patterns:[
        {urlPattern:base+'/*',resourceType:'Document',requestStage:'Request'},
        ...assets.map(key=>({urlPattern:base+key+'*',requestStage:'Request'})),
      ]});
    }catch{
      failure('enable-fetch');
      await session.detach().catch(()=>{});
      throw new Error('candidate-overlay-setup-failed');
    }
    return {assertHealthy(){
      if(errors.size)throw new Error('candidate-overlay-protocol-error');
      if(closed)throw new Error('candidate-overlay-session-closed');
    }};
  };
}
