/** Real Hosted UI + PKCE acceptance against a disposable, owner-provisioned workspace.
 * Inputs are supplied by hosted CI only. No credentials, JWTs, response bodies,
 * traces, screenshots, videos or storage-state files are emitted or retained.
 * The coordinator creates and removes the synthetic identities and workspace.
 */
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';

let step='initialization',browser;
const contexts=[];
const check=(condition,code)=>{if(!condition) throw new Error(code);};
const exact=(name)=>({name,exact:true});
const roles=['Analyst','Planner','Admin'];
const runId=randomUUID().slice(0,12);

async function visible(locator,code) {
  await locator.waitFor({state:'visible',timeout:25_000});
  check(await locator.isVisible(),code);
}
function parseIdentities() {
  let identities;
  try {identities=JSON.parse(process.env.STANDBY_TEST_IDENTITIES??'null');}
  catch {throw new Error('identities-env-invalid');}
  check(Array.isArray(identities)&&identities.length===3,'identities-env-invalid');
  for(const role of roles) {
    check(identities.filter(value=>value?.role===role).length===1,'identity-roles-invalid');
    const identity=identities.find(value=>value.role===role);
    check(typeof identity.username==='string'&&identity.username.length>0&&typeof identity.password==='string'&&identity.password.length>0,
      'identity-credentials-missing');
    check(typeof identity.workspaceId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(identity.workspaceId),'identity-workspace-invalid');
  }
  check(new Set(identities.map(value=>value.workspaceId)).size===1,'test-workspace-must-be-shared');
  return identities;
}
async function api(actor,method,path,{data,headers={},token=actor.accessToken,status=200}={}) {
  const response=await actor.context.request.fetch(`${actor.apiBase}${path}`,{
    method,timeout:30_000,failOnStatusCode:false,
    headers:{Accept:'application/json',...(data===undefined?{}:{'Content-Type':'application/json'}),
      ...(token?{Authorization:`Bearer ${token}`} :{}),...headers},
    ...(data===undefined?{}:{data:typeof data==='string'?data:JSON.stringify(data)}),
  });
  const expected=Array.isArray(status)?status:[status];
  check(expected.includes(response.status()),'protected-api-unexpected-status');
  const responseHeaders=response.headers(),value=await response.json();
  if(response.ok()) check(responseHeaders['cache-control']?.includes('no-store'),'protected-response-cacheable');
  await response.dispose();
  return value;
}
async function navigate(actor,label,heading=label) {
  const link=actor.page.getByRole('navigation',exact('Main navigation')).getByRole('link',{name:new RegExp(`^${label}(?:,|$)`)});
  await link.click();
  await visible(actor.page.getByRole('heading',exact(heading)),'authorized-page-heading-missing');
}
function decodeJwtPayload(token) {
  try {return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}
  catch {throw new Error('real-jwt-payload-invalid');}
}
async function signIn(identity,base) {
  step=`${identity.role}:hosted-ui-login`;
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(20_000);
  const errors=[];page.on('pageerror',()=>errors.push('uncaught-runtime-error'));
  const document=await page.goto(`${base}/settings`,{waitUntil:'domcontentloaded',timeout:45_000});
  check(document?.status()===200,'operator-entry-not-200');
  const response=await context.request.get(`${base}/config.json`);
  check(response.status()===200,'auth-config-not-200');
  const config=await response.json();await response.dispose();
  check(config.auth?.domain&&config.auth?.clientId,'auth-config-missing');
  if(process.env.STANDBY_EXPECTED_RELEASE) check(config.release===process.env.STANDBY_EXPECTED_RELEASE,'auth-release-mismatch');
  const authDomain=new URL(config.auth.domain.startsWith('https://')?config.auth.domain:`https://${config.auth.domain}`);
  check(authDomain.protocol==='https:'&&authDomain.hostname.endsWith('.amazoncognito.com'),'identity-provider-host-unexpected');
  const apiBase=new URL(config.apiBase.replace(/\/$/,'')+'/',base+'/').href.replace(/\/$/,'');
  check(new URL(apiBase).protocol==='https:','api-must-use-https');
  await visible(page.getByRole('heading',exact('Settings')),'operator-entry-settings-missing');

  // Observe the application's own token exchange and membership fetch. Neither is mocked.
  const tokenResponsePromise=page.waitForResponse(value=>new URL(value.url()).hostname===authDomain.hostname&&
    new URL(value.url()).pathname==='/oauth2/token'&&value.request().method()==='POST',{timeout:60_000}).catch(()=>null);
  const workspaceResponsePromise=page.waitForResponse(value=>value.url()===`${apiBase}/workspaces`&&value.request().method()==='GET',
    {timeout:60_000}).catch(()=>null);
  await page.locator('.user-menu summary').click();
  await page.locator('.user-dropdown').getByRole('button',exact('Operator sign in')).click();
  await page.waitForURL(url=>url.hostname===authDomain.hostname,{timeout:30_000});
  const authorization=new URL(page.url());
  check(authorization.searchParams.get('response_type')==='code'&&authorization.searchParams.get('code_challenge_method')==='S256',
    'authorization-code-pkce-not-used');
  check(/^[A-Za-z0-9_-]{43}$/.test(authorization.searchParams.get('code_challenge')??''),'pkce-challenge-invalid');
  const requestedScopes=(authorization.searchParams.get('scope')??'').split(/\s+/);
  check(['openid','profile','standby/access'].every(scope=>requestedScopes.includes(scope)),'operator-scope-not-requested');
  // Grounded on the actual Cognito Hosted UI HTML; it contains two responsive forms.
  await page.locator('input[name="username"]:visible').first().fill(identity.username);
  await page.locator('input[name="password"]:visible').first().fill(identity.password);
  await page.locator('input[name="signInSubmitButton"]:visible').first().click();
  const tokenResponse=await tokenResponsePromise;
  check(tokenResponse&&tokenResponse.status()===200,'real-token-exchange-failed');
  const token=await tokenResponse.json();
  check(typeof token.access_token==='string'&&typeof token.id_token==='string','real-tokens-missing');
  const exchange=new URLSearchParams(tokenResponse.request().postData()??'');
  check(exchange.get('grant_type')==='authorization_code'&&/^[A-Za-z0-9_-]{43,128}$/.test(exchange.get('code_verifier')??''),
    'real-token-exchange-missing-verifier');
  const claims=decodeJwtPayload(token.access_token);
  check(claims.token_use==='access'&&(claims.scope??'').split(/\s+/).includes('standby/access'),'real-access-token-scope-invalid');
  await page.waitForURL(url=>url.origin===new URL(base).origin&&url.pathname==='/overview',{timeout:30_000});
  await page.waitForFunction(()=>{
    try {return typeof JSON.parse(sessionStorage.getItem('standby.auth.v1')??'null')?.accessToken==='string';}
    catch {return false;}
  });
  const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('standby.auth.v1')??'null'));
  check(stored?.accessToken===token.access_token,'app-session-token-mismatch');
  const workspaceResponse=await workspaceResponsePromise;
  check(workspaceResponse&&workspaceResponse.status()===200,'app-membership-request-failed');
  const memberships=await workspaceResponse.json();
  const membership=memberships.workspaces?.find(value=>value.workspaceId===identity.workspaceId);
  check(membership?.role===identity.role,'server-membership-role-mismatch');
  const select=page.getByRole('combobox',exact('Active workspace'));
  await select.locator(`option[value="${identity.workspaceId}"]`).waitFor({state:'attached'});
  await select.selectOption(identity.workspaceId);
  await visible(page.locator('.workspace-mode .badge').filter({hasText:identity.role}),'authorized-workspace-role-not-shown');
  const actor={...identity,context,page,apiBase,accessToken:token.access_token,idToken:token.id_token,errors};
  const workspaces=await api(actor,'GET','/workspaces');
  check(workspaces.workspaces?.some(value=>value.workspaceId===identity.workspaceId&&value.role===identity.role),'workspace-list-inconsistent');
  await api(actor,'GET',`/workspaces/${identity.workspaceId}/plans`);
  await navigate(actor,'Planning queues');
  await visible(page.getByText('Authorized workspace plans',{exact:true}),'workspace-queue-scope-missing');
  if(identity.role==='Analyst') {
    check(await page.getByRole('button',exact('Create workspace plan')).count()===0,'analyst-sees-plan-write-menu');
    await visible(page.getByText('Analyst · read only',{exact:true}),'analyst-read-only-label-missing');
  } else await visible(page.getByRole('button',exact('Create workspace plan')),'planner-write-menu-missing');
  console.log(`PASS real Cognito sign-in and workspace UI: ${identity.role}`);
  return actor;
}
async function assertAccessBoundaries(actor) {
  step=`${actor.role}:server-authorization`;
  await api(actor,'GET','/workspaces',{token:null,status:401});
  await api(actor,'GET','/workspaces',{token:actor.idToken,status:[401,403]});
  await api(actor,'GET',`/workspaces/forbidden-${runId}/plans`,{status:403});
}
function assertTrustedEvaluation(plan) {
  check(plan.evaluationStatus==='SUCCEEDED'&&plan.reviewStatus==='NEEDS_REVIEW'&&plan.version>=2,'saved-evaluation-state-invalid');
  const result=plan.result;
  check(result&&result.inputHash===plan.inputHash&&result.configHash===plan.configHash&&typeof plan.resultHash==='string',
    'saved-evaluation-provenance-missing');
  check(result.solver?.selectionCohort==='train'&&result.solver.method==='exhaustive-enumeration','saved-evaluation-solver-invalid');
  check(Date.parse(result.matrix.expiresAt)>Date.now(),'saved-evaluation-expired');
  for(const value of Object.values(result.plans)) {
    check(value.totalDemand>0&&value.coveredDemand+value.uncoveredDemand===value.totalDemand,'saved-evaluation-denominator-invalid');
    check(Number.isFinite(value.coveragePct)&&Math.abs(value.coveragePct-value.coveredDemand/value.totalDemand*100)<1e-9,
      'saved-evaluation-metric-invalid');
  }
}

