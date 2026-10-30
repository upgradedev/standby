import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { ApiError } from '../lib/api';
import { inputKey } from '../lib/format';
import type { EvaluationInput, SavedPlan } from '../lib/types';
import { useStandby } from '../state';
import { Busy } from './ui';

export function ScenarioFields({value,onChange}:{value:EvaluationInput;onChange:(value:EvaluationInput)=>void}) {
 return <div className="scenario-fields">
  <label>Hypothetical service vehicles<select aria-label="Scenario fleet size" value={value.fleetSize} onChange={e=>onChange({...value,fleetSize:Number(e.target.value),unavailableUnitId:undefined})}>{[1,2,3,4].map(n=><option key={n} value={n}>{n} units</option>)}</select></label>
  <label>Road approach threshold<select aria-label="Scenario approach threshold" value={value.thresholdMinutes} onChange={e=>onChange({...value,thresholdMinutes:Number(e.target.value)})}>{[5,10,15,20,25,30].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label>
  <label>Evaluation cohort<select aria-label="Scenario evaluation cohort" value={value.cohort??'holdout'} onChange={e=>onChange({...value,cohort:e.target.value as 'train'|'holdout'})}><option value="holdout">2025 · held out</option><option value="train">2023–2024 · training</option></select></label>
  <label>Unavailable unit<select aria-label="Scenario unavailable unit" value={value.unavailableUnitId??''} onChange={e=>onChange({...value,unavailableUnitId:e.target.value||undefined})}><option value="">All units available</option>{Array.from({length:value.fleetSize},(_,i)=><option value={`unit-${i+1}`} key={i}>Unit {i+1} unavailable</option>)}</select></label>
 </div>;
}

export function PlanEditor({plan,onDirty,onSaved}:{plan:SavedPlan;onDirty:(value:boolean)=>void;onSaved:(value:SavedPlan)=>void}) {
 const{api,workspace,toast}=useStandby(),[input,setInput]=useState(plan.input),[name,setName]=useState(plan.name),[saving,setSaving]=useState(false),[error,setError]=useState<ApiError|null>(null);
 const dirty=inputKey(input)!==inputKey(plan.input)||name.trim()!==plan.name;
 useEffect(()=>onDirty(dirty),[dirty,onDirty]);
 async function save(){
  setSaving(true);setError(null);
  try{
   const raw=await api<SavedPlan|{plan:SavedPlan}>(`/workspaces/${encodeURIComponent(workspace)}/plans`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({planId:plan.id,expectedVersion:plan.version,name:name.trim(),input})});
   const value='plan'in raw?raw.plan:raw;
   onSaved(value);toast('Revised plan saved. Its previous evaluation and review were invalidated.');
  }catch(e){const failure=e instanceof ApiError?e:new ApiError('The revised plan could not be saved.');setError(failure);toast(failure.message,'error');}
  finally{setSaving(false);}
 }
 return <section className="plan-editor"><h3>Revise saved inputs</h3><label className="plan-name-label">Plan name<input maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><ScenarioFields value={input} onChange={setInput}/>{error?<p role="alert" className="notice warning">{error.message} {error.code==='VERSION_CONFLICT'?'Your edits are preserved. Close this drawer and inspect the latest version before retrying.':''}</p>:null}<button className="button secondary" disabled={!dirty||saving||!name.trim()} onClick={()=>void save()}>{saving?<Busy label="Saving revision"/>:<><Save size={14}/>Save revised inputs</>}</button><p className="muted">Saving changed inputs resets evaluation and review. Workspace fleet and enabled-site limits are validated by the server.</p></section>;
}
