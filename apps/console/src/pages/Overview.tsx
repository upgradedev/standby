import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Clock3, FileBarChart2, FlaskConical, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { integer, percent, quantile, shortHash, timestamp } from '../lib/format';
import { useStandby } from '../state';
import { Badge, Busy, DataGate, ErrorState, PageHeading, Panel, SourceNote } from '../components/ui';

export default function Overview() {
  const {manifest,zones,result,input,evaluating,evaluationError,stale,evaluate,preferences}=useStandby();
  const dataset=manifest?.dataset;
  const cohort=input.cohort??'holdout';
  const cohortLabel=cohort==='train'?'2023–2024 training':'2025 held-out';
  const distribution=dataset?.distribution[cohort];
  const hours=distribution?.hours??[];
  const maximum=Math.max(1,...hours);
  const peakHour=hours.indexOf(Math.max(...hours));
  const demand=zones.reduce((sum,zone)=>sum+(cohort==='train'?zone.trainCount:zone.holdoutCount),0);
  // An edited/failed evaluation never lends its old figures to a new input scope.
  const currentResult=!stale&&!evaluationError?result:null;
  const plan=currentResult?.plans.proposal;
  const delta=currentResult?currentResult.plans.proposal.coveragePct-currentResult.plans.depot.coveragePct:null;
  const threshold=currentResult?.input.thresholdMinutes??input.thresholdMinutes;

  return <DataGate>
    <PageHeading title="Overview" description="Plan standby positions with real geography. Keep capacity assumptions visible."
      actions={<><Badge>Historical study</Badge><Link className="button primary" to="/map">Open coverage map<ArrowUpRight size={16}/></Link></>}/>
    <div className="context-strip">
      <span><span className="context-icon"><MapPin size={15}/></span>Austin, Texas</span>
      <span>{cohortLabel} reports</span><span>{integer(zones.length)} train-derived zones</span>
      <span className="context-right">Snapshot <code>{shortHash(dataset?.hash)}</code></span>
    </div>
    <div className="overview-scope"><strong>Historical coverage</strong><span>Generic placement fleet · directional Car approach · no workload or service-time assumptions in these figures</span></div>
    <div className="kpi-grid">
      <Kpi label="Eligible historical reports" value={integer(demand)} note={`${cohortLabel} cohort · all eligible reports`} icon={<FileBarChart2 size={18}/>} tag="OBSERVED"/>
      <Kpi label="Available placement units" value={`${input.fleetSize-(input.unavailableUnitId?1:0)}`} note={`${input.fleetSize} assumed generic service vehicles`} icon={<Truck size={18}/>} tag="ASSUMED"/>
      <Kpi label={`Within ${threshold} min by road`} value={plan?percent(plan.coveragePct):'Not evaluated'} note={plan?`${integer(plan.coveredDemand)} / ${integer(plan.totalDemand)} report weights`:'Run a matching coverage comparison'} icon={<ShieldCheck size={18}/>} tag="MODELED" positive={!!plan}/>
      <Kpi label="P90 road approach" value={quantile(plan?.p90)} note={plan?`Report-weighted · n=${integer(plan.totalDemand)} · travel only`:'Customer response time is not measured here'} icon={<Clock3 size={18}/>} tag="MODELED"/>
    </div>
    <section className="capacity-callout" aria-labelledby="capacity-intro-title">
      <div className="capacity-callout-icon"><FlaskConical size={27}/></div>
      <div className="capacity-callout-copy"><Badge tone="accent">Capacity lab · scope preview</Badge>
        <h2 id="capacity-intro-title">From positions to capacity.</h2>
        <p>Explore how fleet mix, overlapping jobs and service time can change a standby plan.</p>
        <div className="capacity-concepts"><span>Mixed fleet</span><span>Queues &amp; shifts</span><span>Paired what-if</span></div>
      </div>
      <Link className="button secondary" to="/capacity">View capacity scope<ArrowRight size={16}/></Link>
    </section>
    <div className="overview-grid">
      <Panel title="When reports were published" kicker="Historical publication pattern" action={<Badge>{cohortLabel}</Badge>}>
        <figure className="publication-figure">
          <figcaption className="chart-description"><strong>Publication hour</strong><span>America/Chicago · DST aware</span></figcaption>
          <svg className="publication-chart" viewBox="0 0 240 100" preserveAspectRatio="none" role="img" aria-label={`Publication counts by hour, ${integer(demand)} eligible ${cohortLabel} reports. Values are available in the hourly table.`}>
            {[0,25,50,75,100].map(y=><line key={y} x1="0" x2="240" y1={y} y2={y} className="publication-gridline" vectorEffect="non-scaling-stroke"/>)}
            {hours.map((count,hour)=>{const height=count/maximum*100;return <rect key={hour} x={hour*10+1.5} width="7" y={100-height} height={height} rx="1" className="publication-bar"><title>{`${hour.toString().padStart(2,'0')}:00 · ${integer(count)} reports`}</title></rect>;})}
          </svg>
          <div className="publication-axis" aria-hidden="true">{[0,4,8,12,16,20].map(hour=><span key={hour}>{String(hour).padStart(2,'0')}:00</span>)}</div>
          <p className="publication-summary">{peakHour>=0?<>Highest publication count: <strong>{String(peakHour).padStart(2,'0')}:00 · {integer(hours[peakHour])} reports</strong></>:'No hourly observations recorded.'}</p>
        </figure>
        <div className="chart-footer"><span>Publication time is not the time a breakdown occurred. Display only.</span><Link to="/incidents">Explore zones<ArrowRight size={13}/></Link></div>
        <details className="data-alternative"><summary>View hourly data table</summary><div className="mini-table-wrap"><table><caption className="sr-only">{cohortLabel} publication counts, America/Chicago</caption><thead><tr><th>Hour · Chicago</th><th>Reports</th></tr></thead><tbody>{hours.map((count,hour)=><tr key={hour}><td>{String(hour).padStart(2,'0')}:00</td><td>{integer(count)}</td></tr>)}</tbody></table></div></details>
      </Panel>
      <Panel title="Same fleet. Different positions." kicker="Historical coverage comparison" action={evaluating?<Busy label="Evaluating"/>:<Badge tone="accent">{threshold} min threshold</Badge>}>
        {evaluationError?<ErrorState error={evaluationError} retry={()=>void evaluate()}/>:currentResult&&delta!==null?<>
          <div className="comparison-big"><span className="comparison-value">{delta>=0?'+':''}{delta.toFixed(1)}<small>pp</small></span><div>modeled coverage change<small>Proposal vs depot · {cohortLabel} reports</small></div></div>
          <div className="comparison-chart">{(['depot','spread','proposal'] as const).map(key=>{const item=currentResult.plans[key];return <div className={`comparison-row ${key==='proposal'?'proposal':''}`} key={key}><div><span>{key==='depot'?'Single depot':key==='spread'?'Geographic spread':'Standby proposal'}</span><strong>{percent(item.coveragePct)}</strong></div><div className="comparison-track"><span style={{width:`${item.coveragePct}%`}}/></div></div>;})}</div>
          <div className="chart-footer"><span>Selected using training geography. All plans share the same {integer(plan!.totalDemand)} report weights.</span><Link to="/map">Compare plans<ArrowRight size={13}/></Link></div>
          <details className="data-alternative"><summary>View coverage data table</summary><table><thead><tr><th>Plan</th><th>Covered / total</th><th>P90 approach</th></tr></thead><tbody>{Object.values(currentResult.plans).map(item=><tr key={item.id}><td>{item.name}</td><td>{integer(item.coveredDemand)} / {integer(item.totalDemand)}</td><td>{quantile(item.p90)}</td></tr>)}</tbody></table></details>
        </>:<div className="evaluation-placeholder"><ShieldCheck size={30}/><h3>{manifest?.matrix?'Calculate historical coverage':'Route snapshot unavailable'}</h3><p>{stale?'Inputs changed. Run a comparison for the current scope.':manifest?.matrix?'Evaluate a depot, geographic spread and a train-selected proposal with prepared Amazon Location road times.':'A valid prepared road-time snapshot is required.'}</p>{manifest?.matrix?<button className="button secondary" disabled={evaluating} onClick={()=>void evaluate()}>{evaluating?<Busy/>:'Calculate coverage'}</button>:null}</div>}
      </Panel>
    </div>
    <div className="overview-lower">
      <Panel title="A plan you can interrogate" kicker="Historical study workflow"><div className="briefing-steps">
        <div><span>01</span><div><h3>Inspect the geography</h3><p>Read aggregated reports and data-quality limits. Keep training and evaluation cohorts separate.</p></div><Link to="/incidents" aria-label="Inspect incident history"><ArrowUpRight size={18}/></Link></div>
        <div><span>02</span><div><h3>Compare standby positions</h3><p>Use the same fleet and report weights for depot, spread and proposal.</p></div><Link to="/map" aria-label="Compare standby positions"><ArrowUpRight size={18}/></Link></div>
        <div><span>03</span><div><h3>Test one unavailable unit</h3><p>Expose the remaining geographical gaps. Service queues require a separate capacity scenario.</p></div><Link to="/map" aria-label="Test an unavailable unit"><ArrowUpRight size={18}/></Link></div>
      </div></Panel>
      <Panel title="Know the evidence" kicker="Sources & assumptions"><div className="provenance-summary">
        <div><span className="status-dot"/><strong>City of Austin Open Data</strong><p>Aggregated stalled-vehicle publication reports. Private insured and service records are not connected.</p></div>
        <div><span className="status-dot accent"/><strong>Amazon Location road times</strong><p>Directional Car approach to zone representatives. Standby sites and placement fleet are assumed.</p></div>
        {dataset?<p className="snapshot-time">Dataset generated <time dateTime={dataset.generatedAt}>{timestamp(dataset.generatedAt,preferences.timezone)} · {preferences.timezone}</time></p>:null}
        <Link to="/settings">Inspect data &amp; model provenance<ArrowUpRight size={14}/></Link>
      </div></Panel>
    </div>
    <SourceNote/>
  </DataGate>;
}

function Kpi({label,value,note,icon,tag,positive=false}:{label:string;value:string;note:string;icon:ReactNode;tag:string;positive?:boolean}) {
  return <section className={`kpi-card ${positive?'highlight':''}`}><div className="kpi-label">{label}<span className="kpi-icon">{icon}</span></div><div className={`kpi-value ${value==='Not evaluated'?'kpi-unavailable':''}`}>{value}</div><div className="kpi-note">{note}</div><span className="kpi-tag">{tag}</span></section>;
}
