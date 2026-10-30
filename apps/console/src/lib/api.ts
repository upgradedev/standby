import type { Config, DemandZone, Manifest } from './types';
export class ApiError extends Error {
  constructor(message:string, public code = 'UNAVAILABLE', public requestId = '', public status = 503) { super(message); this.name = 'ApiError'; }
}
export async function request<T>(base:string,path:string, options: RequestInit = {}, token?: string): Promise<T> {
  const controller=new AbortController(),external=options.signal;
  const abort=()=>controller.abort();external?.addEventListener('abort',abort,{once:true});if(external?.aborted)controller.abort();
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},15000);
  try{
    const response = await fetch(`${base.replace(/\/$/,'')}${path}`,{...options,signal:controller.signal,cache:'no-store',headers:{Accept:'application/json',...(options.body ? {'Content-Type':'application/json'} : {}),...(token ? {Authorization:`Bearer ${token}`} : {}),...options.headers}});
    let body: unknown;
    try { body = await response.json(); } catch { if(controller.signal.aborted)throw new Error('Request aborted');throw new ApiError('The API returned an unreadable response.','INVALID_RESPONSE','',response.status); }
    if (!response.ok) { const error = body as {message?:string;code?:string;requestId?:string}; throw new ApiError(error.message ?? 'The request could not be completed.',error.code,error.requestId,response.status); }
    return body as T;
  }catch(error){if(external?.aborted)throw error;if(timedOut)throw new ApiError('The API did not respond within 15 seconds. Your inputs are preserved.','TIMEOUT','',504);if(error instanceof ApiError)throw error;throw new ApiError('Cannot reach the Standby API. Check your connection and retry.');}
  finally{clearTimeout(timer);external?.removeEventListener('abort',abort);}
}
export async function getConfig(signal:AbortSignal): Promise<Config> {
  const config = await request<Config>('','/config.json',{signal});
  if (typeof config.apiBase !== 'string') throw new ApiError('Application configuration is invalid.');
  return config;
}
export function normalizeManifest(raw: unknown): Manifest {
  const value = raw as Manifest & Record<string,unknown>;
  const dataset = value.dataset;
  if (!dataset || !Array.isArray(dataset.sites) || !dataset.distribution || !dataset.source || !dataset.quality || !Array.isArray(dataset.bounds) || typeof value.release!=='string' || !value.limits || !Number.isInteger(value.limits.maxFleetSize)) throw new ApiError('Dataset metadata failed validation.','INVALID_DATA');
  return {dataset,matrix:value.matrix ?? null,release:typeof value.release === 'string' ? value.release : 'development',limits:value.limits};
}
export function normalizeZones(raw: unknown): DemandZone[] {
  const zones = (raw as {zones?: DemandZone[]}).zones;
  if (!Array.isArray(zones) || zones.length > 240 || zones.some(z => typeof z.id !== 'string' || !Array.isArray(z.position) || !Array.isArray(z.polygon) || !Number.isFinite(z.trainCount) || !Number.isFinite(z.holdoutCount))) throw new ApiError('Demand zones failed validation.','INVALID_DATA');
  return zones;
}
