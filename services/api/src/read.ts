import {evaluateScenario} from '../../../packages/domain/src/index';
import type {MatrixMetadata} from '../../../packages/contracts/src/index';
import {body,failure,HttpError,json,loadDataset,loadMatrix,type ApiEvent} from './common';
import {capacityEvaluationHandler} from './capacity';
function metadata(m:MatrixMetadata):MatrixMetadata {
  return {id:m.id,hash:m.hash,provider:m.provider,profile:m.profile,generatedAt:m.generatedAt,expiresAt:m.expiresAt};
}
export async function handler(event:ApiEvent) {
  const requestId=event.requestContext.requestId;
  const path=event.rawPath.replace(/^\/api/,'').replace(/\/$/,'');
  const method=event.requestContext.http.method;
  try {
    if(method==='GET'&&path==='/v1/health') {
      const [dataset,matrix]=await Promise.all([loadDataset(),loadMatrix()]);
      // Full domain validation, not merely the existence of two objects.
      evaluateScenario(dataset,matrix,{fleetSize:1,thresholdMinutes:10});
      return json(200,{status:'ready',release:process.env.RELEASE_SHA||'development',datasetHash:dataset.hash,matrixId:matrix.id},requestId);
    }
    if(method==='GET'&&path==='/v1/public/manifest') {
      const dataset=await loadDataset();
      let matrix:MatrixMetadata|null=null;
      try {matrix=metadata(await loadMatrix());}catch {/* The real-data map remains available; evaluation shows a distinct failure. */}
      const {zones,...datasetMetadata}=dataset;
      return json(200,{dataset:datasetMetadata,matrix,release:process.env.RELEASE_SHA||'development',
        limits:{maxFleetSize:4,minThresholdMinutes:5,maxThresholdMinutes:30,zoneCount:zones.length,siteCount:dataset.sites.length}},requestId);
    }
    if(method==='GET'&&path==='/v1/public/zones') return json(200,{zones:(await loadDataset()).zones},requestId);
    if(method==='GET'&&path.startsWith('/v1/public/zones/')) {
      const id=decodeURIComponent(path.slice('/v1/public/zones/'.length));
      const zone=(await loadDataset()).zones.find(z=>z.id===id);
      if(!zone) throw new HttpError(404,'ZONE_NOT_FOUND','This zone does not exist in the current snapshot.');
      return json(200,{zone},requestId);
    }
    if(method==='GET'&&path==='/v1/public/search') {
      const q=event.queryStringParameters?.q?.trim().toLowerCase()||'';
      if(q.length<2||q.length>100) throw new HttpError(400,'INVALID_SEARCH','Enter between 2 and 100 characters.');
      const dataset=await loadDataset();
      return json(200,{scope:'Entire public Austin snapshot',
        zones:dataset.zones.filter(z=>`${z.id} ${z.name}`.toLowerCase().includes(q)).slice(0,20),
        sites:dataset.sites.filter(s=>`${s.id} ${s.name}`.toLowerCase().includes(q)).slice(0,20)},requestId);
    }
    if(method==='POST'&&path==='/v1/public/evaluations') {
      const input=body(event);
      const [dataset,matrix]=await Promise.all([loadDataset(),loadMatrix()]);
      return json(200,evaluateScenario(dataset,matrix,input),requestId);
    }
    if(method==='POST'&&path==='/v1/public/capacity-evaluations') return capacityEvaluationHandler(event);
    throw new HttpError(404,'NOT_FOUND','The requested API route does not exist.');
  }catch(error) {return failure(error,requestId);}
}
