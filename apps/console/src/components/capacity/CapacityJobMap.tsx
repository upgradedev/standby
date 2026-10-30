import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertCircle, LocateFixed } from 'lucide-react';
import type { DemandZone, StandbySite } from '../../../../../packages/contracts/src/index';
import { useStandby } from '../../state';
import { Busy } from '../ui';

interface Props {zone:DemandZone;site:StandbySite|undefined;expanded:boolean}
function fitSelection(instance:MapInstance,zone:DemandZone,site:StandbySite|undefined) {
  const bounds=new maplibregl.LngLatBounds();
  bounds.extend(zone.position);
  for(const position of zone.polygon)bounds.extend(position);
  if(site)bounds.extend(site.position);
  instance.fitBounds(bounds,{padding:55,maxZoom:13,duration:0});
}

/** Geography only: the point represents a zone, never a customer or vehicle position. */
export default function CapacityJobMap({zone,site,expanded}:Props) {
  const {config,manifest}=useStandby();
  const container=useRef<HTMLDivElement>(null),map=useRef<MapInstance|null>(null);
  const selection=useRef({zone,site});selection.current={zone,site};
  const [ready,setReady]=useState(false),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  const bounds=manifest?.dataset.bounds;
  useEffect(()=>{
    setReady(false);setError(null);
    if(!container.current||!config?.mapStyleUrl||!bounds){setError('The AWS basemap is not configured. Representative coordinates remain available below.');return;}
    let instance:MapInstance;let removeFailed:(()=>void)|undefined;let initialized=false;
    try {
      const key=config.mapApiKey??new URL(config.mapStyleUrl,location.origin).searchParams.get('key');
      instance=new maplibregl.Map({container:container.current,style:config.mapStyleUrl,
        center:selection.current.zone.position,zoom:12,minZoom:8,maxZoom:16,
        maxBounds:[[bounds[0]-.2,bounds[1]-.2],[bounds[2]+.2,bounds[3]+.2]],
        attributionControl:{compact:true},transformRequest:(url)=>{
          if(key&&/\.amazonaws\.com\//.test(url)){const target=new URL(url);if(!target.searchParams.has('key'))target.searchParams.set('key',key);return{url:target.toString()};}
          return{url};
        }});
      map.current=instance;removeFailed=()=>instance.remove();
      instance.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      instance.on('load',()=>{
        const style=getComputedStyle(container.current!);
        const accent=style.getPropertyValue('--map-accent').trim(),success=style.getPropertyValue('--map-site').trim();
        instance.addSource('capacity-selected-zone',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        instance.addLayer({id:'capacity-zone-fill',type:'fill',source:'capacity-selected-zone',paint:{'fill-color':accent,'fill-opacity':.18}});
        instance.addLayer({id:'capacity-zone-outline',type:'line',source:'capacity-selected-zone',paint:{'line-color':accent,'line-width':2}});
        instance.addSource('capacity-selected-points',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        instance.addLayer({id:'capacity-representative-points',type:'circle',source:'capacity-selected-points',paint:{
          'circle-radius':['case',['==',['get','kind'],'site'],8,7],
          'circle-color':['case',['==',['get','kind'],'site'],success,accent],
          'circle-stroke-color':style.getPropertyValue('--map-stroke').trim(),'circle-stroke-width':2}});
        initialized=true;fitSelection(instance,selection.current.zone,selection.current.site);
        setError(null);setReady(true);
      });
      instance.on('error',()=>setError('The AWS basemap could not finish loading. Use the representative coordinates below or retry the map.'));
    } catch {removeFailed?.();map.current=null;setError('This browser could not initialize the map. Representative coordinates remain available below.');return;}
    const observer=new ResizeObserver(()=>{
      instance.resize();
      if(initialized)fitSelection(instance,selection.current.zone,selection.current.site);
    });observer.observe(container.current);
    return()=>{observer.disconnect();instance.remove();map.current=null;};
  },[config?.mapStyleUrl,config?.mapApiKey,bounds,attempt]);

  useEffect(()=>{
    if(!ready||!map.current)return;
    const instance=map.current;
    (instance.getSource('capacity-selected-zone') as GeoJSONSource)?.setData({type:'FeatureCollection',features:[{
      type:'Feature',properties:{id:zone.id},geometry:{type:'Polygon',coordinates:[zone.polygon]},
    }]});
    (instance.getSource('capacity-selected-points') as GeoJSONSource)?.setData({type:'FeatureCollection',features:[
      {type:'Feature',properties:{kind:'zone'},geometry:{type:'Point',coordinates:zone.position}},
      ...(site?[{type:'Feature' as const,properties:{kind:'site'},geometry:{type:'Point' as const,coordinates:site.position}}]:[]),
    ]});
    fitSelection(instance,zone,site);
  },[zone,site,ready]);

  return <div className={`capacity-map-wrap ${expanded?'is-expanded':''}`} data-map-ready={ready&&!error?'true':'false'}>
    <div ref={container} className="capacity-job-map" role="region" aria-label="AWS map of the modeled job zone representative and assigned assumed home site" data-testid="capacity-job-map"/>
    {!ready&&!error?<div className="capacity-map-message" role="status"><Busy label="Loading AWS basemap"/></div>:null}
    {error?<div className="capacity-map-message capacity-map-error" role="alert"><AlertCircle size={22}/><p>{error}</p><button type="button" className="button secondary" onClick={()=>setAttempt(value=>value+1)}>Retry map</button></div>:null}
    {ready&&!error?<button type="button" className="capacity-map-fit icon-button" aria-label="Fit selected representative and assumed site" title="Fit selected locations" onClick={()=>map.current&&fitSelection(map.current,zone,site)}><LocateFixed size={18}/></button>:null}
  </div>;
}
