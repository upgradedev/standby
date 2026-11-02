import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  CAPACITY_JOB_TYPES, CAPACITY_LIMITS,
  type CapacityInput, type CapacityJobType, type CapacityPolicy, type CapacityTypeProfile,
  type CapacityUnit, type CapacityUnitKind,
} from '../../../../../packages/contracts/src/capacity';
import type { StandbySite } from '../../../../../packages/contracts/src/index';
import { Badge } from '../ui';
import './capacity-assumptions.css';

interface Props {
  input: CapacityInput;
  sites: StandbySite[];
  disabled: boolean;
  onChange: (input: CapacityInput) => void;
}
type PolicyKey = 'baseline' | 'candidate';
const POLICY_LABELS: Record<PolicyKey, string> = {baseline: 'Baseline', candidate: 'Candidate'};
const JOB_LABELS: Record<CapacityJobType, string> = {battery: 'Battery', tyre: 'Tyre', breakdown: 'Breakdown', collision: 'Collision'};
const KIND_LABELS: Record<CapacityUnitKind, string> = {motorcycle: 'Motorcycle', service_van: 'Service van', flatbed: 'Flatbed'};
const UNIT_KINDS: CapacityUnitKind[] = ['motorcycle', 'service_van', 'flatbed'];

/** Reveal a native-invalid field before the browser tries to focus it. */
function revealField(field: HTMLElement) {
  let element: HTMLElement | null = field.parentElement;
  while (element) {
    if (element instanceof HTMLDetailsElement) element.open = true;
    element = element.parentElement;
  }
}

function NumberField({label, value, min, max, integer = false, hint, error, context, onChange}: {
  label: string; value: number; min: number; max: number; integer?: boolean;
  hint: string; error?: string; context?: string; onChange: (value: number) => void;
}) {
  const id = useId(), ref = useRef<HTMLInputElement>(null), [touched, setTouched] = useState(false);
  const localError = !Number.isFinite(value) ? 'Enter a number.'
    : value < min || value > max ? `Use ${min} to ${max}.`
    : integer && !Number.isInteger(value) ? 'Use a whole number.' : '';
  const issue = localError || error || '';
  useEffect(() => {ref.current?.setCustomValidity(issue);}, [issue]);
  return <label className="capacity-assumption-field" htmlFor={id}>
    <span>{label}</span>
    <input ref={ref} id={id} type="number" inputMode={integer ? 'numeric' : 'decimal'} required
      min={min} max={max} step={integer ? 1 : 'any'} value={Number.isFinite(value) ? value : ''}
      aria-label={context ? `${label}: ${context}` : label} aria-describedby={`${id}-hint${touched && issue ? ` ${id}-error` : ''}`}
      aria-invalid={touched && !!issue || undefined} onChange={event => onChange(event.currentTarget.valueAsNumber)}
      onBlur={() => setTouched(true)} onInvalid={event => {setTouched(true); revealField(event.currentTarget);}}/>
    <small id={`${id}-hint`}>{hint}</small>
    {touched && issue ? <small id={`${id}-error`} className="capacity-assumption-error">{issue}</small> : null}
  </label>;
}

