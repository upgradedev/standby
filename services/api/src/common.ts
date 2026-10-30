import {GetObjectCommand,S3Client} from '@aws-sdk/client-s3';
import type {Dataset,MatrixSnapshot} from '../../../packages/contracts/src/index';

export interface ApiEvent {
  rawPath: string;
  headers?: Record<string,string|undefined>;
  queryStringParameters?: Record<string,string|undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {requestId:string;http:{method:string};authorizer?:{jwt?:{claims:Record<string,unknown>;scopes?:string[]}}};
}
export class HttpError extends Error {
  constructor(public status:number, public code:string, message:string, public retryable=false) {super(message);}
}
const s3 = new S3Client({});
let datasetCache: {value:Dataset;until:number}|undefined;
let matrixCache: {value:MatrixSnapshot;until:number}|undefined;
export async function readJson<T>(bucket:string,key:string):Promise<T> {
  const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
  if(!object.Body) throw new HttpError(503,'DATA_UNAVAILABLE','The required snapshot is unavailable.',true);
  return JSON.parse(await object.Body.transformToString()) as T;
}
export async function loadDataset():Promise<Dataset> {
  if(datasetCache && datasetCache.until>Date.now()) return datasetCache.value;
  const value=await readJson<Dataset>(process.env.SOURCE_BUCKET!,process.env.DATASET_KEY||'curated/dataset.json');
  if(value.schemaVersion!=='1'||!value.zones?.length||!value.sites?.length||!value.hash) throw new HttpError(503,'DATA_INVALID','The curated dataset is invalid.');
  datasetCache={value,until:Date.now()+30_000};return value;
}
export async function loadMatrix():Promise<MatrixSnapshot> {
  let value:MatrixSnapshot;
  if(matrixCache && matrixCache.until>Date.now()) value=matrixCache.value;
  else {
    value=await readJson<MatrixSnapshot>(process.env.CACHE_BUCKET!,process.env.MATRIX_KEY||'matrix/active.json');
    matrixCache={value,until:Date.now()+30_000};
  }
  if(!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now()) {
    matrixCache=undefined;
    throw new HttpError(503,'MATRIX_EXPIRED','The AWS route snapshot has expired. Evaluation is unavailable until it is renewed.',false);
  }
  return value;
}
export function json(statusCode:number,data:unknown,requestId?:string) {
  return {statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff',...(requestId?{'x-request-id':requestId}:{})},body:JSON.stringify(data)};
}
export function body(event:ApiEvent):unknown {
  if(event.isBase64Encoded||!event.body||Buffer.byteLength(event.body)>8192) throw new HttpError(400,'INVALID_BODY','Provide a JSON object smaller than 8 KB.');
  try {return JSON.parse(event.body);}catch {throw new HttpError(400,'INVALID_BODY','The request body must be valid JSON.');}
}
export function failure(error:unknown,requestId:string) {
  const e=error as {status?:number;statusCode?:number;code?:string;message?:string;retryable?:boolean;name?:string};
  const domain=e.name==='DomainError';
  const status=e instanceof HttpError?e.status:(domain&&e.code==='INVALID_INPUT'?400:503);
  const code=e instanceof HttpError||domain?e.code:(status===400?'VALIDATION_FAILED':'SERVICE_UNAVAILABLE');
  const message=e instanceof HttpError||domain?e.message:'The operation could not be completed. Your inputs have been preserved.';
  // Do not log bodies, coordinates, provider-derived durations or authentication tokens.
  console.error(JSON.stringify({event:'request_failed',requestId,code,status}));
  return json(status,{code,message,requestId,retryable:e.retryable??status>=500},requestId);
}
