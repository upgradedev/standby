import { useEffect, useState } from 'react';
import { ApiError } from './api';
import { useStandby } from '../state';
export function useEndpoint<T>(path:string|null){
 const{api}=useStandby(),[data,setData]=useState<T|null>(null),[loading,setLoading]=useState(!!path),[error,setError]=useState<ApiError|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError(null);if(!path){setLoading(false);return;}setLoading(true);api<T>(path,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof ApiError?e:new ApiError('The workspace API is unavailable.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[path,api,revision]);
 return {data,loading,error,reload:()=>setRevision(v=>v+1)};
}