/** Temporary, assumed scenario inputs. The parent form owns evaluation and API errors. */
export function CapacityAssumptions({input, sites, disabled, onChange}: Props) {
  const [undo, setUndo] = useState<{policy: PolicyKey; before: CapacityPolicy; after: string; label: string} | null>(null);
  const rosterHeadings = useRef<Record<PolicyKey, HTMLElement | null>>({baseline: null, candidate: null});
  const horizonValid = Number.isInteger(input.horizonMinutes) && input.horizonMinutes >= 1 && input.horizonMinutes <= CAPACITY_LIMITS.maxHorizonMinutes;
  const horizon = horizonValid ? input.horizonMinutes : CAPACITY_LIMITS.maxHorizonMinutes;
  const shareSum = CAPACITY_JOB_TYPES.reduce((sum, type) => sum + input.typeProfiles[type].share, 0);
  const shareError = Number.isFinite(shareSum) && Math.abs(shareSum - 1) > 1e-9 ? 'The four type shares must sum to 1.' : '';
  const weightError = input.arrivalWeights.every(Number.isFinite) && !input.arrivalWeights.some(weight => weight > 0)
    ? 'At least one hourly weight must be greater than zero.' : '';
  const change = (next: CapacityInput) => {if (!disabled) onChange(next);};
  function setShared<K extends keyof CapacityInput>(key: K, value: CapacityInput[K]) {change({...input, [key]: value});}
  function setHorizon(value: number) {
    const valid = Number.isInteger(value) && value >= 1 && value <= CAPACITY_LIMITS.maxHorizonMinutes;
    change({...input, horizonMinutes: value,
      arrivalWeights: valid ? Array.from({length: Math.ceil(value / 60)}, (_, index) => input.arrivalWeights[index] ?? 1) : input.arrivalWeights});
  }
  function setProfile(type: CapacityJobType, patch: Partial<CapacityTypeProfile>) {
    change({...input, typeProfiles: {...input.typeProfiles, [type]: {...input.typeProfiles[type], ...patch}}});
  }
  function setUnit(policy: PolicyKey, index: number, patch: Partial<CapacityUnit>) {
    change({...input, [policy]: {units: input[policy].units.map((unit, at) => at === index ? {...unit, ...patch} : unit)}});
  }
  function replaceRoster(policy: PolicyKey, next: CapacityPolicy, label: string) {
    if (disabled) return;
    setUndo({policy, before: structuredClone(input[policy]), after: JSON.stringify(next), label});
    onChange({...input, [policy]: next});
  }
  function addUnit(policy: PolicyKey) {
    if (disabled || !horizonValid || !sites.length || input[policy].units.length >= CAPACITY_LIMITS.maxUnits) return;
    const ids = new Set(input[policy].units.map(unit => unit.id));
    let index = 1; while (ids.has(`unit-${index}`)) index++;
    const unit: CapacityUnit = {id: `unit-${index}`, kind: 'service_van', siteId: sites[0].id,
      capabilities: ['battery', 'tyre', 'breakdown'], available: true, shiftStartMinutes: 0, shiftEndMinutes: input.horizonMinutes};
    replaceRoster(policy, {units: [...input[policy].units, unit]}, 'unit added');
  }

  return <fieldset className="capacity-assumptions" disabled={disabled}>
    <legend className="sr-only">Editable scenario assumptions</legend>
    <div className="capacity-assumption-heading"><div><h2>Scenario assumptions</h2><p>All numeric fields are required. These editable defaults are planning conveniences, not measured roadside parameters.</p></div><Badge tone="accent">Assumed</Badge></div>
    {disabled ? <p className="capacity-assumption-notice">Inputs are locked while this comparison runs.</p> : null}
    <details className="capacity-assumption-section" open>
      <summary><span><strong>Workload & experiment</strong><small>Shared by baseline and candidate</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
      <div className="capacity-assumption-body">
        <div className="capacity-assumption-grid">
          <NumberField label="Horizon (min)" value={input.horizonMinutes} min={1} max={CAPACITY_LIMITS.maxHorizonMinutes} integer hint="Elapsed minutes from scenario start; no calendar forecast." onChange={setHorizon}/>
          <NumberField label="Modeled incidents" value={input.jobCount} min={0} max={CAPACITY_LIMITS.maxJobs} integer hint="Fixed arrival count; zero is a valid empty workload." onChange={value => setShared('jobCount', value)}/>
          <NumberField label="Replications" value={input.replications} min={1} max={CAPACITY_LIMITS.maxReplications} integer hint="Paired random samples; the replay shows the first." onChange={value => setShared('replications', value)}/>
          <NumberField label="Random seed" value={input.seed} min={0} max={4294967295} integer hint="Same input and seed reproduce the modeled workload." onChange={value => setShared('seed', value)}/>
          <NumberField label="Response target (min)" value={input.responseTargetMinutes} min={1} max={240} hint="Assumed request-to-arrival target, not an agreed SLA." onChange={value => setShared('responseTargetMinutes', value)}/>
        </div>
        <p className="capacity-assumption-note">The queue starts empty and available on-duty units start idle. Incident types and arrival times are generated assumptions; Austin training counts weight geography only.</p>
        <details className="capacity-assumption-subsection">
          <summary>Hourly arrival weights <span>{input.arrivalWeights.length} relative bins</span></summary>
          <p className="capacity-assumption-note">Relative intensity, not incidents per hour. The fixed incident count is distributed across these bins; the final partial hour is weighted by its length. New bins start at 1 when the horizon grows.</p>
          <div className="capacity-assumption-grid capacity-weight-grid">{input.arrivalWeights.map((weight, index) => <NumberField key={index}
            label={`Minute ${index * 60}-${Math.min((index + 1) * 60, horizon)}`} value={weight} min={0} max={1000} error={weightError}
            hint="Relative assumed intensity." onChange={value => setShared('arrivalWeights', input.arrivalWeights.map((item, at) => at === index ? value : item))}/>)}</div>
          {weightError ? <p className="capacity-assumption-note">{weightError}</p> : null}
        </details>
      </div>
    </details>

    <div className="capacity-roster-grid">{(['baseline', 'candidate'] as const).map(policy => {
      const roster = input[policy], label = POLICY_LABELS[policy];
      const canUndo = undo?.policy === policy && undo.after === JSON.stringify(roster);
      return <details className="capacity-assumption-section capacity-roster-section" key={policy} open>
        <summary ref={element => {rosterHeadings.current[policy] = element;}}><span><strong>{label} fleet</strong><small>{roster.units.length} assumed units · {roster.units.filter(unit => unit.available).length} enabled</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
        <div className="capacity-assumption-body">
          <div className="capacity-roster-actions">
            <button type="button" className="button secondary" data-testid={`capacity-add-${policy}-unit`} disabled={!horizonValid || !sites.length || roster.units.length >= CAPACITY_LIMITS.maxUnits} onClick={() => addUnit(policy)}><Plus size={15} aria-hidden="true"/>Add unit</button>
            {policy === 'candidate' ? <button type="button" className="button secondary" data-testid="capacity-copy-baseline" onClick={() => replaceRoster('candidate', structuredClone(input.baseline), 'baseline copied')}><Copy size={15} aria-hidden="true"/>Copy baseline</button> : null}
          </div>
          <p className="capacity-assumption-note">1-12 units per plan. New units start as enabled service vans at the first candidate site. Configure each unit before running.</p>
          {!horizonValid || !sites.length ? <p className="capacity-assumption-notice">Adding a unit requires a valid horizon and available standby sites.</p> : null}
          {roster.units.length >= CAPACITY_LIMITS.maxUnits ? <p className="capacity-assumption-note">The 12-unit limit has been reached.</p> : null}
          <div className="capacity-unit-list">{roster.units.map((unit, index) => {
            const context = `${label} ${unit.id}`;
            const shiftError = Number.isFinite(unit.shiftStartMinutes) && Number.isFinite(unit.shiftEndMinutes) && unit.shiftStartMinutes >= unit.shiftEndMinutes ? 'Duty start must be earlier than duty end.' : '';
            const knownSite = sites.some(site => site.id === unit.siteId);
            return <details key={unit.id} className="capacity-unit-editor">
              <summary><span><code>{unit.id}</code><strong>{KIND_LABELS[unit.kind]}</strong><small>{unit.siteId} · minute {Number.isFinite(unit.shiftStartMinutes) ? unit.shiftStartMinutes : '?'}-{Number.isFinite(unit.shiftEndMinutes) ? unit.shiftEndMinutes : '?'} · {unit.available ? 'enabled' : 'unavailable'}</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
              <fieldset className="capacity-unit-fields"><legend className="sr-only">{context}</legend>
                <div className="capacity-assumption-grid capacity-unit-grid">
                  <label className="capacity-assumption-field"><span>Vehicle kind</span><select aria-label={`Vehicle kind: ${context}`} value={unit.kind} onChange={event => setUnit(policy, index, {kind: event.target.value as CapacityUnitKind})}>{UNIT_KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select><small>Capabilities stay explicit when the kind changes.</small></label>
                  <label className="capacity-assumption-field"><span>Home standby site</span><select aria-label={`Home standby site: ${context}`} required value={knownSite ? unit.siteId : ''} aria-invalid={!knownSite || undefined} onInvalid={event => revealField(event.currentTarget)} onChange={event => setUnit(policy, index, {siteId: event.target.value})}><option value="" disabled>Choose an existing site</option>{sites.map(site => <option value={site.id} key={site.id}>{site.id} · {site.name}</option>)}</select><small>Scenario-assumed home location.</small></label>
                  <NumberField label="Duty start (min)" context={context} value={unit.shiftStartMinutes} min={0} max={horizon} error={shiftError} hint="Elapsed minutes since scenario start." onChange={value => setUnit(policy, index, {shiftStartMinutes: value})}/>
                  <NumberField label="Duty end (min)" context={context} value={unit.shiftEndMinutes} min={0} max={horizon} error={shiftError} hint="New assignments stop at this boundary." onChange={value => setUnit(policy, index, {shiftEndMinutes: value})}/>
                </div>
                <fieldset className="capacity-capabilities"><legend>Assumed capabilities</legend><div>{CAPACITY_JOB_TYPES.map(type => <label key={type}><input type="checkbox" aria-label={`${JOB_LABELS[type]} capability: ${context}`} checked={unit.capabilities.includes(type)} onChange={event => setUnit(policy, index, {capabilities: CAPACITY_JOB_TYPES.filter(item => item === type ? event.target.checked : unit.capabilities.includes(item))})}/><span>{JOB_LABELS[type]}</span></label>)}</div></fieldset>
                {!unit.capabilities.length ? <p className="capacity-assumption-note">This unit has no capabilities, so no modeled jobs can be assigned to it.</p> : null}
                <div className="capacity-unit-actions"><label className="capacity-availability"><input type="checkbox" aria-label={`Available in this scenario: ${context}`} checked={unit.available} onChange={event => setUnit(policy, index, {available: event.target.checked})}/><span>Available in this scenario</span></label><button type="button" className="button ghost" aria-label={`Remove unit: ${context}`} disabled={roster.units.length <= 1} onClick={() => {replaceRoster(policy, {units: roster.units.filter((_, at) => at !== index)}, `${unit.id} removed`); requestAnimationFrame(() => rosterHeadings.current[policy]?.focus());}}><Trash2 size={15} aria-hidden="true"/>Remove unit</button></div>
                {roster.units.length <= 1 ? <p className="capacity-assumption-note">Keep at least one configured unit. Disable its availability to model a fully unavailable fleet.</p> : null}
              </fieldset>
            </details>;
          })}</div>
          {canUndo && undo ? <div className="capacity-roster-undo" role="status"><span>{undo.label}.</span><button type="button" className="button ghost" onClick={() => {change({...input, [policy]: structuredClone(undo.before)}); setUndo(null);}}><RotateCcw size={15} aria-hidden="true"/>Undo roster change</button></div> : null}
          <p className="capacity-assumption-note">Duty intervals must fit the current horizon, even for unavailable units. Reducing the horizon does not silently rewrite shifts.</p>
        </div>
      </details>;
    })}</div>

    <details className="capacity-assumption-section">
      <summary><span><strong>Service & cycle assumptions</strong><small>Type mix, triangular onsite duration and renewal allowances</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
      <div className="capacity-assumption-body">
        <div className="capacity-assumption-grid">
          <NumberField label="Dispatch preparation (min)" value={input.dispatchPrepMinutes} min={0} max={60} hint="Occupies the unit before outbound travel starts." onChange={value => setShared('dispatchPrepMinutes', value)}/>
          <NumberField label="Recovery allowance (min)" value={input.recoveryMinutes} min={0} max={240} hint="Assumed turnaround after service and any dropoff." onChange={value => setShared('recoveryMinutes', value)}/>
          <NumberField label="Travel multiplier" value={input.travelMultiplier} min={0.25} max={3} hint="Sensitivity factor on Car approach times for all unit kinds." onChange={value => setShared('travelMultiplier', value)}/>
        </div>
        <p className="capacity-assumption-note">Type shares total {Number.isFinite(shareSum) ? `${(shareSum * 100).toFixed(1)}%` : 'not available'}; required total is 100%. These service durations are not calibrated operator measurements.</p>
        {CAPACITY_JOB_TYPES.map(type => {
          const profile = input.typeProfiles[type], triangle = profile.onSiteMinutes;
          const triangleError = [triangle.min, triangle.mode, triangle.max].every(Number.isFinite) && (triangle.min > triangle.mode || triangle.mode > triangle.max) ? 'Use minimum ≤ most likely ≤ maximum.' : '';
          return <fieldset className="capacity-service-profile" key={type}><legend>{JOB_LABELS[type]} · Assumed</legend><div className="capacity-assumption-grid">
            <NumberField label="Type share (0-1)" context={JOB_LABELS[type]} value={profile.share} min={0} max={1} error={shareError} hint="All four type shares must sum to 1." onChange={value => setProfile(type, {share: value})}/>
            {(['min', 'mode', 'max'] as const).map(key => <NumberField key={key} label={`${key === 'min' ? 'Minimum' : key === 'mode' ? 'Most likely' : 'Maximum'} onsite (min)`} context={JOB_LABELS[type]} value={triangle[key]} min={0} max={480} error={triangleError} hint="Triangular assumed onsite duration." onChange={value => setProfile(type, {onSiteMinutes: {...triangle, [key]: value}})}/>)}
            <NumberField label="Flatbed transport (min)" context={JOB_LABELS[type]} value={profile.flatbedTransportMinutes} min={0} max={240} hint="Additional occupancy only when a flatbed serves this type." onChange={value => setProfile(type, {flatbedTransportMinutes: value})}/>
            <NumberField label="Flatbed dropoff (min)" context={JOB_LABELS[type]} value={profile.flatbedDropoffMinutes} min={0} max={240} hint="Additional occupancy after assumed flatbed transport." onChange={value => setProfile(type, {flatbedDropoffMinutes: value})}/>
          </div></fieldset>;
        })}
        <div className="capacity-assumption-limits"><strong>Fixed-home renewal approximation</strong><p>After preparation, Car-profile outbound travel, onsite work, any flatbed transport/dropoff and recovery, a unit is assumed available again at its configured home site. Recovery is not calculated reverse travel. Moving dispatch, routed towing legs and validated motorcycle/truck routing are not included.</p></div>
      </div>
    </details>
  </fieldset>;
}
