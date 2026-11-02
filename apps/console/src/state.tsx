import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {useLocation, useNavigate, useNavigationType} from 'react-router-dom';
import {ApiError, getConfig, normalizeManifest, normalizeZones, request} from './lib/api';
import {clearStoredSession, readSession, type Session} from './lib/auth';
import {inputKey} from './lib/format';
import {createScopeGuard, workspaceIntent, workspaceRequest, workspaceSearch} from './lib/scope';
import {readPreferences, readScenarios, savePreferences, saveScenarios} from './lib/storage';
import type {Config, DemandZone, EvaluationInput, EvaluationResult, LocalScenario, Manifest, Membership, PlanKey, Preferences, SavedPlan} from './lib/types';

interface Toast {id:string; message:string; kind:'success'|'error'|'info'; scopeKey:string}
interface State {
 config:Config|null;manifest:Manifest|null;zones:DemandZone[];loading:boolean;error:ApiError|null;reload:()=>void;
 input:EvaluationInput;setInput:(input:EvaluationInput)=>void;result:EvaluationResult|null;evaluating:boolean;evaluationError:ApiError|null;stale:boolean;evaluate:(input?:EvaluationInput)=>Promise<EvaluationResult|null>;
 planKey:PlanKey;setPlanKey:(key:PlanKey)=>void;preferences:Preferences;updatePreferences:(value:Preferences)=>boolean;
 scenarios:LocalScenario[];saveScenario:(name?:string,scenarioInput?:EvaluationInput)=>void;deleteScenario:(id:string)=>void;runScenario:(id:string)=>Promise<boolean>;
 toasts:Toast[];toast:(message:string,kind?:Toast['kind'])=>void;dismissToast:(id:string)=>void;
 session:Session|null;setSession:(session:Session|null)=>void;memberships:Membership[];workspace:string;scopeKey:string;switchWorkspace:(id:string)=>void;membership:Membership|undefined;authError:string|null;
 cloudPlans:SavedPlan[];cloudPlansLoading:boolean;cloudPlansError:ApiError|null;refreshCloudPlans:()=>void;
 api:<T>(path:string,options?:RequestInit)=>Promise<T>;
}
const Context=createContext<State|null>(null);
const initialInput:EvaluationInput={fleetSize:3,thresholdMinutes:10,cohort:'holdout'};
const scopeChanged=()=>new ApiError('Your session or workspace changed. Reopen the action in the active workspace.','SCOPE_CHANGED','',409);

