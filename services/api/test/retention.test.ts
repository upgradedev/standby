import assert from 'node:assert/strict';
import test from 'node:test';
import type {S3Client} from '@aws-sdk/client-s3';
import {cacheExpiration,managedCacheKey,sweepCache} from '../src/retention';

test('only the dedicated matrix/results JSON prefixes are managed',()=>{
  assert.equal(managedCacheKey('matrix/active.json'),true);
  assert.equal(managedCacheKey('results/austin/plan/hash.json'),true);
  for(const key of ['curated/dataset.json','raw/import.json','results/../raw/import.json','matrix/active.zip','other/results/a.json']) {
    assert.equal(managedCacheKey(key),false,key);
  }
});
test('malformed expiry cannot authorize deleting an object',()=>{
  for(const value of [null,{},[],{expiresAt:'never'},{expiresAt:123}]) assert.throws(()=>cacheExpiration(value),/CACHE_EXPIRY_INVALID/);
  assert.equal(cacheExpiration({expiresAt:'2026-11-01T00:00:00Z'}),Date.UTC(2026,10,1));
});
test('derived result cannot declare expiry later than the underlying route snapshot',()=>{
  const expiresAt='2026-11-01T00:00:00Z';
  assert.equal(cacheExpiration({expiresAt,result:{matrix:{expiresAt}}}),Date.UTC(2026,10,1));
  assert.throws(()=>cacheExpiration({expiresAt:'2026-11-30T00:00:00Z',result:{matrix:{expiresAt}}}),/CACHE_EXPIRY_INVALID/);
});
test('retention deletes expired bytes conditionally, leaves fresh bytes and verifies absence',async()=>{
  const calls:Array<{name:string;input:Record<string,unknown>}>=[];
  const fake={send:async(command:{constructor:{name:string};input:Record<string,unknown>})=>{
    const name=command.constructor.name,input=command.input;calls.push({name,input});
    if(name==='ListObjectsV2Command') return {Contents:input.Prefix==='matrix/'?[{Key:'matrix/expired.json'},{Key:'matrix/current.json'}]:[]};
    if(name==='GetObjectCommand') return {ETag:'"read-version"',Body:{transformToString:async()=>JSON.stringify({expiresAt:input.Key==='matrix/expired.json'?'2026-10-31T00:00:00Z':'2026-11-10T00:00:00Z'})}};
    if(name==='DeleteObjectCommand') return {};
    if(name==='HeadObjectCommand') throw Object.assign(new Error('absent'),{$metadata:{httpStatusCode:404}});
    throw new Error('Unexpected command');
  }};
  assert.deepEqual(await sweepCache(fake as unknown as S3Client,'dedicated-cache',Date.UTC(2026,10,1)),{scanned:2,deleted:1});
  const deletes=calls.filter(call=>call.name==='DeleteObjectCommand');
  assert.equal(deletes.length,1);assert.equal(deletes[0]!.input.Key,'matrix/expired.json');
  assert.equal(deletes[0]!.input.IfMatch,'"read-version"');
  assert.equal(calls.filter(call=>call.name==='HeadObjectCommand').length,1);
});
test('replacement between read and delete survives the cleanup attempt',async()=>{
  let checkedAbsence=false;
  const fake={send:async(command:{constructor:{name:string};input:Record<string,unknown>})=>{
    const name=command.constructor.name;
    if(name==='ListObjectsV2Command') return {Contents:command.input.Prefix==='matrix/'?[{Key:'matrix/active.json'}]:[]};
    if(name==='GetObjectCommand') return {ETag:'"old-bytes"',Body:{transformToString:async()=>JSON.stringify({expiresAt:'2026-10-31T00:00:00Z'})}};
    if(name==='DeleteObjectCommand') throw Object.assign(new Error('changed'),{$metadata:{httpStatusCode:412}});
    if(name==='HeadObjectCommand') checkedAbsence=true;
    return {};
  }};
  assert.deepEqual(await sweepCache(fake as unknown as S3Client,'dedicated-cache',Date.UTC(2026,10,1)),{scanned:1,deleted:0});
  assert.equal(checkedAbsence,false);
});
test('retention fails visibly if deletion cannot be verified',async()=>{
  const fake={send:async(command:{constructor:{name:string};input:Record<string,unknown>})=>{
    const name=command.constructor.name;
    if(name==='ListObjectsV2Command') return {Contents:command.input.Prefix==='results/'?[{Key:'results/austin/test/hash.json'}]:[]};
    if(name==='GetObjectCommand') return {ETag:'"expired-bytes"',Body:{transformToString:async()=>JSON.stringify({expiresAt:'2026-10-31T00:00:00Z'})}};
    if(name==='DeleteObjectCommand'||name==='HeadObjectCommand') return {};
    throw new Error('Unexpected command');
  }};
  await assert.rejects(()=>sweepCache(fake as unknown as S3Client,'dedicated-cache',Date.UTC(2026,10,1)),/CACHE_RETENTION_INCOMPLETE/);
});
