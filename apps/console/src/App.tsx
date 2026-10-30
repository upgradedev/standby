import { Component, Suspense, lazy, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeading, Panel } from './components/ui';
import { finishSignIn } from './lib/auth';
import { Provider, useStandby } from './state';
const Overview=lazy(()=>import('./pages/Overview'));
const Incidents=lazy(()=>import('./pages/Incidents'));
const Coverage=lazy(()=>import('./pages/Coverage'));
const Queues=lazy(()=>import('./pages/Queues'));
const Settings=lazy(()=>import('./pages/Settings'));

class ErrorBoundary extends Component<{children:ReactNode},{error:Error|null}>{
 state:{error:Error|null}={error:null};
 static getDerivedStateFromError(error:Error){return{error};}
 componentDidCatch(_error:Error,_info:ErrorInfo){/* Error text never includes source or provider payloads in telemetry. */}
 render(){return this.state.error?<div className="fatal-error"><h1>Standby needs a refresh</h1><p>The current view could not render. Your saved input scenarios remain on this device.</p><button className="button primary" onClick={()=>location.reload()}>Reload application</button></div>:this.props.children;}
}
function AuthCallback(){const{config,setSession,toast}=useStandby(),navigate=useNavigate(),[error,setError]=useState<Error|null>(null),started=useRef(false);
 useEffect(()=>{if(!config||started.current)return;started.current=true;finishSignIn(config).then(session=>{setSession(session);toast('Operator session established. Choose an authorized workspace.');navigate('/overview',{replace:true});}).catch(error=>setError(error));},[config,setSession,toast,navigate]);
 return error?<Panel><ErrorState error={error} retry={()=>navigate('/settings',{replace:true})}/></Panel>:<LoadingState/>;
}
export function App(){return <ErrorBoundary><Provider><Shell><Suspense fallback={<LoadingState/>}><Routes><Route path="/" element={<Navigate to="/overview" replace/>}/><Route path="/overview" element={<Overview/>}/><Route path="/incidents" element={<Incidents/>}/><Route path="/capacity" element={<><PageHeading title="Capacity lab" description="Assumption-based fleet planning: mixed units, overlapping jobs and paired what-if." actions={<Badge tone="accent">Scope preview</Badge>}/><Panel><EmptyState title="Scenario controls are not available in this preview" description="The planned workspace brings baseline and candidate rosters, editable workload and service assumptions, queue replay and modeled-job map detail together. This preview covers the shell and Overview." action={<Link className="button secondary" to="/overview">Back to Overview</Link>}/></Panel></>}/><Route path="/map" element={<Coverage/>}/><Route path="/queues" element={<Queues/>}/><Route path="/settings" element={<Settings/>}/><Route path="/auth/callback" element={<AuthCallback/>}/><Route path="*" element={<Navigate to="/overview" replace/>}/></Routes></Suspense></Shell></Provider></ErrorBoundary>;}
