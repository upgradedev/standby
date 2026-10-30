import type { Config, DemandZone, Manifest } from './types';
export class ApiError extends Error {
  constructor(message:string, public code = 'UNAVAILABLE', public requestId = '', public status = 503) { super(message); this.name = 'ApiError'; }
}
export async function request<T>(base:string,path:string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/,'')}${path}`,{...options,cache:'no-store',headers:{Accept:'application/json',...(options.body ? {'Content-Type':'application/json'} : {}),...(token ? {Authorization:`Bearer ${token}`} : {}),...options.headers}});
  let body: unknown;
  try { body = await response.json(); } catch { throw new ApiError('The API returned an unreadable response.','INVALID_RESPONSE','',response.status); }
  if (!response.ok) { const error = body as {message?:string;code?:string;requestId?:string}; throw new ApiError(error.message ?? 'The request could not be completed.',error.code,error.requestId,response.status); }
  return body as T;
}
export async function getConfig(signal:AbortSignal): Promise<Config> {
  const response = await fetch('/config.json',{cache:'no-store',signal});
  if (!response.ok) throw new ApiError('Application configuration is unavailable.');
  const config = await response.json() as Config;
  if (typeof config.apiBase !== 'string') throw new ApiError('Application configuration is invalid.');
  return config;
}
export function normalizeManifest(raw: unknown): Manifest {
  const value = raw as Manifest & Record<string,unknown>;
  const dataset = value.dataset;
  if (!dataset || !Array.isArray(dataset.sites) || !dataset.distribution || !dataset.source || !dataset.quality || !Array.isArray(dataset.bounds)) throw new ApiError('Dataset metadata failed validation.','INVALID_DATA');
  return {dataset,matrix:value.matrix ?? null,release:typeof value.release === 'string' ? value.release : 'development',limits:value.limits};
}
export function normalizeZones(raw: unknown): DemandZone[] {
  const zones = (raw as {zones?: DemandZone[]}).zones;
  if (!Array.isArray(zones) || zones.length > 240 || zones.some(z => typeof z.id !== 'string' || !Array.isArray(z.position) || !Array.isArray(z.polygon) || !Number.isFinite(z.trainCount) || !Number.isFinite(z.holdoutCount))) throw new ApiError('Demand zones failed validation.','INVALID_DATA');
  return zones;
}
