import assert from 'node:assert/strict';
import test from 'node:test';
import type {CapacityComparisonResult,CapacityInput} from '../../../packages/contracts/src/capacity';
import type {Dataset,MatrixSnapshot} from '../../../packages/contracts/src/index';
import {createCapacityEvaluationHandler} from '../src/capacity';
import {HttpError,type ApiEvent} from '../src/common';
import {handler as readHandler} from '../src/read';

const now=new Date('2026-10-30T12:00:00Z');
function snapshots():{dataset:Dataset;matrix:MatrixSnapshot} {
  const zones=['x','y'].map((id,index)=>({id,name:id,position:[index,0] as [number,number],
    polygon:[[0,0],[1,0],[0,1],[0,0]] as [number,number][],trainCount:5,holdoutCount:5,
    trainHours:Array(24).fill(0),holdoutHours:Array(24).fill(0),trainDays:Array(7).fill(0),holdoutDays:Array(7).fill(0),qualityFlags:[]}));
  const dataset:Dataset={schemaVersion:'1',id:'synthetic-capacity-api',hash:'source-fixture',configHash:'config-fixture',
    generatedAt:'2026-10-30T10:00:00Z',bounds:[-1,-1,2,1],zones,
    sites:['a','b'].map((id,index)=>({id,name:id,position:[index,0],assumed:true})),
    periods:{train:{start:'2023-01-01T00:00:00Z',end:'2025-01-01T00:00:00Z'},holdout:{start:'2025-01-01T00:00:00Z',end:'2026-01-01T00:00:00Z'}},
    distribution:{train:{hours:[],days:[]},holdout:{hours:[],days:[]}},
    quality:{inputRows:{train:10,holdout:10},accepted:{train:10,holdout:10},excluded:{train:{},holdout:{}},monthlyReports:{},
      approximationMeters:{train:{p50:0,p90:0,max:0},holdout:{p50:0,p90:0,max:0}},warnings:[]},
    source:{url:'synthetic',attribution:'Hand-written synthetic API test, not provider data',semantics:'fixture',policyUrl:'synthetic'}};
  const matrix:MatrixSnapshot={schemaVersion:'1',id:'matrix-fixture',hash:'matrix-fixture',datasetHash:dataset.hash,
    provider:'HERE',profile:'Car',generatedAt:'2026-10-30T10:00:00Z',expiresAt:'2026-11-26T10:00:00Z',
    siteIds:['a','b'],zoneIds:['x','y'],durationsSeconds:[[60,240],[240,60]]};
  return {dataset,matrix};
}
function input():CapacityInput {
  const van={id:'van-1',kind:'service_van' as const,siteId:'a',capabilities:['battery','tyre','breakdown'] as const,
    available:true,shiftStartMinutes:0,shiftEndMinutes:60};
  const flatbed={id:'flatbed-1',kind:'flatbed' as const,siteId:'b',capabilities:['collision'] as const,
    available:true,shiftStartMinutes:0,shiftEndMinutes:60};
  return {schemaVersion:'1',seed:42,horizonMinutes:60,replications:1,jobCount:4,responseTargetMinutes:10,
    arrivalWeights:[1],dispatchPrepMinutes:2,recoveryMinutes:5,travelMultiplier:1,
    typeProfiles:{
      battery:{share:.25,onSiteMinutes:{min:10,mode:15,max:20},flatbedTransportMinutes:0,flatbedDropoffMinutes:0},
      tyre:{share:.25,onSiteMinutes:{min:15,mode:20,max:25},flatbedTransportMinutes:0,flatbedDropoffMinutes:0},
      breakdown:{share:.25,onSiteMinutes:{min:20,mode:25,max:30},flatbedTransportMinutes:0,flatbedDropoffMinutes:0},
      collision:{share:.25,onSiteMinutes:{min:20,mode:25,max:30},flatbedTransportMinutes:20,flatbedDropoffMinutes:10},
    },
    baseline:{units:[{...van,capabilities:[...van.capabilities]}]},
    candidate:{units:[{...van,capabilities:[...van.capabilities]},{...flatbed,capabilities:[...flatbed.capabilities]}]}};
}
function event(raw:unknown=input()):ApiEvent {
  return {rawPath:'/v1/public/capacity-evaluations',body:JSON.stringify(raw),
    requestContext:{requestId:'capacity-api-test',http:{method:'POST'}}};
}

test('public capacity runs from injected read-only snapshots without an identity and returns bounded provenance',async()=>{
  const {dataset,matrix}=snapshots();
  const before=JSON.stringify({dataset,matrix});
  let datasetLoads=0,matrixLoads=0;
  const handler=createCapacityEvaluationHandler({loadDataset:async()=>{datasetLoads++;return dataset;},
    loadMatrix:async()=>{matrixLoads++;return matrix;},now:()=>now});
  const response=await handler(event());
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.headers['x-request-id'],'capacity-api-test');
  const result=JSON.parse(response.body) as CapacityComparisonResult;
  assert.equal(result.datasetHash,dataset.hash);
  assert.equal(result.configHash,dataset.configHash);
  assert.equal(result.matrix.hash,matrix.hash);
  assert.equal(result.matrix.expiresAt,matrix.expiresAt);
  assert.equal(result.generatedAt,now.toISOString());
  assert.equal(typeof result.inputHash,'string');
  assert.ok(result.baseline&&result.candidate);
  assert.ok(Array.isArray(result.assumptions)&&result.assumptions.length>0);
  assert.equal('durationsSeconds' in result.matrix,false);
  assert.equal('zones' in result,false);
  assert.equal('source' in result,false);
  assert.deepEqual([datasetLoads,matrixLoads],[1,1]);
  assert.equal(JSON.stringify({dataset,matrix}),before);
  assert.deepEqual(await handler(event()),response);
});

