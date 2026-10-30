import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, getConfig, normalizeManifest, normalizeZones, request } from './lib/api';
import { readSession, type Session } from './lib/auth';
import { inputKey } from './lib/format';
import { readPreferences, readScenarios, savePreferences, saveScenarios } from './lib/storage';
import type { Config, DemandZone, EvaluationInput, EvaluationResult, LocalScenario, Manifest, Membership, PlanKey, Preferences, SavedPlan } from './lib/types';

interface Toast {id:string; message:string; kind:'success'|'error'|'info'}
interface State {
 config:Config|null;manifest:Manifest|null;zones:DemandZone[];loading:boolean;error:ApiError|null;reload:()=>void;
 input:EvaluationInput;setInput:(input:EvaluationInput)=>void;result:EvaluationResult|null;evaluating:boolean;evaluationError:ApiError|null;stale:boolean;evaluate:(input?:EvaluationInput)=>Promise<EvaluationResult|null>;
 planKey:PlanKey;setPlanKey:(key:PlanKey)=>void;preferences:Preferences;updatePreferences:(value:Preferences)=>boolean;
 scenarios:LocalScenario[];saveScenario:(name?:string,scenarioInput?:EvaluationInput)=>void;deleteScenario:(id:string)=>void;runScenario:(id:string)=>Promise<boolean>;
 toasts:Toast[];toast:(message:string,kind?:Toast['kind'])=>void;dismissToast:(id:string)=>void;
 session:Session|null;setSession:(session:Session|null)=>void;memberships:Membership[];workspace:string;switchWorkspace:(id:string)=>void;membership:Membership|undefined;authError:string|null;
 cloudPlans:SavedPlan[];cloudPlansLoading:boolean;cloudPlansError:ApiError|null;refreshCloudPlans:()=>void;
 api:<T>(path:string,options?:RequestInit)=>Promise<T>;
}
const Context = createContext<State|null>(null);
const initialInput: EvaluationInput = {fleetSize:3,thresholdMinutes:10,cohort:'holdout'};
export function Provider({children}:{children:ReactNode}) {
 const [config,setConfig]=useState<Config|null>(null),[manifest,setManifest]=useState<Manifest|null>(null),[zones,setZones]=useState<DemandZone[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<ApiError|null>(null),[revision,setRevision]=useState(0);
 const [input,setInputState]=useState<EvaluationInput>(initialInput),[result,setResult]=useState<EvaluationResult|null>(null),[evaluating,setEvaluating]=useState(false),[evaluationError,setEvaluationError]=useState<ApiError|null>(null),[planKey,setPlanKey]=useState<PlanKey>('proposal');
 const [preferences,setPreferences]=useState(readPreferences),[scenarios,setScenarios]=useState(readScenarios),[toasts,setToasts]=useState<Toast[]>([]);
 const [session,setSession]=useState<Session|null>(readSession),[memberships,setMemberships]=useState<Membership[]>([]),[workspace,setWorkspace]=useState('public'),[authError,setAuthError]=useState<string|null>(null);
 const [cloudPlans,setCloudPlans]=useState<SavedPlan[]>([]),[cloudPlansLoading,setCloudPlansLoading]=useState(false),[cloudPlansError,setCloudPlansError]=useState<ApiError|null>(null),[cloudRevision,setCloudRevision]=useState(0);
 const evaluationController=useRef<AbortController|null>(null),evaluationSequence=useRef(0),currentInput=useRef(input);
 const toast=useCallback((message:string,kind:Toast['kind']='success')=>setToasts(list=>[...list.slice(-3),{id:crypto.randomUUID(),message,kind}]),[]);
 const dismissToast=useCallback((id:string)=>setToasts(list=>list.filter(t=>t.id!==id)),[]);
 const api=useCallback(<T,>(path:string,options:RequestInit={})=>request<T>(config?.apiBase ?? '/api/v1',path,options,workspace==='public' ? undefined : session?.accessToken),[config?.apiBase,session?.accessToken,workspace]);
 useEffect(()=>{
   const controller=new AbortController();setLoading(true);setError(null);
   (async()=>{const nextConfig=await getConfig(controller.signal);setConfig(nextConfig);const [meta,data]=await Promise.all([request<unknown>(nextConfig.apiBase,'/public/manifest',{signal:controller.signal}),request<unknown>(nextConfig.apiBase,'/public/zones',{signal:controller.signal})]);if(controller.signal.aborted)return;setManifest(normalizeManifest(meta));setZones(normalizeZones(data));})().catch(e=>{if(!controller.signal.aborted)setError(e instanceof ApiError?e:new ApiError('Cannot reach the Standby API. Check your connection and retry.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
   return()=>controller.abort();
 },[revision]);
 useEffect(()=>{
   if(!session||!config){setMemberships([]);return;}
   const controller=new AbortController();setAuthError(null);
   request<{workspaces:Array<{workspaceId:string;name:string;role:Membership['role']}>}>(config.apiBase,'/workspaces',{signal:controller.signal},session.accessToken).then(value=>{if(!controller.signal.aborted){setMemberships((value.workspaces ?? []).map(m=>({id:m.workspaceId,name:m.name,role:m.role})));}}).catch(e=>{if(!controller.signal.aborted){setMemberships([]);setAuthError(e.message);}});
   const timer=setTimeout(()=>{setSession(null);setWorkspace('public');setResult(null);setAuthError('Your session expired. Sign in again.');},Math.max(0,session.expiresAt-Date.now()));
   return()=>{controller.abort();clearTimeout(timer);};
 },[session,config]);
 useEffect(()=>{
   const controller=new AbortController();setCloudPlans([]);setCloudPlansError(null);
   if(workspace==='public'){setCloudPlansLoading(false);return;}
   setCloudPlansLoading(true);
   api<{plans:SavedPlan[]}>(`/workspaces/${encodeURIComponent(workspace)}/plans`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setCloudPlans(value.plans);}).catch(e=>{if(!controller.signal.aborted)setCloudPlansError(e instanceof ApiError?e:new ApiError('Workspace plans are unavailable.'));}).finally(()=>{if(!controller.signal.aborted)setCloudPlansLoading(false);});
   return()=>controller.abort();
 },[workspace,api,cloudRevision]);
 useEffect(()=>()=>evaluationController.current?.abort(),[]);
 useEffect(()=>{
   if(!result)return;const wait=new Date(result.matrix.expiresAt).getTime()-Date.now();
   if(wait<=0){setResult(null);return;}
   const timer=setTimeout(()=>{setResult(null);setEvaluationError(new ApiError('The route snapshot expired. A fresh snapshot is required.','MATRIX_EXPIRED'));},Math.min(wait,2147483647));return()=>clearTimeout(timer);
 },[result]);
 const setInput=useCallback((value:EvaluationInput)=>{currentInput.current=value;setInputState(value);evaluationController.current?.abort();evaluationSequence.current++;setEvaluating(false);},[]);
 const evaluate=useCallback(async(value:EvaluationInput=currentInput.current):Promise<EvaluationResult|null>=>{
   if(!config)return null;evaluationController.current?.abort();const controller=new AbortController();evaluationController.current=controller;const sequence=++evaluationSequence.current;setEvaluating(true);setEvaluationError(null);
   try{const response=await request<EvaluationResult>(config.apiBase,'/public/evaluations',{method:'POST',body:JSON.stringify(value),signal:controller.signal});
     if(sequence!==evaluationSequence.current||controller.signal.aborted)return null;
     if(response.datasetHash!==manifest?.dataset.hash||!response.plans?.proposal||!Number.isFinite(response.plans.proposal.coveragePct)||new Date(response.matrix.expiresAt).getTime()<=Date.now())throw new ApiError('The evaluation did not match the active dataset or is expired.','INVALID_RESULT');
     setResult(response);return response;
   }catch(e){if(sequence===evaluationSequence.current&&!controller.signal.aborted){const failure=e instanceof ApiError?e:new ApiError('Coverage evaluation is unavailable. Your inputs are preserved.');setEvaluationError(failure);toast(failure.message,'error');}return null;}
   finally{if(sequence===evaluationSequence.current)setEvaluating(false);}
 },[config,manifest?.dataset.hash,toast]);
 const autoEvaluated=useRef<string|null>(null);
 useEffect(()=>{if(manifest?.matrix&&config&&zones.length&&!loading&&autoEvaluated.current!==manifest.dataset.hash){autoEvaluated.current=manifest.dataset.hash;void evaluate(currentInput.current);}},[manifest,config,zones.length,loading,evaluate]);
 const updatePreferences=useCallback((value:Preferences)=>{try{savePreferences(value);setPreferences(value);return true;}catch{toast('Browser storage is unavailable. Preferences were not saved.','error');return false;}},[toast]);
 const persistScenarios=useCallback((value:LocalScenario[])=>{try{saveScenarios(value);setScenarios(value);return true;}catch{toast('Browser storage is unavailable. The local scenario was not saved.','error');return false;}},[toast]);
 const stale=!!result&&(inputKey(result.input)!==inputKey(input)||!!evaluationError);
 const saveScenario=useCallback((name?:string,scenarioInput:EvaluationInput=input)=>{
   const successful=!!result&&!stale&&inputKey(result.input)===inputKey(scenarioInput);
   const scenario:LocalScenario={id:crypto.randomUUID(),name:name?.trim().slice(0,100)||`${scenarioInput.fleetSize} units · ${scenarioInput.thresholdMinutes} min`,input:{...scenarioInput},updatedAt:new Date().toISOString(),evaluationStatus:successful?'SUCCEEDED':'NOT_RUN',reviewStatus:successful?'NEEDS_REVIEW':'NOT_READY',...(successful?{inputHash:result.inputHash}:{})};
   if(persistScenarios([scenario,...scenarios].slice(0,50)))toast('Scenario saved on this device. Travel-time results are not stored.');
 },[input,result,stale,scenarios,persistScenarios,toast]);
 const deleteScenario=useCallback((id:string)=>{if(persistScenarios(scenarios.filter(s=>s.id!==id)))toast('Local scenario removed.');},[scenarios,persistScenarios,toast]);
 const runScenario=useCallback(async(id:string)=>{const scenario=scenarios.find(s=>s.id===id);if(!scenario)return false;setInput(scenario.input);const response=await evaluate(scenario.input);const next=scenarios.map(s=>s.id===id?{...s,updatedAt:new Date().toISOString(),evaluationStatus:response?'SUCCEEDED' as const:'FAILED' as const,reviewStatus:response?'NEEDS_REVIEW' as const:'NOT_READY' as const,inputHash:response?.inputHash,error:response?undefined:'Evaluation failed. Retry to request a fresh result.'}:s);persistScenarios(next);if(response)toast('Local scenario evaluated against the active route snapshot.');return !!response;},[scenarios,setInput,evaluate,persistScenarios,toast]);
 const switchWorkspace=useCallback((id:string)=>{if(id!=='public'&&!memberships.some(m=>m.id===id))return;evaluationController.current?.abort();evaluationSequence.current++;setEvaluating(false);setResult(null);setEvaluationError(null);setCloudPlans([]);setCloudPlansError(null);setCloudPlansLoading(id!=='public');setWorkspace(id);},[memberships]);
 return <Context.Provider value={{config,manifest,zones,loading,error,reload:()=>setRevision(r=>r+1),input,setInput,result,evaluating,evaluationError,stale,evaluate,planKey,setPlanKey,preferences,updatePreferences,scenarios,saveScenario,deleteScenario,runScenario,toasts,toast,dismissToast,session,setSession,memberships,workspace,switchWorkspace,membership:memberships.find(m=>m.id===workspace),authError,cloudPlans,cloudPlansLoading,cloudPlansError,refreshCloudPlans:()=>setCloudRevision(value=>value+1),api}}>{children}</Context.Provider>;
}
export function useStandby(){const value=useContext(Context);if(!value)throw new Error('Standby context is required.');return value;}