try {
  const identities=parseIdentities();
  const base=process.env.STANDBY_LIVE_URL?.replace(/\/$/,'');
  check(base&&new URL(base).protocol==='https:','live-url-must-use-https');
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const analyst=await signIn(identities.find(value=>value.role==='Analyst'),base);
  await assertAccessBoundaries(analyst);
  const workspaceId=analyst.workspaceId,plansPath=`/workspaces/${workspaceId}/plans`;
  const input={fleetSize:2,thresholdMinutes:15,cohort:'holdout'};
  const denied=await api(analyst,'POST',plansPath,{data:{name:'Analyst permission probe',input},headers:{'Idempotency-Key':randomUUID()},status:403});
  check(denied.code==='FORBIDDEN','analyst-write-denial-not-explicit');
  const initialSettings=await api(analyst,'GET',`/workspaces/${workspaceId}/settings`);
  await api(analyst,'PATCH',`/workspaces/${workspaceId}/settings`,{data:{expectedVersion:initialSettings.settings.version,
    defaultThresholdMinutes:15,maxFleetSize:initialSettings.settings.maxFleetSize,enabledSiteIds:initialSettings.settings.enabledSiteIds},status:403});
  await navigate(analyst,'Settings');
  await analyst.page.getByRole('tab',exact('Workspace')).click();
  await visible(analyst.page.getByText('Read only',{exact:true}),'analyst-settings-read-only-missing');
  check(await analyst.page.getByRole('button',exact('Save workspace defaults')).count()===0,'analyst-sees-settings-save');

  const planner=await signIn(identities.find(value=>value.role==='Planner'),base);
  await assertAccessBoundaries(planner);
  step='Planner:ui-plan-create';
  const uiPlanName=`UI acceptance ${runId}`;
  await planner.page.getByRole('button',exact('Create workspace plan')).click();
  const dialog=planner.page.getByRole('dialog',exact('Create workspace plan'));
  await visible(dialog,'workspace-plan-create-dialog-missing');
  await dialog.getByRole('textbox',exact('Scenario name')).fill(uiPlanName);
  await dialog.getByRole('combobox',exact('Scenario fleet size')).selectOption('2');
  await dialog.getByRole('combobox',exact('Scenario approach threshold')).selectOption('15');
  const creation=planner.page.waitForResponse(value=>value.url()===`${planner.apiBase}${plansPath}`&&value.request().method()==='POST').catch(()=>null);
  await dialog.getByRole('button',exact('Save scenario')).click();
  const createdResponse=await creation;
  check(createdResponse&&createdResponse.status()===201,'ui-plan-save-not-acknowledged');
  const uiPlan=await createdResponse.json();
  check(uiPlan.name===uiPlanName&&uiPlan.workspaceId===workspaceId&&uiPlan.evaluationStatus==='NOT_RUN','ui-plan-save-scope-invalid');
  await dialog.waitFor({state:'hidden'});
  await visible(planner.page.getByRole('heading',exact(uiPlanName)),'ui-plan-not-in-cloud-queue');

  step='Planner:idempotency-and-trusted-evaluation';
  const idempotencyKey=randomUUID(),name=`API acceptance ${runId}`,bytes=JSON.stringify({name,input});
  const saved=await api(planner,'POST',plansPath,{data:bytes,headers:{'Idempotency-Key':idempotencyKey},status:201});
  const repeated=await api(planner,'POST',plansPath,{data:bytes,headers:{'Idempotency-Key':idempotencyKey},status:201});
  check(saved.id===repeated.id&&saved.version===repeated.version,'idempotent-create-created-another-plan');
  const changed=await api(planner,'POST',plansPath,{data:JSON.stringify({name:`${name} changed`,input}),
    headers:{'Idempotency-Key':idempotencyKey},status:409});
  check(changed.code==='IDEMPOTENCY_CONFLICT','idempotency-conflict-not-explicit');
  const path=`${plansPath}/${saved.id}`;
  await api(planner,'POST',`${path}/evaluate`,{data:{expectedVersion:saved.version,coveragePct:100,resultHash:'client-forgery'},status:400});
  const unchanged=await api(planner,'GET',path);
  check(unchanged.version===saved.version&&unchanged.evaluationStatus==='NOT_RUN','forged-result-mutated-plan');
  const evaluated=await api(planner,'POST',`${path}/evaluate`,{data:{expectedVersion:saved.version}});
  assertTrustedEvaluation(evaluated);
  check(evaluated.input.fleetSize===input.fleetSize&&evaluated.result.input.thresholdMinutes===input.thresholdMinutes,'trusted-evaluation-input-mismatch');
  await api(planner,'POST',`${path}/evaluate`,{data:{expectedVersion:saved.version},status:409});
  const hashes={inputHash:evaluated.inputHash,resultHash:evaluated.resultHash,configHash:evaluated.configHash};
  await api(planner,'POST',`${path}/review`,{data:{expectedVersion:evaluated.version,...hashes},status:403});
  const plannerSettings=await api(planner,'GET',`/workspaces/${workspaceId}/settings`);
  await api(planner,'PATCH',`/workspaces/${workspaceId}/settings`,{data:{expectedVersion:plannerSettings.settings.version,
    defaultThresholdMinutes:15,maxFleetSize:plannerSettings.settings.maxFleetSize,enabledSiteIds:plannerSettings.settings.enabledSiteIds},status:403});
  console.log('PASS Planner idempotency, trusted evaluation and server-enforced review denial');

  const admin=await signIn(identities.find(value=>value.role==='Admin'),base);
  await assertAccessBoundaries(admin);
  step='Admin:exact-result-review';
  const wrongReview=await api(admin,'POST',`${path}/review`,{data:{expectedVersion:evaluated.version,...hashes,resultHash:'0'.repeat(64)},status:409});
  check(wrongReview.code==='RESULT_STALE','wrong-hash-review-not-rejected');
  await admin.page.getByRole('tab',{name:/^Needs review/}).click();
  const card=admin.page.locator('article.scenario-card').filter({has:admin.page.getByRole('heading',exact(name))});
  await visible(card,'evaluated-plan-not-in-admin-review-queue');
  await card.getByRole('button',exact('Inspect')).click();
  const details=admin.page.getByRole('dialog',exact(name));
  await visible(details,'admin-plan-detail-missing');
  await visible(details.getByRole('heading',exact('Server-calculated proposal')),'admin-trusted-result-not-visible');
  const reviewResponse=admin.page.waitForResponse(value=>value.url()===`${admin.apiBase}${path}/review`&&value.request().method()==='POST').catch(()=>null);
  await details.getByRole('button',exact('Mark exact result reviewed')).click();
  const reviewedResponse=await reviewResponse;
  check(reviewedResponse&&reviewedResponse.status()===200,'ui-admin-review-not-acknowledged');
  const reviewed=await reviewedResponse.json();
  check(reviewed.reviewStatus==='REVIEWED'&&reviewed.version===evaluated.version+1,'review-state-not-persisted');
  const reviewedAgain=await api(admin,'GET',path);
  check(reviewedAgain.reviewStatus==='REVIEWED'&&reviewedAgain.result&&reviewedAgain.resultHash===hashes.resultHash,'reviewed-result-not-readable');
  await admin.page.keyboard.press('Escape');
  await details.waitFor({state:'hidden'});

  step='Admin:settings-version-and-review-invalidation';
  const settingsPath=`/workspaces/${workspaceId}/settings`,before=await api(admin,'GET',settingsPath);
  const nextThreshold=before.settings.defaultThresholdMinutes===15?20:15;
  await navigate(admin,'Settings');
  await admin.page.getByRole('tab',exact('Workspace')).click();
  await visible(admin.page.getByRole('button',exact('Save workspace defaults')),'admin-settings-write-menu-missing');
  await admin.page.getByLabel('Default road approach threshold',{exact:true}).selectOption(String(nextThreshold));
  const settingsResponse=admin.page.waitForResponse(value=>value.url()===`${admin.apiBase}${settingsPath}`&&value.request().method()==='PATCH').catch(()=>null);
  await admin.page.getByRole('button',exact('Save workspace defaults')).click();
  const changedResponse=await settingsResponse;
  check(changedResponse&&changedResponse.status()===200,'ui-settings-save-not-acknowledged');
  const updated=await changedResponse.json();
  check(updated.settings.version===before.settings.version+1&&updated.settings.defaultThresholdMinutes===nextThreshold&&updated.configHash!==before.configHash,
    'settings-version-or-config-hash-unchanged');
  const staleSettings=await api(admin,'PATCH',settingsPath,{data:{expectedVersion:before.settings.version,
    defaultThresholdMinutes:nextThreshold,maxFleetSize:before.settings.maxFleetSize,enabledSiteIds:before.settings.enabledSiteIds},status:409});
  check(staleSettings.code==='VERSION_CONFLICT','stale-settings-write-not-rejected');
  const stalePlan=await api(admin,'GET',path);
  check(stalePlan.stale===true&&stalePlan.result===null&&stalePlan.reviewStatus==='NOT_READY','settings-change-retained-valid-review');
  await api(admin,'POST',`${path}/review`,{data:{expectedVersion:reviewed.version,...hashes},status:409});
  await navigate(admin,'Planning queues');
  await admin.page.getByRole('tab',{name:/^Draft/}).click();
  const staleCard=admin.page.locator('article.scenario-card').filter({has:admin.page.getByRole('heading',exact(name))});
  await visible(staleCard,'stale-plan-not-in-ui-draft-queue');
  await staleCard.getByRole('button',exact('Inspect')).click();
  const staleDetail=admin.page.getByRole('dialog',exact(name));
  await visible(staleDetail.getByText('No fresh result is available. Re-evaluate this plan before reviewing its coverage.',{exact:true}),
    'stale-plan-ui-reason-missing');
  check(await staleDetail.getByRole('button',exact('Mark exact result reviewed')).count()===0,'stale-plan-can-be-reviewed-in-ui');
  for(const actor of [analyst,planner,admin]) check(actor.errors.length===0,'authenticated-browser-runtime-error');
  console.log('PASS Admin exact-result review, settings CAS and stale-review invalidation');
  console.log('PASS real Cognito authorization acceptance. No credentials, provider payloads or media artifacts retained.');
} catch(error) {
  // Browser/library errors can quote inputs, DOM values and HTTP headers: never print them.
  const symbolic=error instanceof Error&&/^[a-z][a-z-]+$/.test(error.message)?error.message:'browser-action-or-timeout';
  console.error(`FAIL ${step}: ${symbolic}`);process.exitCode=1;
} finally {
  for(const context of contexts) await context.close().catch(()=>{});
  if(browser) await browser.close().catch(()=>{});
}
