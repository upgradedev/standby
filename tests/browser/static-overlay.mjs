/** Optional hosted-CI candidate UI. API, Cognito and maps remain actual services. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export async function prepareCandidateUI(base) {
  const directory=process.env.STANDBY_UI_DIST;
  if(!directory)return async()=>{};
  assert.equal(process.env.CI,'true','Candidate UI overlays run in hosted CI only.');
  assert.equal(base,'https://d34x1513u5u1qs.cloudfront.net','Candidate UI is bound to the approved app origin.');
  const source=process.env.STANDBY_UI_SOURCE??process.env.GITHUB_SHA;
  assert.match(source??'',/^[a-f0-9]{40}$/,'Candidate UI needs an exact source SHA.');
  const files=new Map(),dist=path.resolve(directory);
  async function visit(folder,prefix=''){
    for(const item of await readdir(folder,{withFileTypes:true})){
      const key=`${prefix}/${item.name}`,filename=path.join(folder,item.name);
      if(item.isDirectory())await visit(filename,key);
      else if(item.isFile())files.set(key,filename);
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
  console.log(JSON.stringify({candidateUI:source,mode:'static overlay only; live API/Cognito/maps and unchanged CSP',cspSha256:createHash('sha256').update(csp).digest('hex')}));
  return async context=>{
    await context.route(base+'/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'||url.pathname==='/config.json'||url.pathname.startsWith('/api/'))return route.continue();
      const document=request.isNavigationRequest()&&routes.has(url.pathname);
      const filename=document?files.get('/index.html'):files.get(url.pathname);
      if(!filename||(!document&&request.resourceType()==='document'))return route.continue();
      return route.fulfill({status:200,headers:{...headers,'content-type':mime[path.extname(filename)]??'application/octet-stream','cache-control':'no-store'},body:await readFile(filename)});
    });
  };
}
