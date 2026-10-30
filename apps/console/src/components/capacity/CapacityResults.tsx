import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {ArrowRight, Pause, Play, SkipBack, SkipForward} from 'lucide-react';
import {CAPACITY_JOB_TYPES, type CapacityAggregateMetrics, type CapacityComparisonResult, type CapacityJobType, type CapacityMetrics, type CapacityRange} from '../../../../../packages/contracts/src/capacity';
import {replaySnapshot, replayTimeBins} from '../../lib/capacityReplay';
import {integer, shortHash, timestamp} from '../../lib/format';
import {Badge} from '../ui';
import './capacity-results.css';

type View = 'baseline' | 'candidate';
type Unit = 'jobs' | 'min' | 'pct';
interface Props {result: CapacityComparisonResult; stale: boolean; view: View; minute: number; onViewChange: (view: View) => void; onMinuteChange: (minute: number) => void}
const TYPE_LABELS: Record<CapacityJobType, string> = {battery: 'Battery', tyre: 'Tyre', breakdown: 'Breakdown', collision: 'Collision'};
const TYPES = CAPACITY_JOB_TYPES.map(id => ({id, label: TYPE_LABELS[id]}));
const METRICS: ReadonlyArray<{key: keyof CapacityMetrics; label: string; unit: Unit; note: string}> = [
  {key: 'onTimePct', label: 'Within response target', unit: 'pct', note: 'All generated arrivals are the denominator, including unserved and horizon-censored work.'},
  {key: 'p90ResponseMinutes', label: 'Mean replication p90 response', unit: 'min', note: 'Queue + preparation + road approach. Only jobs reached by the horizon contribute.'},
  {key: 'meanQueueMinutes', label: 'Mean queue wait', unit: 'min', note: 'Assigned jobs, including those whose response happens after the horizon.'},
  {key: 'unserved', label: 'Unserved by horizon', unit: 'jobs', note: 'Includes incompatible, unreachable, unavailable and horizon-queued jobs.'},
  {key: 'completed', label: 'Completed by horizon', unit: 'jobs', note: 'Job clearance includes configured flatbed transport and drop-off. Unit recovery can continue.'},
  {key: 'maxQueue', label: 'Peak waiting queue', unit: 'jobs', note: 'Measured after dispatch at each event time; excludes immediate assignments and impossible jobs.'},
  {key: 'totalOvertimeMinutes', label: 'Unit overtime', unit: 'min', note: 'Accepted work can finish after shift end, including its assumed recovery.'},
];

function value(number: number | null | undefined, unit: Unit, signed = false): string {
  if (number == null || !Number.isFinite(number)) return 'N/A';
  const rounded = Math.abs(number) < .05 ? 0 : number;
  return `${signed && rounded > 0 ? '+' : ''}${rounded.toFixed(1)}${unit === 'min' ? ' min' : unit === 'pct' ? signed ? ' pp' : '%' : ''}`;
}
function duration(minute: number): string {return `${minute.toFixed(1)} min`;}
function sample(metrics: CapacityAggregateMetrics, key: 'responseSampleSize' | 'queueSampleSize'): string {
  const range = metrics[key];return range ? `${range.mean.toFixed(1)} jobs/rep on average` : 'No contributing jobs';
}
function RangeValue({range, unit, signed = false}: {range: CapacityRange | null; unit: Unit; signed?: boolean}) {
  return <div className="capacity-range-value"><strong>{value(range?.mean, unit, signed)}</strong><small>{range ? `${value(range.min, unit, signed)} to ${value(range.max, unit, signed)} · n=${range.n} defined rep` : 'No defined replication sample (n=0)'}</small></div>;
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {const query = window.matchMedia('(prefers-reduced-motion: reduce)');const update = () => setReduced(query.matches);query.addEventListener('change', update);return () => query.removeEventListener('change', update);}, []);
  return reduced;
}

