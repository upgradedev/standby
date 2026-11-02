/** Offline instrument only: the frozen component and CSS, without application providers or APIs. */
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CapacityAssumptions} from '../../apps/console/src/components/capacity/CapacityAssumptions';
import {createDefaultCapacityInput} from '../../packages/contracts/src/capacity';
import type {StandbySite} from '../../packages/contracts/src/index';
import '../../apps/console/src/styles.css';
import '../../apps/console/src/theme.css';
import '../../apps/console/src/pages/capacity.css';

const sites: StandbySite[] = [
  {id:'site-01',name:'Offline fixture site 1',position:[-97.74,30.27],assumed:true},
  {id:'site-02',name:'Offline fixture site 2',position:[-97.75,30.28],assumed:true},
  {id:'site-03',name:'Offline fixture site 3',position:[-97.76,30.29],assumed:true},
];
function initialInput() {
  const input=createDefaultCapacityInput(sites.map(site=>site.id));
  input.replications=1;input.jobCount=2;input.recoveryMinutes=10;
  input.arrivalWeights=[1,0,0,0,0,0,0,0];
  for(const type of ['battery','tyre','breakdown','collision'] as const)input.typeProfiles[type].share=type==='collision'?1:0;
  input.typeProfiles.collision.onSiteMinutes={min:60,mode:60,max:60};
  input.typeProfiles.collision.flatbedTransportMinutes=60;
  return input;
}
function Fixture() {
  const [input,setInput]=useState(initialInput);
  const [disabled,setDisabled]=useState(false),[blocked,setBlocked]=useState(false);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span>Offline fixture</span></div></aside>
    <div className="app-main">
      <header className="topbar">
        <strong>OFFLINE ACTUAL COMPONENT FIXTURE</strong>
        <button className="button secondary" type="button" onClick={()=>setDisabled(true)}>Disable fixture controls</button>
        <button className="button secondary" type="button" onClick={()=>setBlocked(true)}>Block fixture pointer</button>
      </header>
      <main className="capacity-page">
        <h1>Capacity assumptions control</h1>
        <p>Actual frozen component and styles. No model, Provider, map, product request or operational claim.</p>
        <details className="capacity-configuration" open>
          <summary>Editable assumptions</summary>
          <form data-testid="fixture-form" onSubmit={event=>event.preventDefault()}>
            <CapacityAssumptions input={input} sites={sites} disabled={disabled} onChange={setInput}/>
          </form>
        </details>
        <output data-testid="fixture-input" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify(input)}</output>
      </main>
    </div>
    {blocked?<div data-testid="fixture-pointer-blocker" style={{position:'fixed',inset:'64px 0 0',zIndex:1000,background:'rgb(0 0 0 / .2)'}}>Deliberate offline fixture pointer blocker</div>:null}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
