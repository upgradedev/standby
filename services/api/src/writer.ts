import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import type {Dataset,EvaluationInput,EvaluationResult,MatrixSnapshot} from '../../../packages/contracts/src/index';
import {evaluateScenario,hashValue,validateEvaluationInput} from '../../../packages/domain/src/index';
import {ApiEvent,HttpError,body,failure,json,loadDataset,loadMatrix,readJson} from './common';
import {Identity,Membership,WorkspaceSettings,authorizeMembership,expectedVersion,identifier,identityFromClaims,objectInput,planName,validateSettings} from './access';

const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const s3=new S3Client({});
const table=()=>process.env.TABLE_NAME!;
type StoredItem = Record<string,unknown>;
interface ResultReference {key:string;hash:string;expiresAt:string;datasetHash:string;matrixHash:string;configHash:string}
interface PlanRecord {
  pk:string;sk:string;id:string;workspaceId:string;name:string;input:EvaluationInput;version:number;
  evaluationStatus:'NOT_RUN'|'SUCCEEDED'|'FAILED';reviewStatus:'NOT_READY'|'NEEDS_REVIEW'|'REVIEWED';
  createdAt:string;updatedAt:string;inputHash?:string;resultHash?:string;configHash?:string;
  resultRef?:ResultReference;failure?:{code:string;message:string;requestId:string};
  reviewedAt?:string;reviewedBy?:string;
}
interface IdempotencyRecord {pk:string;sk:string;requestHash:string;status:number;response:ReturnType<typeof presentPlan>}
const workspaceKey=(workspaceId:string)=>`WORKSPACE#${workspaceId}`;
const planKey=(workspaceId:string,id:string)=>({pk:workspaceKey(workspaceId),sk:`PLAN#${id}`});

