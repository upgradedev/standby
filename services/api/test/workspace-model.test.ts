import assert from 'node:assert/strict';
import test from 'node:test';
import type {Dataset,MatrixSnapshot} from '../../../packages/contracts/src/index';
import {restrictWorkspaceModel} from '../src/writer';

test('workspace restriction follows explicit matrix IDs, preserves source identity and changes config identity',()=>{
  const dataset={hash:'frozen-source',configHash:'source-config',sites:[
    {id:'site-a',name:'A',position:[-97.7,30.3],assumed:true},
    {id:'site-b',name:'B',position:[-97.8,30.4],assumed:true},
  ]} as unknown as Dataset;
  const matrix={siteIds:['site-b','site-a'],durationsSeconds:[[211,212],[101,102]],datasetHash:'frozen-source'} as MatrixSnapshot;
  const settings={version:4,defaultThresholdMinutes:15,maxFleetSize:1,enabledSiteIds:['site-a']};
  const restricted=restrictWorkspaceModel(dataset,matrix,settings);
  assert.equal(restricted.dataset.hash,'frozen-source');
  assert.notEqual(restricted.dataset.configHash,dataset.configHash);
  assert.deepEqual(restricted.dataset.sites.map(site=>site.id),['site-a']);
  assert.deepEqual(restricted.matrix.siteIds,['site-a']);
  assert.deepEqual(restricted.matrix.durationsSeconds,[[101,102]]);
  assert.deepEqual(matrix.siteIds,['site-b','site-a']);
  assert.equal(dataset.sites.length,2);
  assert.notEqual(restrictWorkspaceModel(dataset,matrix,{...settings,version:5}).dataset.configHash,restricted.dataset.configHash);
  assert.throws(()=>restrictWorkspaceModel(dataset,matrix,{...settings,enabledSiteIds:['new-site']}),/frozen candidate set/);
});
