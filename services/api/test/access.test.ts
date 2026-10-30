import assert from 'node:assert/strict';
import test from 'node:test';
import {authorizeMembership,expectedVersion,identifier,identityFromClaims,objectInput,planName,validateSettings} from '../src/access';

const access={token_use:'access',sub:'operator-1',scope:'openid standby/access','cognito:groups':['Admin']};
const identity=identityFromClaims(access);
const membership={workspaceId:'austin',name:'Austin operations',role:'Admin'};
const errorCode=(code:string)=>(error:unknown)=>typeof error==='object'&&error!==null&&(error as {code?:string}).code===code;

test('ID tokens, anonymous requests and missing scopes are denied',()=>{
  assert.throws(()=>identityFromClaims(undefined),errorCode('UNAUTHENTICATED'));
  assert.throws(()=>identityFromClaims({...access,token_use:'id'}),errorCode('UNAUTHENTICATED'));
  assert.throws(()=>identityFromClaims({...access,scope:'openid'}),errorCode('FORBIDDEN'));
  assert.throws(()=>identityFromClaims({...access,'cognito:groups':['NotAnOperator']}),errorCode('FORBIDDEN'));
});
test('gateway group formats produce the same bounded roles',()=>{
  for(const groups of [['Admin'],'["Admin"]','[Admin]','Admin','Analyst,Admin']) {
    assert.ok(identityFromClaims({...access,'cognito:groups':groups}).groups.includes('Admin'));
  }
  assert.throws(()=>identityFromClaims({...access,'cognito:groups':['SuperAdmin']}),errorCode('FORBIDDEN'));
});
test('cross-workspace access and absent membership fail even with Admin JWT',()=>{
  assert.throws(()=>authorizeMembership(identity,membership,'another'),errorCode('FORBIDDEN'));
  assert.throws(()=>authorizeMembership(identity,undefined,'austin'),errorCode('FORBIDDEN'));
  assert.equal(authorizeMembership(identity,membership,'austin','Admin').role,'Admin');
});
test('workspace membership and JWT groups each cap effective permission',()=>{
  const analyst=identityFromClaims({...access,'cognito:groups':['Analyst']});
  assert.equal(authorizeMembership(analyst,membership,'austin').role,'Analyst');
  assert.throws(()=>authorizeMembership(analyst,membership,'austin','Planner'),errorCode('FORBIDDEN'));
  assert.throws(()=>authorizeMembership(identity,{...membership,role:'Analyst'},'austin','Admin'),errorCode('FORBIDDEN'));
  assert.throws(()=>authorizeMembership(identity,{...membership,role:'Owner'},'austin'),errorCode('FORBIDDEN'));
});
test('client KPI injection, invalid identifiers and stale version shapes are rejected',()=>{
  assert.throws(()=>objectInput({name:'Plan',coveragePct:100},['name','input']),errorCode('INVALID_INPUT'));
  assert.throws(()=>identifier('../another-workspace'),errorCode('INVALID_INPUT'));
  for(const value of [0,-1,1.5,'1',undefined,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>expectedVersion(value),errorCode('INVALID_INPUT'));
  assert.equal(expectedVersion(3),3);
  assert.equal(planName('  Morning standby  '),'Morning standby');
  assert.throws(()=>planName('Invisible\nname'),errorCode('INVALID_INPUT'));
});
test('settings allow existing candidate IDs only and preserve explicit optimistic version',()=>{
  const value={expectedVersion:7,defaultThresholdMinutes:15,maxFleetSize:2,enabledSiteIds:['site-b','site-a']};
  assert.deepEqual(validateSettings(value,['site-a','site-b']),{...value,enabledSiteIds:['site-a','site-b']});
  assert.throws(()=>validateSettings({...value,enabledSiteIds:['new-coordinate']},['site-a','site-b']),errorCode('INVALID_INPUT'));
  assert.throws(()=>validateSettings({...value,enabledSiteIds:['site-a','site-a']},['site-a','site-b']),errorCode('INVALID_INPUT'));
  assert.throws(()=>validateSettings({...value,maxFleetSize:3},['site-a','site-b']),errorCode('INVALID_INPUT'));
  assert.throws(()=>validateSettings({...value,defaultThresholdMinutes:31},['site-a','site-b']),errorCode('INVALID_INPUT'));
  assert.throws(()=>validateSettings({...value,role:'Admin'},['site-a','site-b']),errorCode('INVALID_INPUT'));
});