export function Provider({children}:{children:ReactNode}) {
 const location=useLocation(),navigate=useNavigate(),navigation=useNavigationType();
 const locationRef=useRef(location),navigateRef=useRef(navigate);locationRef.current=location;navigateRef.current=navigate;
 const [guard]=useState(createScopeGuard),[scopeKey,setScopeKey]=useState(guard.key);
 const [config,setConfig]=useState<Config|null>(null),[manifest,setManifest]=useState<Manifest|null>(null),[zones,setZones]=useState<DemandZone[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<ApiError|null>(null),[revision,setRevision]=useState(0);
 const [input,setInputState]=useState<EvaluationInput>(initialInput),[result,setResult]=useState<EvaluationResult|null>(null),[evaluating,setEvaluating]=useState(false),[evaluationError,setEvaluationError]=useState<ApiError|null>(null),[planKey,setPlanKey]=useState<PlanKey>('proposal');
 const [preferences,setPreferences]=useState(readPreferences),[scenarios,setScenarios]=useState(readScenarios),[toasts,setToasts]=useState<Toast[]>([]);
 const [session,setSessionState]=useState<Session|null>(readSession),[sessionEpoch,setSessionEpoch]=useState(0),[memberships,setMemberships]=useState<Membership[]>([]),[membershipsReady,setMembershipsReady]=useState(false),[workspace,setWorkspaceState]=useState('public'),[authError,setAuthError]=useState<string|null>(null);
 const [cloudPlans,setCloudPlans]=useState<SavedPlan[]>([]),[cloudPlansLoading,setCloudPlansLoading]=useState(false),[cloudPlansError,setCloudPlansError]=useState<ApiError|null>(null),[cloudRevision,setCloudRevision]=useState(0);
 const sessionRef=useRef(session),sessionVersion=useRef(0),membershipController=useRef<AbortController|null>(null),membershipsRef=useRef(memberships),membershipFailure=useRef<string|null>(null);
 const workspaceRef=useRef(workspace),activeRole=useRef<string|null>(null),pendingWorkspace=useRef(workspaceRequest(location.search).workspace??'public');
 const evaluationController=useRef<AbortController|null>(null),evaluationSequence=useRef(0),currentInput=useRef(input),autoEvaluated=useRef<string|null>(null);
 const intent=workspaceIntent(location.search,navigation,workspace,pendingWorkspace.current);
 const selectedMembership=memberships.find(value=>value.id===workspace);
 const authorized=workspace==='public'||!!session&&membershipsReady&&!!selectedMembership&&activeRole.current===selectedMembership.role;
 const active=!intent.invalid&&intent.workspace===workspace&&authorized;
 const viewScopeKey=active?scopeKey:`pending:${scopeKey}:${intent.workspace}`;
 const visibleScope=useRef(viewScopeKey);visibleScope.current=viewScopeKey;
 const currentScope=useCallback((captured:string)=>guard.isCurrent(captured)&&visibleScope.current===captured,[guard]);
 const toast=useCallback((message:string,kind:Toast['kind']='success')=>{
   if(currentScope(viewScopeKey))setToasts(list=>[...list.slice(-3),{id:crypto.randomUUID(),message,kind,scopeKey:viewScopeKey}]);
 },[currentScope,viewScopeKey]);
 const dismissToast=useCallback((id:string)=>setToasts(list=>list.filter(value=>value.id!==id)),[]);

 const changeScope=useCallback((id:string,force=false)=>{
   if(!force&&workspaceRef.current===id)return;
   evaluationController.current?.abort();evaluationSequence.current++;autoEvaluated.current=null;
   const next=guard.change(id);visibleScope.current=next;workspaceRef.current=id;
   activeRole.current=membershipsRef.current.find(value=>value.id===id)?.role??null;
   setScopeKey(next);setWorkspaceState(id);setEvaluating(false);setResult(null);setEvaluationError(null);
   setCloudPlans([]);setCloudPlansError(null);setCloudPlansLoading(id!=='public');setToasts([]);
 },[guard]);
 const updateWorkspaceUrl=useCallback((id:string,replace=true)=>{
   const current=locationRef.current,search=workspaceSearch(current.search,id);
   if(search!==current.search)navigateRef.current({pathname:current.pathname,search,hash:current.hash},{replace});
 },[]);
 const setSession=useCallback((value:Session|null)=>{
   if(sessionEpoch!==sessionVersion.current)return;
   sessionVersion.current++;sessionRef.current=value;membershipController.current?.abort();
   membershipsRef.current=[];membershipFailure.current=null;setMemberships([]);setMembershipsReady(false);setAuthError(null);
   changeScope('public',true);setSessionState(value);setSessionEpoch(sessionVersion.current);
   if(!value){clearStoredSession();pendingWorkspace.current='public';updateWorkspaceUrl('public');}
 },[sessionEpoch,changeScope,updateWorkspaceUrl]);
 const switchWorkspace=useCallback((id:string)=>{
   if(!currentScope(viewScopeKey))return;
   if(id!=='public'&&(!sessionRef.current||!membershipsRef.current.some(value=>value.id===id)))return;
   pendingWorkspace.current=id;changeScope(id);setAuthError(null);updateWorkspaceUrl(id,false);
 },[currentScope,viewScopeKey,changeScope,updateWorkspaceUrl]);

 const api=useCallback(async<T,>(path:string,options:RequestInit={}):Promise<T>=>{
   if(!currentScope(viewScopeKey))throw scopeChanged();
   const requested=path.match(/^\/workspaces\/([^/?]+)/)?.[1];
   if(requested&&decodeURIComponent(requested)!==workspace)throw scopeChanged();
   const controller=new AbortController(),untrack=guard.track(viewScopeKey,controller),external=options.signal;
   const abort=()=>controller.abort();external?.addEventListener('abort',abort,{once:true});if(external?.aborted)controller.abort();
   try{
     const value=await request<T>(config?.apiBase??'/api/v1',path,{...options,signal:controller.signal},workspace==='public'?undefined:session?.accessToken);
     if(!currentScope(viewScopeKey)||controller.signal.aborted)throw scopeChanged();
     const row=value as {workspaceId?:unknown;plans?:Array<{workspaceId?:unknown}>;plan?:{workspaceId?:unknown}}|null;
     if(row&&((row.workspaceId!==undefined&&row.workspaceId!==workspace)||(Array.isArray(row.plans)&&row.plans.some(plan=>!plan||plan.workspaceId!==workspace))||(row.plan&&row.plan.workspaceId!==workspace)))throw new ApiError('The response does not belong to the active workspace.','INVALID_RESPONSE','',502);
     return value;
   }finally{untrack();external?.removeEventListener('abort',abort);}
 },[config?.apiBase,session?.accessToken,workspace,guard,currentScope,viewScopeKey]);

 useEffect(()=>{
   const controller=new AbortController();setLoading(true);setError(null);
   (async()=>{const nextConfig=await getConfig(controller.signal);setConfig(nextConfig);const [meta,data]=await Promise.all([request<unknown>(nextConfig.apiBase,'/public/manifest',{signal:controller.signal}),request<unknown>(nextConfig.apiBase,'/public/zones',{signal:controller.signal})]);if(controller.signal.aborted)return;setManifest(normalizeManifest(meta));setZones(normalizeZones(data));})().catch(value=>{if(!controller.signal.aborted)setError(value instanceof ApiError?value:new ApiError('Cannot reach the Standby API. Check your connection and retry.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
   return()=>controller.abort();
 },[revision]);
 useEffect(()=>{
   if(!session||!config)return;
   const controller=new AbortController(),epoch=sessionVersion.current;membershipController.current=controller;
   const currentSession=()=>!controller.signal.aborted&&sessionVersion.current===epoch&&sessionRef.current?.accessToken===session.accessToken;
   request<{workspaces:Array<{workspaceId:string;name:string;role:Membership['role']}>}>(config.apiBase,'/workspaces',{signal:controller.signal},session.accessToken).then(value=>{
     if(!currentSession())return;
     if(!Array.isArray(value.workspaces)||value.workspaces.length>20||value.workspaces.some(item=>!item||typeof item.workspaceId!=='string'||item.workspaceId==='public'||!/^[A-Za-z0-9_-]{1,80}$/.test(item.workspaceId)||typeof item.name!=='string'||!['Analyst','Planner','Admin'].includes(item.role))||new Set(value.workspaces.map(item=>item.workspaceId)).size!==value.workspaces.length)throw new ApiError('Workspace memberships failed validation.','INVALID_RESPONSE','',502);
     const next=value.workspaces.map(item=>({id:item.workspaceId,name:item.name,role:item.role}));
     membershipsRef.current=next;membershipFailure.current=null;setMemberships(next);setMembershipsReady(true);
   }).catch(value=>{if(currentSession()){membershipsRef.current=[];membershipFailure.current=value instanceof Error?value.message:'Workspace memberships are unavailable.';setMemberships([]);setMembershipsReady(true);setAuthError(membershipFailure.current);}});
   const timer=setTimeout(()=>{if(currentSession()){setSession(null);setAuthError('Your session expired. Sign in again.');}},Math.max(0,session.expiresAt-Date.now()));
   return()=>{controller.abort();clearTimeout(timer);};
 },[session,config,setSession]);
 useEffect(()=>{
   const desired=intent.workspace;pendingWorkspace.current=desired;
   if(intent.invalid){changeScope('public',true);pendingWorkspace.current='public';setAuthError('The requested workspace is invalid. The public simulator is shown.');updateWorkspaceUrl('public');return;}
   if(desired==='public'){changeScope('public');updateWorkspaceUrl('public');return;}
   // Keep the requested URL through sign-in, without selecting an unverified workspace.
   if(!session||!membershipsReady){changeScope('public',true);if(!session)setAuthError('Sign in to open the requested workspace. The public simulator remains available.');updateWorkspaceUrl(desired);return;}
   const membership=memberships.find(value=>value.id===desired);
   if(!membership){changeScope('public',true);pendingWorkspace.current='public';setAuthError(membershipFailure.current??'This account cannot access the requested workspace. The public simulator is shown.');updateWorkspaceUrl('public');return;}
   changeScope(desired,workspaceRef.current===desired&&activeRole.current!==membership.role);setAuthError(null);updateWorkspaceUrl(desired);
 },[location.key,intent.workspace,intent.invalid,session,membershipsReady,memberships,changeScope,updateWorkspaceUrl]);
 useEffect(()=>{
   const controller=new AbortController();setCloudPlans([]);setCloudPlansError(null);
   if(!active||workspace==='public'){setCloudPlansLoading(false);return;}
   setCloudPlansLoading(true);
   api<{plans:SavedPlan[]}>(`/workspaces/${encodeURIComponent(workspace)}/plans`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted&&currentScope(viewScopeKey))setCloudPlans(value.plans);}).catch(value=>{if(!controller.signal.aborted&&currentScope(viewScopeKey))setCloudPlansError(value instanceof ApiError?value:new ApiError('Workspace plans are unavailable.'));}).finally(()=>{if(!controller.signal.aborted&&currentScope(viewScopeKey))setCloudPlansLoading(false);});
   return()=>controller.abort();
 },[workspace,active,api,cloudRevision,currentScope,viewScopeKey]);
 useEffect(()=>{
   // React StrictMode probes cleanup/setup. Resume with the guard's fresh generation.
   visibleScope.current=guard.key;setScopeKey(guard.key);
   return()=>{guard.change(workspaceRef.current);membershipController.current?.abort();evaluationController.current?.abort();};
 },[guard]);
 useEffect(()=>{
   if(!result)return;const wait=Date.parse(result.matrix.expiresAt)-Date.now();
   if(wait<=0){setResult(null);return;}
   const timer=setTimeout(()=>{setResult(null);setEvaluationError(new ApiError('The route snapshot expired. A fresh snapshot is required.','MATRIX_EXPIRED'));},Math.min(wait,2147483647));return()=>clearTimeout(timer);
 },[result]);
 const setInput=useCallback((value:EvaluationInput)=>{if(!currentScope(viewScopeKey))return;currentInput.current=value;setInputState(value);evaluationController.current?.abort();evaluationSequence.current++;setEvaluating(false);},[currentScope,viewScopeKey]);
 const evaluate=useCallback(async(value:EvaluationInput=currentInput.current):Promise<EvaluationResult|null>=>{
   if(!config||!currentScope(viewScopeKey))return null;evaluationController.current?.abort();const controller=new AbortController();evaluationController.current=controller;const sequence=++evaluationSequence.current;setEvaluating(true);setEvaluationError(null);
   try{const response=await request<EvaluationResult>(config.apiBase,'/public/evaluations',{method:'POST',body:JSON.stringify(value),signal:controller.signal});
     if(sequence!==evaluationSequence.current||controller.signal.aborted||!currentScope(viewScopeKey))return null;
     if(response.datasetHash!==manifest?.dataset.hash||!response.plans?.proposal||!Number.isFinite(response.plans.proposal.coveragePct)||Date.parse(response.matrix.expiresAt)<=Date.now())throw new ApiError('The evaluation did not match the active dataset or is expired.','INVALID_RESULT');
     setResult(response);return response;
   }catch(value){if(sequence===evaluationSequence.current&&!controller.signal.aborted&&currentScope(viewScopeKey)){const failure=value instanceof ApiError?value:new ApiError('Coverage evaluation is unavailable. Your inputs are preserved.');setEvaluationError(failure);toast(failure.message,'error');}return null;}
   finally{if(sequence===evaluationSequence.current&&currentScope(viewScopeKey))setEvaluating(false);}
 },[config,manifest?.dataset.hash,toast,currentScope,viewScopeKey]);
 useEffect(()=>{if(active&&manifest?.matrix&&config&&zones.length&&!loading&&autoEvaluated.current!==`${scopeKey}:${manifest.dataset.hash}`){autoEvaluated.current=`${scopeKey}:${manifest.dataset.hash}`;void evaluate(currentInput.current);}},[active,scopeKey,manifest,config,zones.length,loading,evaluate]);
 const updatePreferences=useCallback((value:Preferences)=>{if(!currentScope(viewScopeKey))return false;try{savePreferences(value);setPreferences(value);return true;}catch{toast('Browser storage is unavailable. Preferences were not saved.','error');return false;}},[toast,currentScope,viewScopeKey]);
 const persistScenarios=useCallback((value:LocalScenario[])=>{if(!currentScope(viewScopeKey))return false;try{saveScenarios(value);setScenarios(value);return true;}catch{toast('Browser storage is unavailable. The local scenario was not saved.','error');return false;}},[toast,currentScope,viewScopeKey]);
 const stale=!!result&&(inputKey(result.input)!==inputKey(input)||!!evaluationError);
 const saveScenario=useCallback((name?:string,scenarioInput:EvaluationInput=input)=>{
   if(!currentScope(viewScopeKey))return;const successful=!!result&&!stale&&inputKey(result.input)===inputKey(scenarioInput);
   const scenario:LocalScenario={id:crypto.randomUUID(),name:name?.trim().slice(0,100)||`${scenarioInput.fleetSize} units · ${scenarioInput.thresholdMinutes} min`,input:{...scenarioInput},updatedAt:new Date().toISOString(),evaluationStatus:successful?'SUCCEEDED':'NOT_RUN',reviewStatus:successful?'NEEDS_REVIEW':'NOT_READY',...(successful?{inputHash:result.inputHash}:{})};
   if(persistScenarios([scenario,...scenarios].slice(0,50)))toast('Scenario saved on this device. Travel-time results are not stored.');
 },[input,result,stale,scenarios,persistScenarios,toast,currentScope,viewScopeKey]);
 const deleteScenario=useCallback((id:string)=>{if(!currentScope(viewScopeKey))return;if(persistScenarios(scenarios.filter(s=>s.id!==id)))toast('Local scenario removed.');},[scenarios,persistScenarios,toast,currentScope,viewScopeKey]);
 const runScenario=useCallback(async(id:string)=>{if(!currentScope(viewScopeKey))return false;const scenario=scenarios.find(s=>s.id===id);if(!scenario)return false;setInput(scenario.input);const response=await evaluate(scenario.input);if(!currentScope(viewScopeKey))return false;const next=scenarios.map(s=>s.id===id?{...s,updatedAt:new Date().toISOString(),evaluationStatus:response?'SUCCEEDED' as const:'FAILED' as const,reviewStatus:response?'NEEDS_REVIEW' as const:'NOT_READY' as const,inputHash:response?.inputHash,error:response?undefined:'Evaluation failed. Retry to request a fresh result.'}:s);persistScenarios(next);if(response)toast('Local scenario evaluated against the active route snapshot.');return !!response;},[scenarios,setInput,evaluate,persistScenarios,toast,currentScope,viewScopeKey]);
 const refreshCloudPlans=useCallback(()=>{if(currentScope(viewScopeKey))setCloudRevision(value=>value+1);},[currentScope,viewScopeKey]);
 return <Context.Provider value={{config,manifest,zones,loading,error,reload:()=>setRevision(value=>value+1),input,setInput,result:active?result:null,evaluating:active&&evaluating,evaluationError:active?evaluationError:null,stale,evaluate,planKey,setPlanKey,preferences,updatePreferences,scenarios,saveScenario,deleteScenario,runScenario,toasts:toasts.filter(value=>value.scopeKey===viewScopeKey),toast,dismissToast,session,setSession,memberships,workspace:active?workspace:'public',scopeKey:viewScopeKey,switchWorkspace,membership:active?memberships.find(value=>value.id===workspace):undefined,authError,cloudPlans:active&&workspace!=='public'?cloudPlans:[],cloudPlansLoading:active&&workspace!=='public'&&cloudPlansLoading,cloudPlansError:active&&workspace!=='public'?cloudPlansError:null,refreshCloudPlans,api}}>{children}</Context.Provider>;
}
export function useStandby(){const value=useContext(Context);if(!value)throw new Error('Standby context is required.');return value;}