async function getItem(key:{pk:string;sk:string}):Promise<StoredItem|undefined> {
  return (await db.send(new GetCommand({TableName:table(),Key:key,ConsistentRead:true}))).Item;
}
async function queryAll(pk:string,prefix:string,max=200):Promise<StoredItem[]> {
  const items:StoredItem[]=[];
  let cursor:Record<string,unknown>|undefined;
  do {
    const result=await db.send(new QueryCommand({TableName:table(),KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues:{':pk':pk,':prefix':prefix},ExclusiveStartKey:cursor,Limit:Math.min(100,max+1-items.length),ConsistentRead:true}));
    items.push(...result.Items??[]);cursor=result.LastEvaluatedKey;
    if(items.length>max || (items.length===max && cursor)) throw new HttpError(422,'WORKSPACE_LIMIT','This workspace exceeds the bounded demo list limit.');
  } while(cursor);
  return items;
}
async function membershipFor(identity:Identity,workspaceId:string,minimum:'Analyst'|'Planner'|'Admin'='Analyst'):Promise<Membership> {
  const membership=await getItem({pk:`USER#${identity.subject}`,sk:`WORKSPACE#${workspaceId}`});
  return authorizeMembership(identity,membership,workspaceId,minimum);
}
async function getPlan(workspaceId:string,id:string):Promise<PlanRecord> {
  const record=await getItem(planKey(workspaceId,id));
  if(!record || record.workspaceId!==workspaceId || record.id!==id) throw new HttpError(404,'NOT_FOUND','The plan does not exist in this workspace.');
  return record as unknown as PlanRecord;
}
async function settingsFor(workspaceId:string,dataset:Dataset):Promise<WorkspaceSettings> {
  const stored=await getItem({pk:workspaceKey(workspaceId),sk:'SETTINGS'});
  if(!stored) return {version:1,defaultThresholdMinutes:15,maxFleetSize:Math.min(4,dataset.sites.length),enabledSiteIds:dataset.sites.map(s=>s.id).sort()};
  const validated=validateSettings({expectedVersion:stored.version,defaultThresholdMinutes:stored.defaultThresholdMinutes,
    maxFleetSize:stored.maxFleetSize,enabledSiteIds:stored.enabledSiteIds},dataset.sites.map(s=>s.id));
  return {version:validated.expectedVersion,defaultThresholdMinutes:validated.defaultThresholdMinutes,maxFleetSize:validated.maxFleetSize,enabledSiteIds:validated.enabledSiteIds};
}
function configurationHash(dataset:Dataset,settings:WorkspaceSettings):string {
  return hashValue({sourceConfigHash:dataset.configHash,workspaceSettingsVersion:settings.version,enabledSiteIds:[...settings.enabledSiteIds].sort(),
    maxFleetSize:settings.maxFleetSize,defaultThresholdMinutes:settings.defaultThresholdMinutes});
}
export function restrictWorkspaceModel(dataset:Dataset,matrix:MatrixSnapshot,settings:WorkspaceSettings):{dataset:Dataset;matrix:MatrixSnapshot} {
  const enabled=new Set(settings.enabledSiteIds);
  if(!enabled.size || enabled.size!==settings.enabledSiteIds.length || settings.maxFleetSize>enabled.size ||
    settings.enabledSiteIds.some(id=>!dataset.sites.some(site=>site.id===id)||!matrix.siteIds.includes(id))) {
    throw new HttpError(503,'INVALID_CONFIGURATION','The workspace configuration does not match the frozen candidate set.');
  }
  const indexes=matrix.siteIds.map((id,index)=>({id,index})).filter(row=>enabled.has(row.id));
  return {dataset:{...dataset,configHash:configurationHash(dataset,settings),sites:dataset.sites.filter(site=>enabled.has(site.id))},
    matrix:{...matrix,siteIds:indexes.map(row=>row.id),durationsSeconds:indexes.map(row=>matrix.durationsSeconds[row.index]!)}};
}
function presentPlan(record:PlanRecord,activeConfigHash?:string,datasetHash?:string,now=Date.now()) {
  const {pk:_pk,sk:_sk,resultRef:_ref,reviewedBy:_actor,...safe}=record;
  const stale=record.evaluationStatus==='SUCCEEDED' && (!record.resultRef || Date.parse(record.resultRef.expiresAt)<=now ||
    !Number.isFinite(Date.parse(record.resultRef.expiresAt)) || (activeConfigHash!==undefined && record.configHash!==activeConfigHash) ||
    (datasetHash!==undefined && record.resultRef.datasetHash!==datasetHash));
  return {...safe,reviewStatus:stale?'NOT_READY' as const:safe.reviewStatus,stale,
    ...(record.resultRef?{resultExpiresAt:record.resultRef.expiresAt}:{})};
}
function audit(workspaceId:string,identity:Identity,action:string,data:Record<string,unknown>) {
  const at=new Date().toISOString();
  return {Put:{TableName:table(),Item:{pk:workspaceKey(workspaceId),sk:`AUDIT#${at}#${randomUUID()}`,action,actor:identity.subject,at,...data},ConditionExpression:'attribute_not_exists(pk)'}};
}
function membershipCondition(identity:Identity,workspaceId:string,minimum:'Planner'|'Admin') {
  return {ConditionCheck:{TableName:table(),Key:{pk:`USER#${identity.subject}`,sk:`WORKSPACE#${workspaceId}`},
    ConditionExpression:minimum==='Admin'?'workspaceId = :workspace AND #role = :admin':'workspaceId = :workspace AND #role IN (:planner, :admin)',
    ExpressionAttributeNames:{'#role':'role'},ExpressionAttributeValues:minimum==='Admin'?{':workspace':workspaceId,':admin':'Admin'}:
      {':workspace':workspaceId,':admin':'Admin',':planner':'Planner'}}};
}
function conflict(error:unknown):boolean {
  const value=error as {name?:string;CancellationReasons?:Array<{Code?:string}>};
  return value?.name==='ConditionalCheckFailedException' || (value?.name==='TransactionCanceledException' &&
    (value.CancellationReasons??[]).some(reason=>reason.Code==='ConditionalCheckFailed'||reason.Code==='TransactionConflict'));
}
function assertPlanVersion(plan:PlanRecord,version:number):void {
  if(plan.version!==version) throw new HttpError(409,'VERSION_CONFLICT','The plan changed. Reload it before trying again.');
}
function idempotencyKey(event:ApiEvent,workspaceId:string,identity:Identity):{pk:string;sk:string} {
  const raw=Object.entries(event.headers??{}).find(([key])=>key.toLowerCase()==='idempotency-key')?.[1];
  if(!raw || !/^[A-Za-z0-9._:-]{8,128}$/.test(raw)) throw new HttpError(400,'INVALID_INPUT','Provide an Idempotency-Key containing 8 to 128 letters, numbers, dots, colons or hyphens.');
  return {pk:workspaceKey(workspaceId),sk:`IDEMPOTENCY#${hashValue({subject:identity.subject,key:raw})}`};
}
function replay(record:StoredItem|undefined,requestHash:string):{status:number;response:unknown}|undefined {
  if(!record) return undefined;
  if(record.requestHash!==requestHash) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','This idempotency key was already used with different request bytes.');
  return {status:record.status as number,response:record.response};
}
async function savePlan(event:ApiEvent,workspaceId:string,identity:Identity,requestId:string) {
  await membershipFor(identity,workspaceId,'Planner');
  const value=objectInput(body(event),['name','input','planId','expectedVersion']);
  const name=planName(value.name),input=validateEvaluationInput(value.input);
  const dataset=await loadDataset(),settings=await settingsFor(workspaceId,dataset);
  if(input.fleetSize>settings.maxFleetSize) throw new HttpError(400,'INVALID_INPUT','Fleet size exceeds this workspace configuration.');
  const key=idempotencyKey(event,workspaceId,identity);
  const requestHash=hashValue({method:event.requestContext.http.method,path:event.rawPath,bytes:event.body,subject:identity.subject});
  const previous=replay(await getItem(key),requestHash);
  if(previous) return json(previous.status,previous.response,requestId);
  const id=value.planId===undefined?randomUUID():identifier(typeof value.planId==='string'?value.planId:undefined,'plan identifier');
  const existing=value.planId===undefined?undefined:await getPlan(workspaceId,id);
  if(existing) assertPlanVersion(existing,expectedVersion(value.expectedVersion));
  else if(value.expectedVersion!==undefined) throw new HttpError(400,'INVALID_INPUT','A new plan must not include expectedVersion.');
  if(!existing) {
    // A bounded demo store protects list/search work without claiming a general-purpose dispatch database.
    const plans=await queryAll(workspaceKey(workspaceId),'PLAN#');
    if(plans.length>=200) throw new HttpError(422,'WORKSPACE_LIMIT','This workspace has reached its demo plan limit.');
  }
  const now=new Date().toISOString();
  const plan:PlanRecord={...planKey(workspaceId,id),id,workspaceId,name,input,version:(existing?.version??0)+1,
    evaluationStatus:'NOT_RUN',reviewStatus:'NOT_READY',createdAt:existing?.createdAt??now,updatedAt:now};
  const response=presentPlan(plan),status=existing?200:201;
  const idempotency:IdempotencyRecord={...key,requestHash,status,response};
  try {
    await db.send(new TransactWriteCommand({TransactItems:[
      {Put:{TableName:table(),Item:plan,ConditionExpression:existing?'#version = :version':'attribute_not_exists(pk)',
        ...(existing?{ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':existing.version}}:{})}},
      {Put:{TableName:table(),Item:idempotency,ConditionExpression:'attribute_not_exists(pk)'}},
      membershipCondition(identity,workspaceId,'Planner'),
      audit(workspaceId,identity,existing?'PLAN_UPDATED':'PLAN_CREATED',{planId:id,version:plan.version,inputDigest:hashValue(input)}),
    ]}));
  } catch(error) {
    if(!conflict(error)) throw error;
    const concurrent=replay(await getItem(key),requestHash);
    if(concurrent) return json(concurrent.status,concurrent.response,requestId);
    throw new HttpError(409,'VERSION_CONFLICT','The plan changed while it was being saved. Reload it before trying again.');
  }
  return json(status,response,requestId);
}
async function resultFor(plan:PlanRecord,configHash:string,datasetHash:string):Promise<EvaluationResult|null> {
  if(presentPlan(plan,configHash,datasetHash).stale || plan.evaluationStatus!=='SUCCEEDED' || !plan.resultRef) return null;
  let cached:{schemaVersion:string;expiresAt:string;result:EvaluationResult};
  try {cached=await readJson(process.env.CACHE_BUCKET!,plan.resultRef.key);}
  catch(error) {
    if(['NoSuchKey','NotFound'].includes((error as {name?:string}).name??'')) return null;
    throw error;
  }
  if(cached.schemaVersion!=='1' || !Number.isFinite(Date.parse(cached.expiresAt)) || Date.parse(cached.expiresAt)<=Date.now() ||
    cached.result.configHash!==configHash || cached.result.datasetHash!==datasetHash || cached.result.inputHash!==plan.inputHash || hashValue(cached.result)!==plan.resultRef.hash) {
    return null;
  }
  return cached.result;
}
async function evaluatePlan(event:ApiEvent,workspaceId:string,id:string,identity:Identity,requestId:string) {
  await membershipFor(identity,workspaceId,'Planner');
  const value=objectInput(body(event),['expectedVersion']);
  const version=expectedVersion(value.expectedVersion),plan=await getPlan(workspaceId,id);
  assertPlanVersion(plan,version);
  const dataset=await loadDataset();
  const settings=await settingsFor(workspaceId,dataset),configHash=configurationHash(dataset,settings);
  if(plan.input.fleetSize>settings.maxFleetSize) throw new HttpError(409,'CONFIGURATION_CHANGED','This plan exceeds the current workspace fleet limit. Edit its inputs first.');
  let result:EvaluationResult,matrix:MatrixSnapshot,resultHash:string,key:string,expiresAt:string;
  try {
    matrix=await loadMatrix();
    const model=restrictWorkspaceModel(dataset,matrix,settings);
    result=evaluateScenario(model.dataset,model.matrix,plan.input,new Date());
    resultHash=hashValue(result);key=`results/${workspaceId}/${id}/${resultHash}.json`;expiresAt=matrix.expiresAt;
    await s3.send(new PutObjectCommand({Bucket:process.env.CACHE_BUCKET!,Key:key,
      Body:JSON.stringify({schemaVersion:'1',expiresAt,result}),ContentType:'application/json',CacheControl:'no-store',ServerSideEncryption:'AES256',
      Metadata:{'expires-at':expiresAt}}));
  }
  catch(error) {
    const code=typeof (error as {code?:unknown}).code==='string'?(error as {code:string}).code:'EVALUATION_FAILED';
    const failed:PlanRecord={...plan,version:version+1,evaluationStatus:'FAILED',reviewStatus:'NOT_READY',updatedAt:new Date().toISOString(),
      failure:{code,message:'Evaluation failed. Check the current dataset, route snapshot and plan inputs.',requestId}};
    delete failed.resultRef;delete failed.resultHash;delete failed.inputHash;delete failed.configHash;delete failed.reviewedAt;delete failed.reviewedBy;
    await writeVersionedPlan(failed,version,identity,'PLAN_EVALUATION_FAILED',settings.version);
    throw new HttpError(503,code,'Evaluation failed and the plan was marked Failed. Check the route snapshot and retry.',true);
  }
  const evaluated:PlanRecord={...plan,version:version+1,evaluationStatus:'SUCCEEDED',reviewStatus:'NEEDS_REVIEW',updatedAt:new Date().toISOString(),
    inputHash:result.inputHash,resultHash,configHash,resultRef:{key,hash:resultHash,expiresAt,datasetHash:dataset.hash,matrixHash:matrix.hash,configHash}};
  delete evaluated.failure;delete evaluated.reviewedAt;delete evaluated.reviewedBy;
  // A concurrent settings edit or plan save cannot turn a stale computation into a reviewed record.
  await writeVersionedPlan(evaluated,version,identity,'PLAN_EVALUATED',settings.version);
  return json(200,{...presentPlan(evaluated,configHash,dataset.hash),result},requestId);
}
async function writeVersionedPlan(plan:PlanRecord,previousVersion:number,identity:Identity,action:string,settingsVersion:number) {
  try {
    await db.send(new TransactWriteCommand({TransactItems:[
      {Put:{TableName:table(),Item:plan,ConditionExpression:'#version = :version',ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':previousVersion}}},
      {ConditionCheck:{TableName:table(),Key:{pk:workspaceKey(plan.workspaceId),sk:'SETTINGS'},
        ConditionExpression:settingsVersion===1?'attribute_not_exists(pk) OR #version = :version':'#version = :version',
        ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':settingsVersion}}},
      membershipCondition(identity,plan.workspaceId,action==='PLAN_REVIEWED'?'Admin':'Planner'),
      audit(plan.workspaceId,identity,action,{planId:plan.id,version:plan.version,inputHash:plan.inputHash,resultHash:plan.resultHash,configHash:plan.configHash}),
    ]}));
  } catch(error) {
    if(conflict(error)) throw new HttpError(409,'VERSION_CONFLICT','The plan or workspace settings changed. Reload before trying again.');
    throw error;
  }
}
async function reviewPlan(event:ApiEvent,workspaceId:string,id:string,identity:Identity,requestId:string) {
  await membershipFor(identity,workspaceId,'Admin');
  const value=objectInput(body(event),['expectedVersion','inputHash','resultHash','configHash']);
  const version=expectedVersion(value.expectedVersion),plan=await getPlan(workspaceId,id);
  assertPlanVersion(plan,version);
  const dataset=await loadDataset(),settings=await settingsFor(workspaceId,dataset),configHash=configurationHash(dataset,settings);
  if(plan.evaluationStatus!=='SUCCEEDED' || !plan.inputHash || !plan.resultHash || value.inputHash!==plan.inputHash ||
    value.resultHash!==plan.resultHash || value.configHash!==configHash || plan.configHash!==configHash || !(await resultFor(plan,configHash,dataset.hash))) {
    throw new HttpError(409,'RESULT_STALE','Review requires the exact successful, unexpired result under the current workspace settings. Re-evaluate first.');
  }
  const reviewed:PlanRecord={...plan,version:version+1,reviewStatus:'REVIEWED',updatedAt:new Date().toISOString(),
    reviewedAt:new Date().toISOString(),reviewedBy:identity.subject};
  await writeVersionedPlan(reviewed,version,identity,'PLAN_REVIEWED',settings.version);
  return json(200,presentPlan(reviewed,configHash,dataset.hash),requestId);
}
async function patchSettings(event:ApiEvent,workspaceId:string,identity:Identity,requestId:string) {
  await membershipFor(identity,workspaceId,'Admin');
  const dataset=await loadDataset(),value=validateSettings(body(event),dataset.sites.map(site=>site.id));
  const {expectedVersion:version,...updates}=value;
  const settings:WorkspaceSettings={...updates,version:version+1};
  try {
    await db.send(new TransactWriteCommand({TransactItems:[
      {Put:{TableName:table(),Item:{pk:workspaceKey(workspaceId),sk:'SETTINGS',...settings},
        ConditionExpression:version===1?'attribute_not_exists(pk) OR #version = :version':'#version = :version',
        ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':version}}},
      membershipCondition(identity,workspaceId,'Admin'),
      audit(workspaceId,identity,'SETTINGS_UPDATED',{version:settings.version,configHash:configurationHash(dataset,settings)}),
    ]}));
  } catch(error) {
    if(conflict(error)) throw new HttpError(409,'VERSION_CONFLICT','Workspace settings changed. Your inputs are preserved; reload the current version.');
    throw error;
  }
  return json(200,{settings,configHash:configurationHash(dataset,settings)},requestId);
}
export async function handler(event:ApiEvent) {
  const requestId=event.requestContext.requestId;
  try {
    const identity=identityFromClaims(event.requestContext.authorizer?.jwt?.claims);
    const method=event.requestContext.http.method,path=event.rawPath.replace(/^\/api(?=\/)/,'');
    if(path==='/v1/workspaces' && method==='GET') {
      const records=await queryAll(`USER#${identity.subject}`,'WORKSPACE#',20);
      const workspaces:Membership[]=[];
      for(const record of records) {
        try {workspaces.push(authorizeMembership(identity,record,String(record.workspaceId)));}
        catch(error) {if(!(error instanceof HttpError && error.status===403)) throw error;}
      }
      return json(200,{workspaces},requestId);
    }
    const parts=path.split('/').filter(Boolean);
    if(parts[0]!=='v1'||parts[1]!=='workspaces'||!parts[2]) throw new HttpError(404,'NOT_FOUND','The API route does not exist.');
    const workspaceId=identifier(parts[2],'workspace identifier');
    await membershipFor(identity,workspaceId);
    if(parts.length===4 && parts[3]==='plans' && method==='POST') return await savePlan(event,workspaceId,identity,requestId);
    if(parts.length===4 && parts[3]==='settings' && method==='PATCH') return await patchSettings(event,workspaceId,identity,requestId);
    const dataset=await loadDataset(),settings=await settingsFor(workspaceId,dataset),configHash=configurationHash(dataset,settings);
    if(parts.length===4 && parts[3]==='settings' && method==='GET') return json(200,{settings,configHash},requestId);
    if(parts.length===4 && parts[3]==='plans' && method==='GET') {
      const plans=(await queryAll(workspaceKey(workspaceId),'PLAN#')).map(record=>presentPlan(record as unknown as PlanRecord,configHash,dataset.hash));
      return json(200,{plans:plans.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},requestId);
    }
    if(parts.length===4 && parts[3]==='search' && method==='GET') {
      const q=event.queryStringParameters?.q?.trim().toLowerCase()??'';
      if(q.length<2 || q.length>80) throw new HttpError(400,'INVALID_INPUT','Search must contain between 2 and 80 characters.');
      const plans=(await queryAll(workspaceKey(workspaceId),'PLAN#')).filter(record=>String(record.name).toLowerCase().includes(q))
        .map(record=>({type:'plan',id:record.id,label:record.name}));
      const zones=dataset.zones.filter(zone=>`${zone.id} ${zone.name}`.toLowerCase().includes(q)).map(zone=>({type:'zone',id:zone.id,label:zone.name}));
      const sites=dataset.sites.filter(site=>settings.enabledSiteIds.includes(site.id)&&`${site.id} ${site.name}`.toLowerCase().includes(q))
        .map(site=>({type:'site',id:site.id,label:site.name}));
      return json(200,{scope:'workspace',workspaceId,results:[...plans,...zones,...sites].slice(0,30)},requestId);
    }
    if(parts[3]==='plans' && parts[4]) {
      const id=identifier(parts[4],'plan identifier');
      if(parts.length===6 && parts[5]==='evaluate' && method==='POST') return await evaluatePlan(event,workspaceId,id,identity,requestId);
      if(parts.length===6 && parts[5]==='review' && method==='POST') return await reviewPlan(event,workspaceId,id,identity,requestId);
      if(parts.length===5 && method==='GET') {
        const plan=await getPlan(workspaceId,id),result=await resultFor(plan,configHash,dataset.hash);
        const summary=presentPlan(plan,configHash,dataset.hash),stale=plan.evaluationStatus==='SUCCEEDED'&&result===null;
        return json(200,{...summary,result,stale,reviewStatus:stale?'NOT_READY':summary.reviewStatus},requestId);
      }
    }
    throw new HttpError(404,'NOT_FOUND','The API route does not exist.');
  } catch(error) {return failure(error,requestId);}
}
