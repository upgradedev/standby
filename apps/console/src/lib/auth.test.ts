import assert from 'node:assert/strict';
import test from 'node:test';
import {safeReturnPath,signInReturnPath} from './auth';

const origin='https://standby.example';
test('sign-in return preserves a same-origin page, workspace, filters and fragment',()=>{
  const path='/queues?workspace=qa-team&tab=Needs%20review#details';
  assert.equal(safeReturnPath(path,origin),path);
  assert.equal(safeReturnPath('/capacity?view=baseline&t=32.1',origin),'/capacity?view=baseline&t=32.1');
});
test('external, malformed and callback-loop return targets resolve to overview',()=>{
  for(const raw of [null,undefined,42,'queues','https://outside.example/path','//outside.example/path','/\\outside.example','/\n/outside.example','/auth/callback?code=old','/AUTH/CALLBACK/','/'+ 'x'.repeat(4096)]) {
    assert.equal(safeReturnPath(raw,origin),'/overview');
  }
});
test('PKCE return reader handles old or malformed stored entries without inventing a target',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  let stored:string|null=null;
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>stored}});
  try {
    assert.equal(signInReturnPath(origin),'/overview');
    stored='{';assert.equal(signInReturnPath(origin),'/overview');
    stored=JSON.stringify({verifier:'test-only',state:'test-only'});assert.equal(signInReturnPath(origin),'/overview');
    stored=JSON.stringify({returnTo:'/settings?theme=light'});assert.equal(signInReturnPath(origin),'/settings?theme=light');
    stored=JSON.stringify({returnTo:'//outside.example'});assert.equal(signInReturnPath(origin),'/overview');
  }finally{
    if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else Reflect.deleteProperty(globalThis,'sessionStorage');
  }
});