test('malformed bodies fail before any snapshot access',async()=>{
  let loads=0;
  const handler=createCapacityEvaluationHandler({loadDataset:async()=>{loads++;throw new Error('must not load');},
    loadMatrix:async()=>{loads++;throw new Error('must not load');},now:()=>now});
  for(const request of [
    {...event(),body:'{'},
    {...event(),body:undefined},
    {...event(),body:' '.repeat(8193)},
    {...event(),isBase64Encoded:true},
    event(null),event([]),event('not a scenario'),
  ]) {
    const response=await handler(request);
    assert.equal(response.statusCode,400);
    assert.equal(JSON.parse(response.body).requestId,'capacity-api-test');
  }
  assert.equal(loads,0);
});

test('unknown, private and excessive work inputs are rejected before loading snapshots',async()=>{
  let loads=0;
  const handler=createCapacityEvaluationHandler({loadDataset:async()=>{loads++;throw new Error('must not load');},
    loadMatrix:async()=>{loads++;throw new Error('must not load');},now:()=>now});
  const nestedPrivate=structuredClone(input()) as unknown as {baseline:{units:Array<Record<string,unknown>>}};
  nestedPrivate.baseline.units[0]!.driverName='private customer';
  const tooManyUnits=structuredClone(input());
  tooManyUnits.candidate.units=Array.from({length:13},(_,index)=>({...tooManyUnits.candidate.units[0]!,id:`unit-${index}`}));
  for(const raw of [
    {...input(),driver:{name:'private customer'}},
    {...input(),workspaceId:'private-workspace',role:'Admin'},
    {...input(),origins:[[0,0]],matrix:{durationsSeconds:[[1]]}},
    {...input(),jobCount:201},
    {...input(),replications:21},
    {...input(),horizonMinutes:1441},
    {...input(),arrivalWeights:[]},
    {...input(),travelMultiplier:4},
    nestedPrivate,tooManyUnits,
  ]) {
    const response=await handler(event(raw));
    assert.equal(response.statusCode,400);
    assert.equal(JSON.parse(response.body).code,'INVALID_INPUT');
  }
  assert.equal(loads,0);
});

test('model-dependent invalid sites remain client errors after bounded input validation',async()=>{
  const {dataset,matrix}=snapshots();
  const raw=input();raw.baseline.units[0]!.siteId='missing-site';
  const response=await createCapacityEvaluationHandler({loadDataset:async()=>dataset,loadMatrix:async()=>matrix,now:()=>now})(event(raw));
  assert.equal(response.statusCode,400);
  assert.equal(JSON.parse(response.body).code,'INVALID_INPUT');
});

test('expired snapshots fail closed instead of returning a capacity result',async()=>{
  const {dataset,matrix}=snapshots();
  matrix.expiresAt=now.toISOString();
  const response=await createCapacityEvaluationHandler({loadDataset:async()=>dataset,loadMatrix:async()=>matrix,now:()=>now})(event());
  assert.equal(response.statusCode,503);
  assert.equal(JSON.parse(response.body).code,'MATRIX_EXPIRED');
  assert.equal(JSON.parse(response.body).baseline,undefined);
  const loaderExpired=await createCapacityEvaluationHandler({loadDataset:async()=>dataset,
    loadMatrix:async()=>{throw new HttpError(503,'MATRIX_EXPIRED','The route snapshot has expired.',false);},now:()=>now})(event());
  assert.equal(loaderExpired.statusCode,503);
  assert.equal(JSON.parse(loaderExpired.body).retryable,false);
});

test('source unavailability and invalid provenance return503 without leaking source errors',async()=>{
  const {dataset,matrix}=snapshots();
  const missing=await createCapacityEvaluationHandler({loadDataset:async()=>{throw new Error('private bucket, token and provider response');},
    loadMatrix:async()=>matrix,now:()=>now})(event());
  assert.equal(missing.statusCode,503);
  assert.equal(JSON.parse(missing.body).code,'SERVICE_UNAVAILABLE');
  assert.doesNotMatch(missing.body,/private bucket|token and provider response/);
  const invalid=await createCapacityEvaluationHandler({loadDataset:async()=>dataset,
    loadMatrix:async()=>({...matrix,datasetHash:'different-source'}),now:()=>now})(event());
  assert.equal(invalid.statusCode,503);
  assert.equal(JSON.parse(invalid.body).code,'INVALID_MATRIX');
});

test('the public read boundary does not evaluate capacity on alternate methods or protected paths',async()=>{
  for(const method of ['GET','PUT','PATCH','DELETE']) {
    const response=await readHandler({...event(),requestContext:{requestId:'capacity-method-test',http:{method}}});
    assert.equal(response.statusCode,404);
  }
  const protectedPath=await readHandler({...event(),rawPath:'/v1/workspaces/private/plans'});
  assert.equal(protectedPath.statusCode,404);
});