export function CapacityResults({result, stale, view, minute, onViewChange, onMinuteChange}: Props) {
  const horizon = result.input.horizonMinutes;
  const at = Math.min(horizon, Math.max(0, Number.isFinite(minute) ? minute : 0));
  const replay = result[view].replay, policy = result.input[view];
  const snapshot = useMemo(() => replaySnapshot(replay, result.input, policy, at), [replay, result.input, policy, at]);
  const bins = useMemo(() => replayTimeBins(replay, result.input, policy), [replay, result.input, policy]);
  const queueMaximum = Math.max(1, ...bins.map(bin => bin.peakQueue));
  const active = Math.min(bins.length - 1, Math.floor(Math.min(at, horizon - Number.EPSILON) / 60));
  const [playing, setPlaying] = useState(false), reducedMotion = useReducedMotion();
  const minuteRef = useRef(at), changeRef = useRef(onMinuteChange);
  minuteRef.current = at;changeRef.current = onMinuteChange;
  useEffect(() => setPlaying(false), [result.inputHash, view, stale, reducedMotion]);
  useEffect(() => {
    if (!playing || reducedMotion || stale) return;
    const timer = window.setInterval(() => {
      const next = Math.min(horizon, minuteRef.current + Math.max(.1, horizon / 100));
      changeRef.current(next);if (next >= horizon) setPlaying(false);
    }, 200);
    const pause = () => {if (document.hidden) setPlaying(false);};document.addEventListener('visibilitychange', pause);
    return () => {window.clearInterval(timer);document.removeEventListener('visibilitychange', pause);};
  }, [playing, reducedMotion, stale, horizon]);
  const move = (next: number) => {setPlaying(false);onMinuteChange(next);};
  const workInProgress = snapshot.phases.preparing + snapshot.phases.traveling + snapshot.phases.on_site + snapshot.phases.transport + snapshot.phases.dropoff;

  return <div className="capacity-results" data-testid="capacity-results">
    {stale ? <div className="capacity-previous-result" role="status"><strong>Previous result.</strong> Inputs changed. These figures still describe the recorded run below; run a new comparison to update them.</div> : null}
    <section className="capacity-comparison" aria-labelledby="capacity-comparison-title">
      <div className="capacity-result-heading"><div><span className="eyebrow">Paired experiment · assumption-based</span><h2 id="capacity-comparison-title">Same workload. Two fleet plans.</h2><p>{integer(result.input.jobCount)} modeled arrivals per replication · {integer(result.replications)} replications · {duration(horizon)} horizon · {duration(result.input.responseTargetMinutes)} response target</p></div><Badge tone="accent">{stale ? 'Previous run' : 'Evaluated run'}</Badge></div>
      <p className="capacity-results-scope">Every comparison cell shows a mean of per-replication metrics, its observed min–max and the number of defined replications. These ranges are not confidence intervals or staffing guarantees.</p>
      <div className="capacity-metric-cards">{[METRICS[0], METRICS[1], METRICS[3], METRICS[5]].map(metric => <section className="capacity-metric-card" key={metric.key}>
        <h3>{metric.label}</h3><div className="capacity-metric-pair"><div><span>Baseline</span><strong>{value(result.baseline.aggregate[metric.key]?.mean, metric.unit)}</strong></div><div><span>Candidate</span><strong>{value(result.candidate.aggregate[metric.key]?.mean, metric.unit)}</strong></div></div>
        <p><ArrowRight size={13} aria-hidden="true"/>Mean paired change <strong>{value(result.delta[metric.key]?.mean, metric.unit, true)}</strong></p>
      </section>)}</div>
      <div className="capacity-comparison-wrap" role="region" aria-label="Paired capacity metric comparison" tabIndex={0}>
        <table className="capacity-comparison-table"><caption>Replication metrics · candidate minus baseline · display only</caption><thead><tr><th scope="col">Metric and sample</th><th scope="col">Baseline</th><th scope="col">Candidate</th><th scope="col">Paired change</th></tr></thead><tbody>
          {METRICS.map(metric => <tr key={metric.key}><th scope="row">{metric.label}<small>{metric.note}</small></th><td><RangeValue range={result.baseline.aggregate[metric.key]} unit={metric.unit}/></td><td><RangeValue range={result.candidate.aggregate[metric.key]} unit={metric.unit}/></td><td><RangeValue range={result.delta[metric.key]} unit={metric.unit} signed/></td></tr>)}
        </tbody></table>
      </div>
      <div className="capacity-sample-note"><p><strong>Response sample:</strong> baseline {sample(result.baseline.aggregate, 'responseSampleSize')}; candidate {sample(result.candidate.aggregate, 'responseSampleSize')}.</p><p><strong>Queue sample:</strong> baseline {sample(result.baseline.aggregate, 'queueSampleSize')}; candidate {sample(result.candidate.aggregate, 'queueSampleSize')}. A mean replication p90 is not a pooled p90.</p></div>
    </section>

    <section className="capacity-replay" aria-labelledby="capacity-replay-title">
      <div className="capacity-result-heading"><div><span className="eyebrow">Recorded first replication only</span><h2 id="capacity-replay-title">Follow the queue through the shift</h2><p>Simulated minutes since scenario start. This replay uses the existing event log and makes no new routing or evaluation requests.</p></div><div className="capacity-view-choice" aria-label="Replay fleet plan">{(['baseline', 'candidate'] as const).map(plan => <button type="button" key={plan} aria-pressed={view === plan} onClick={() => {setPlaying(false);onViewChange(plan);}}>{plan === 'baseline' ? 'Baseline' : 'Candidate'}</button>)}</div></div>
      <div className="capacity-replay-controls">
        <button type="button" className="button secondary" aria-label={playing ? 'Pause replay' : 'Play replay'} aria-disabled={reducedMotion || stale} onClick={() => {if (reducedMotion || stale) return;if (!playing && at >= horizon) onMinuteChange(0);setPlaying(!playing);}}>{playing ? <Pause size={15} aria-hidden="true"/> : <Play size={15} aria-hidden="true"/>}{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="icon-button" aria-label="Go to scenario start" onClick={() => move(0)}><SkipBack size={17} aria-hidden="true"/></button>
        <label className="capacity-time-control" htmlFor="capacity-replay-time"><span>Replay time <strong aria-live="off">{duration(at)} / {duration(horizon)}</strong></span><input id="capacity-replay-time" data-testid="capacity-replay-time" type="range" min={0} max={horizon} step={.1} value={at} aria-valuetext={`${at.toFixed(1)} minutes since scenario start`} onChange={event => move(Number(event.target.value))}/></label>
        <button type="button" className="icon-button" aria-label="Go to planning horizon" onClick={() => move(horizon)}><SkipForward size={17} aria-hidden="true"/></button>
      </div>
      {reducedMotion || stale ? <p className="capacity-playback-note">Playback is paused {reducedMotion ? 'for reduced motion' : 'while the shown result is stale'}. Use the slider or an interval below to inspect recorded events.</p> : null}
      <div className="capacity-replay-counts" aria-live="off"><div><span>Queued</span><strong>{integer(snapshot.phases.queued)}</strong></div><div><span>In progress</span><strong>{integer(workInProgress)}</strong></div><div><span>Completed jobs</span><strong>{integer(snapshot.phases.completed)}</strong></div><div><span>Unserved</span><strong>{integer(snapshot.phases.unserved)}</strong></div><div><span>Idle units</span><strong>{integer(snapshot.availableUnits)} / {integer(policy.units.length)}</strong></div><div><span>Busy units</span><strong>{integer(snapshot.busyUnits)} / {integer(policy.units.length)}</strong></div></div>
      <p className="capacity-replay-note">{integer(snapshot.phases.not_arrived)} of {integer(replay.jobs.length)} modeled jobs have not arrived at this minute. Busy units include recovery and overtime after job completion. Off shift: {integer(snapshot.offShiftUnits)}; scenario unavailable: {integer(snapshot.unavailableUnits)}.</p>
      <div className="capacity-replay-charts">
        <figure className="capacity-queue-figure"><figcaption><h3>Peak waiting queue by interval</h3><p>After dispatch · choose an interval to inspect its exact peak event</p></figcaption>
          <div className="capacity-queue-scale"><span>{integer(queueMaximum)} jobs</span><span>0</span></div><div className="capacity-queue-bars" role="img" aria-label="Peak waiting queue by interval; all values are available in the interval table below.">{bins.map((bin, index) => <span key={bin.startMinutes} className={index === active ? 'active' : ''} aria-hidden="true"><span className="capacity-queue-bar" style={{'--queue-height': `${bin.peakQueue / queueMaximum * 100}%`} as CSSProperties}/></span>)}</div>
          <div className="capacity-chart-axis"><span>0 min</span><span>{duration(horizon / 2)}</span><span>{duration(horizon)}</span></div>
          <label className="capacity-peak-select">Inspect interval peak<select data-testid="capacity-peak-interval" value={active} onChange={event => move(bins[Number(event.target.value)].peakAtMinutes)}>{bins.map((bin,index) => <option value={index} key={bin.startMinutes}>{bin.startMinutes}–{bin.endMinutes} min: {bin.peakQueue} queued at {bin.peakAtMinutes.toFixed(2)} min</option>)}</select></label>
          <p className="capacity-chart-note">Selected interval: {duration(bins[active].startMinutes)} to {duration(bins[active].endMinutes)} · peak {integer(bins[active].peakQueue)} queued jobs.</p>
        </figure>
        <figure className="capacity-availability-figure"><figcaption><h3>Idle capability through time</h3><p>Minimum idle on-duty units per interval · same unit may serve several types</p></figcaption>
          {TYPES.map(type => <div className="capacity-capability-row" key={type.id}><div><span>{type.label}</span><strong>{integer(snapshot.availableByType[type.id])} idle now</strong></div><div className="capacity-capability-bars" aria-hidden="true">{bins.map((bin,index) => <span key={bin.startMinutes} className={index === active ? 'active' : ''}><i style={{height: `${bin.minimumIdle[type.id] / Math.max(1,policy.units.length) * 100}%`}}/></span>)}</div></div>)}
          <div className="capacity-chart-axis"><span>0 min</span><span>{duration(horizon / 2)}</span><span>{duration(horizon)}</span></div>
          <p className="capacity-chart-note">Capability counts overlap and must not be summed. Interval minima can occur at different times from queue peaks; reachability also depends on the job's zone.</p>
        </figure>
      </div>
      <details className="capacity-replay-data"><summary>View interval data table</summary><p>Intervals are half-open [start, end). Queue peaks and idle minima can occur at different times. The horizon snapshot above includes the boundary itself.</p><div role="region" aria-label="Replay interval data" tabIndex={0}><table><thead><tr><th scope="col">Minutes</th><th scope="col">Peak queue</th><th scope="col">Peak minute</th>{TYPES.map(type => <th scope="col" key={type.id}>{type.label} min idle</th>)}</tr></thead><tbody>{bins.map(bin => <tr key={bin.startMinutes}><th scope="row">{bin.startMinutes}–{bin.endMinutes}</th><td>{integer(bin.peakQueue)}</td><td>{bin.peakAtMinutes.toFixed(2)}</td>{TYPES.map(type => <td key={type.id}>{integer(bin.minimumIdle[type.id])}</td>)}</tr>)}</tbody></table></div></details>
      <p className="capacity-replay-note">First-replication samples at the horizon: {integer(replay.metrics.responseSampleSize)} reached jobs for response; {integer(replay.metrics.queueSampleSize)} assigned jobs for queue wait. These are not aggregate counts across {integer(result.replications)} replications.</p>
    </section>
    <details className="capacity-result-provenance"><summary>Inspect run assumptions and provenance</summary><dl><dt>Generated</dt><dd>{timestamp(result.generatedAt, 'UTC')} · UTC</dd><dt>Input / paired samples</dt><dd><code>{shortHash(result.inputHash)} / {shortHash(result.pairedSamplesHash)}</code></dd><dt>Model / dataset / matrix</dt><dd><code>{result.modelVersion} / {shortHash(result.datasetHash)} / {shortHash(result.matrix.hash)}</code></dd><dt>Model / configuration hashes</dt><dd><code>{shortHash(result.modelHash)} / {shortHash(result.configHash)}</code></dd><dt>Road snapshot expires</dt><dd>{timestamp(result.matrix.expiresAt, 'UTC')} · UTC</dd></dl><ul>{result.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul></details>
  </div>;
}
