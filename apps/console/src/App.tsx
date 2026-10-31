import { Component, Suspense, lazy, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { CapacityProvider } from './capacityState';
import { ErrorState, LoadingState, PageHeading, Panel } from './components/ui';
import { finishSignIn, signIn, signInReturnPath } from './lib/auth';
import { Provider, useStandby } from './state';
const Overview=lazy(()=>import('./pages/Overview'));
const Capacity=lazy(()=>import('./pages/Capacity'));
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
 useEffect(()=>{if(!config||started.current)return;started.current=true;const controller=new AbortController(),returnTo=signInReturnPath();finishSignIn(config,controller.signal).then(session=>{if(controller.signal.aborted)return;setSession(session);toast('Operator session established. Choose an authorized workspace.');navigate(returnTo,{replace:true});}).catch(error=>{if(!controller.signal.aborted)setError(error);});return()=>controller.abort();},[config,setSession,toast,navigate]);
 return error?<Panel><ErrorState error={error} retry={()=>navigate('/settings',{replace:true})}/></Panel>:<LoadingState/>;
}
function EntryRedirect(){const{search,hash}=useLocation();return <Navigate to={`/overview${search}${hash}`} replace/>;}
function WorkspaceGate(){const{authError,session,config}=useStandby(),navigate=useNavigate(),[error,setError]=useState<Error|null>(null);return <><PageHeading title="Workspace access" description="Private workspaces open after the server verifies your membership."/><Panel>{authError||error?<p className="notice warning" role="alert">{error?.message??authError}</p>:<LoadingState/>}<div className="form-actions">{!session&&config?.auth?<button className="button primary" onClick={()=>void signIn(config).catch(setError)}>Operator sign in</button>:null}<button className="button secondary" onClick={()=>navigate('/overview')}>Open public simulator</button></div></Panel></>;}
function ScopedRoutes(){const{scopeKey}=useStandby(),{pathname}=useLocation(),callback=pathname==='/auth/callback';if(scopeKey.startsWith('pending:')&&!callback)return <WorkspaceGate key={scopeKey}/>;return <Routes key={callback?'auth-callback':scopeKey}><Route path="/" element={<EntryRedirect/>}/><Route path="/overview" element={<Overview/>}/><Route path="/incidents" element={<Incidents/>}/><Route path="/capacity" element={<Capacity/>}/><Route path="/map" element={<Coverage/>}/><Route path="/queues" element={<Queues/>}/><Route path="/settings" element={<Settings/>}/><Route path="/auth/callback" element={<AuthCallback/>}/><Route path="*" element={<EntryRedirect/>}/></Routes>;}
function ScopedConsole(){const{scopeKey}=useStandby(),{pathname}=useLocation(),previous=useRef(scopeKey);useEffect(()=>{if(previous.current!==scopeKey){previous.current=scopeKey;document.getElementById('main')?.focus({preventScroll:true});}},[scopeKey]);return <Shell key={pathname==='/auth/callback'?'auth-callback':scopeKey}><Suspense fallback={<LoadingState/>}><ScopedRoutes/></Suspense></Shell>;}
export function App(){return <ErrorBoundary><Provider><CapacityProvider><ScopedConsole/></CapacityProvider></Provider></ErrorBoundary>;}
