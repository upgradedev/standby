import {DeleteObjectCommand,GetObjectCommand,HeadObjectCommand,ListObjectsV2Command,S3Client} from '@aws-sdk/client-s3';

const s3=new S3Client({});
/** A missing expiry fails closed and raises the worker alarm; it never authorizes deletion. */
export function cacheExpiration(value:unknown):number {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('CACHE_EXPIRY_INVALID');
  const object=value as {expiresAt?:unknown;result?:{matrix?:{expiresAt?:unknown}}};
  if(typeof object.expiresAt!=='string' || !Number.isFinite(Date.parse(object.expiresAt))) throw new Error('CACHE_EXPIRY_INVALID');
  const expiry=Date.parse(object.expiresAt);
  const matrixExpiry=object.result?.matrix?.expiresAt;
  if(matrixExpiry!==undefined && (typeof matrixExpiry!=='string' || !Number.isFinite(Date.parse(matrixExpiry)) || Date.parse(matrixExpiry)<expiry)) {
    throw new Error('CACHE_EXPIRY_INVALID');
  }
  return expiry;
}
export function managedCacheKey(key:string):boolean {
  return /^(matrix|results)\/.+\.json$/.test(key) && !key.includes('..');
}
function notFound(error:unknown):boolean {
  const e=error as {name?:string;$metadata?:{httpStatusCode?:number}};
  return e?.$metadata?.httpStatusCode===404 || e?.name==='NotFound' || e?.name==='NoSuchKey';
}
export async function sweepCache(client:S3Client,bucket:string,now=Date.now()) {
  let deleted=0,scanned=0;
  const failures:string[]=[];
  for(const prefix of ['matrix/','results/']) {
    let cursor:string|undefined;
    do {
      const page=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:cursor,MaxKeys:1000}));
      cursor=page.NextContinuationToken;
      for(const item of page.Contents??[]) {
        if(!item.Key || !managedCacheKey(item.Key)) continue;
        scanned++;
        try {
          const object=await client.send(new GetObjectCommand({Bucket:bucket,Key:item.Key}));
          if(!object.Body) throw new Error('CACHE_BODY_MISSING');
          const expiry=cacheExpiration(JSON.parse(await object.Body.transformToString()));
          if(expiry>now) continue;
          if(!object.ETag) throw new Error('CACHE_ETAG_MISSING');
          // Conditional delete protects an active snapshot replaced after this worker read its expiry.
          await client.send(new DeleteObjectCommand({Bucket:bucket,Key:item.Key,IfMatch:object.ETag}));
          try {
            await client.send(new HeadObjectCommand({Bucket:bucket,Key:item.Key}));
            throw new Error('CACHE_DELETE_NOT_CONFIRMED');
          } catch(error) {if(!notFound(error)) throw error;}
          deleted++;
        } catch(error) {
          // Concurrent owner replacement/deletion is harmless; failed reads never authorize deletion.
          if(!notFound(error) && (error as {$metadata?:{httpStatusCode?:number}})?.$metadata?.httpStatusCode!==412) failures.push((error as {name?:string}).name??'Error');
        }
      }
    } while(cursor);
  }
  console.log(JSON.stringify({event:'cache_retention',scanned,deleted,failures:failures.length}));
  if(failures.length) throw new Error('CACHE_RETENTION_INCOMPLETE');
  return {scanned,deleted};
}
export async function handler() {
  const bucket=process.env.CACHE_BUCKET;
  if(!bucket || bucket===process.env.SOURCE_BUCKET) throw new Error('DEDICATED_CACHE_BUCKET_REQUIRED');
  return sweepCache(s3,bucket);
}
