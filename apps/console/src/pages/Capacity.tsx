import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useSearchParams} from 'react-router-dom';
import {ChevronDown, FlaskConical, Play, Settings2, ShieldCheck} from 'lucide-react';
import {useCapacity} from '../capacityState';
import {useStandby} from '../state';
import {integer, shortHash, timestamp} from '../lib/format';
import {CapacityAssumptions} from '../components/capacity/CapacityAssumptions';
import {CapacityResults} from '../components/capacity/CapacityResults';
import {CapacityJobs} from '../components/capacity/CapacityJobs';
import {Badge, Busy, DataGate, LoadingState, PageHeading} from '../components/ui';
import './capacity.css';

const DETAIL_KEYS=['jobSelected','jobRun','jobTab','jobMap','jobPage'];
function draftNumber(value:number){return Number.isFinite(value)?integer(value):'Needs input';}

export default function Capacity() {
  const lab=useCapacity(), {manifest,preferences,reload}=useStandby();
  const [params,setParams]=useSearchParams();
  const latestParams=useRef(params);latestParams.current=params;
  const [configure,setConfigure]=useState(()=>!lab.result),[validation,setValidation]=useState('');
  const details=useRef<HTMLDetailsElement>(null),errorSummary=useRef<HTMLDivElement>(null),focusError=useRef(false);
  const view=params.get('view')==='baseline'?'baseline':'candidate';
  const horizon=lab.result?.input.horizonMinutes??lab.input?.horizonMinutes??0;
  const requested=Number(params.get('t')??horizon);
  const minute=Number.isFinite(requested)?Math.max(0,Math.min(horizon,requested)):horizon;
  const state=lab.unavailableReason?'unavailable':lab.running?'running':lab.error?'error':!lab.result?'not_run':lab.stale?'stale':'success';
  useEffect(()=>{if(lab.error&&focusError.current){errorSummary.current?.focus();focusError.current=false;}},[lab.error]);
  function changeView(next:'baseline'|'candidate') {
    const search=new URLSearchParams(params);search.set('view',next);DETAIL_KEYS.forEach(key=>search.delete(key));
    setParams(search,{replace:true});
  }
  function changeMinute(next:number) {
    const search=new URLSearchParams(params);search.set('t',String(Math.max(0,Math.min(horizon,next))));setParams(search,{replace:true});
  }
  async function run(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(lab.running||lab.unavailableReason||!lab.input)return;
    setValidation('');focusError.current=true;
    const planningHorizon=lab.input.horizonMinutes;
    if(await lab.run()){
      focusError.current=false;setConfigure(false);
      const search=new URLSearchParams(latestParams.current);DETAIL_KEYS.forEach(key=>search.delete(key));search.set('t',String(planningHorizon));
      setParams(search,{replace:true});
    } else setConfigure(true);
  }
  const unavailable=lab.unavailableReason?<div className="capacity-inline-notice" role="status" data-testid="capacity-unavailable"><strong>Unavailable</strong><p>{lab.unavailableReason}</p><button type="button" className="button secondary" onClick={reload}>Reload source snapshot</button></div>:null;
  return <DataGate><div className="capacity-page">
    <PageHeading title="Capacity lab" eyebrow="Assumption-based planning" description="Compare mixed fleets against the same modeled jobs. Inspect what waits, what finishes and which units stay busy."
      actions={<Badge tone="accent"><FlaskConical size={14}/>Assumption-based scenario</Badge>}/>
    <div className="capacity-model-warning" data-testid="capacity-assumption-label"><ShieldCheck size={21}/><div>
      <strong>Real geography. Assumed workload and service.</strong>
      <p>Austin training counts weight zone locations. Job arrivals, incident mix, durations, rosters and shifts are editable assumptions. This is a planning experiment, not a forecast or a staffing guarantee.</p>
    </div></div>
    {!lab.input?unavailable??<LoadingState/>:<>
      <div className="capacity-draft-summary" role="group" aria-label="Current draft assumptions">
        <span><strong>{draftNumber(lab.input.baseline.units.length)}</strong> baseline units</span>
        <span><strong>{draftNumber(lab.input.candidate.units.length)}</strong> candidate units</span>
        <span><strong>{draftNumber(lab.input.jobCount)}</strong> modeled jobs</span>
        <span><strong>{draftNumber(lab.input.horizonMinutes)} min</strong> horizon</span>
        <span><strong>{draftNumber(lab.input.replications)}</strong> replications · seed {draftNumber(lab.input.seed)}</span>
        <Badge>Draft assumptions</Badge>
      </div>
      <form id="capacity-inputs" data-testid="capacity-form" onSubmit={event=>void run(event)} onInvalidCapture={()=>{
        // Open before native validation moves focus into an invalid field.
        if(details.current)details.current.open=true;setConfigure(true);setValidation('Some assumptions need attention. Review the highlighted fields below.');
      }}>
        <div className="capacity-runbar">
          <button type="button" className="button secondary" aria-expanded={configure} aria-controls="capacity-configuration" onClick={()=>setConfigure(value=>!value)}><Settings2 size={16}/>{configure?'Hide assumptions':'Edit assumptions'}</button>
          <p data-testid="capacity-status" data-state={state} role="status">
            {state==='running'?<Busy label="Evaluating paired scenarios"/>:state==='success'?'Comparison ready':state==='stale'?'Inputs or snapshot changed · previous result is stale':state==='error'?'Comparison unavailable':state==='unavailable'?'Capacity service unavailable':'Not run · configure assumptions and compare'}
          </p>
          {!lab.unavailableReason?<button type="submit" data-testid="capacity-run" className="button primary" aria-label={lab.running?'Evaluating paired comparison':'Run paired comparison'} aria-disabled={lab.running} aria-describedby={lab.running?'capacity-running':undefined}>{lab.running?<Busy label="Evaluating"/>:<><Play size={16}/>Run paired comparison</>}</button>:null}
        </div>
        {lab.running?<p id="capacity-running" className="capacity-running-note">The same seeded jobs and service draws are evaluated for both rosters. Your inputs are retained.</p>:null}
        {validation?<div className="capacity-inline-notice" role="alert">{validation}</div>:null}
        {unavailable}
        {lab.error?<div ref={errorSummary} tabIndex={-1} className="capacity-inline-notice capacity-failure" role="alert" data-testid="capacity-error"><strong>{lab.error.status===400?'Some assumptions need attention':'The capacity comparison could not be verified'}</strong><p>{lab.error.message}</p><code>{lab.error.code}{lab.error.requestId?` · ${lab.error.requestId}`:''}</code><p>Your draft is preserved. Review the inputs and run the comparison again.</p></div>:null}
        <details ref={details} id="capacity-configuration" className="capacity-configuration" open={configure} onToggle={event=>setConfigure(event.currentTarget.open)}>
          <summary><span>Workload, service profiles and rosters</span><ChevronDown size={17}/></summary>
          <CapacityAssumptions input={lab.input} sites={manifest!.dataset.sites} disabled={lab.running} onChange={next=>{setValidation('');lab.setInput(next);}}/>
        </details>
      </form>
      <div className="capacity-renewal-note"><strong>Model boundary</strong><span>Initially empty queue · fixed job count · outbound Car road times for every vehicle kind · assumed recovery to the fixed home site. Transport/drop-off are duration allowances, not routed journeys.</span></div>
      {lab.result&&!lab.error&&!lab.unavailableReason?<>
        <div className="capacity-result-scope" data-testid="capacity-result-scope"><strong>{lab.stale?'Previous evaluated inputs':'Evaluated inputs'}</strong>
          <span>{lab.result.input.jobCount} jobs · {lab.result.input.horizonMinutes} min · {lab.result.replications} paired replications · seed {lab.result.input.seed}</span>
          <span>Computed <time dateTime={lab.result.generatedAt}>{timestamp(lab.result.generatedAt,preferences.timezone)} · {preferences.timezone}</time></span>
          <code>Input {shortHash(lab.result.inputHash)}</code>
        </div>
        <CapacityResults result={lab.result} stale={lab.stale} view={view} minute={minute} onViewChange={changeView} onMinuteChange={changeMinute}/>
        <CapacityJobs result={lab.result} view={view} minute={minute}/>
        <details className="capacity-provenance"><summary>Model assumptions and provenance</summary><ul>{lab.result.assumptions.map(note=><li key={note}>{note}</li>)}</ul>
          <dl><dt>Model</dt><dd>{lab.result.modelVersion}</dd><dt>Input hash</dt><dd>{lab.result.inputHash}</dd><dt>Dataset hash</dt><dd>{lab.result.datasetHash}</dd><dt>Matrix hash</dt><dd>{lab.result.matrix.hash}</dd><dt>Model hash</dt><dd>{lab.result.modelHash}</dd><dt>Paired sample hash</dt><dd>{lab.result.pairedSamplesHash}</dd><dt>Road snapshot expires</dt><dd>{timestamp(lab.result.matrix.expiresAt,preferences.timezone)} · {preferences.timezone}</dd></dl>
        </details>
      </>:!lab.running&&!lab.error&&!lab.unavailableReason?<section className="capacity-not-run"><FlaskConical size={30}/><h2>No comparison has run yet</h2><p>Baseline and candidate begin as independent copies. Change a roster, availability, home site or shift, then run the same workload against both.</p><p>The resulting jobs are modeled scenario records. Insured and driver systems are not connected.</p></section>:null}
    </>}
  </div></DataGate>;
}
