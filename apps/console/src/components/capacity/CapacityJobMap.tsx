import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertCircle, LocateFixed } from 'lucide-react';
import type { DemandZone, StandbySite } from '../../../../../packages/contracts/src/index';
import type { CapacityUnit } from '../../../../../packages/contracts/src/capacity';
import { useStandby } from '../../state';
import { Busy } from '../ui';

interface Props {zone:DemandZone;site:StandbySite|undefined;unit:CapacityUnit|undefined;expanded:boolean}
interface LabelPoint {left:number;top:number}
interface LabelSize {width:number;height:number}
interface LabelRect extends LabelPoint,LabelSize {}

/** Container pixels only. Neither the site's coordinate nor the camera changes. */
function placeHomeLabelBox(anchor:LabelPoint,box:LabelSize,frame:LabelSize,controls:readonly LabelRect[]) {
  const margin=8,gap=13;
  const maxLeft=Math.max(margin,frame.width-box.width-margin),maxTop=Math.max(margin,frame.height-box.height-margin);
  const centered=Math.min(maxLeft,Math.max(margin,anchor.left-box.width/2));
  const above=anchor.top-box.height-gap,below=anchor.top+gap;
  const fallbackTop=Math.min(maxTop,Math.max(margin,above));
  const candidates=[];
  if(above>=margin&&above<=maxTop)candidates.push({left:centered,top:above});
  if(below>=margin&&below<=maxTop)candidates.push({left:centered,top:below});
  candidates.push({left:centered,top:fallbackTop});
  for(const control of controls){
    candidates.push({left:centered,top:control.top+control.height+margin},{left:centered,top:control.top-box.height-margin},
      {left:control.left+control.width+margin,top:fallbackTop},{left:control.left-box.width-margin,top:fallbackTop});
  }
  let best=candidates[0]!,leastOverlap=Infinity;
  for(const candidate of candidates){
    const left=Math.min(maxLeft,Math.max(margin,candidate.left)),top=Math.min(maxTop,Math.max(margin,candidate.top));
    let overlap=0;
    for(const control of controls){
      overlap+=Math.max(0,Math.min(left+box.width,control.left+control.width+4)-Math.max(left,control.left-4))
        *Math.max(0,Math.min(top+box.height,control.top+control.height+4)-Math.max(top,control.top-4));
    }
    if(overlap===0)return {left,top};
    if(overlap<leastOverlap){leastOverlap=overlap;best={left,top};}
  }
  return best;
}

function fitSelection(instance:MapInstance,zone:DemandZone,site:StandbySite|undefined) {
  const container=instance.getContainer();
  if(container.clientWidth<=0||container.clientHeight<=0)return;
  const bounds=new maplibregl.LngLatBounds();
  bounds.extend(zone.position);
  for(const position of zone.polygon)bounds.extend(position);
  if(site)bounds.extend(site.position);
  const horizontal=Math.max(82,container.clientWidth*.18),vertical=Math.max(104,container.clientHeight*.18);
  const padding={left:horizontal,right:horizontal,top:vertical,bottom:vertical};
  instance.fitBounds(bounds,{padding,maxZoom:13,duration:0});
}

/** Geography only: the point represents a zone, never a customer or vehicle position. */
export default function CapacityJobMap({zone,site,unit,expanded}:Props) {
  const {config,manifest}=useStandby();
  const container=useRef<HTMLDivElement>(null),map=useRef<MapInstance|null>(null);
  const homeLabel=useRef<maplibregl.Marker|null>(null);
  const selection=useRef({zone,site});selection.current={zone,site};
  const [ready,setReady]=useState(false),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  const bounds=manifest?.dataset.bounds;
  useEffect(()=>{
    setReady(false);setError(null);
    if(!container.current||!config?.mapStyleUrl||!bounds){setError('The AWS basemap is not configured. Representative coordinates remain available below.');return;}
    const styleUrl=config.mapStyleUrl,apiKey=config.mapApiKey,area=bounds;
    let instance:MapInstance|null=null,initialized=false,disposed=false,failed=false;
    const initialize=()=>{
      const element=container.current;
      if(!element||element.clientWidth<=0||element.clientHeight<=0||instance||disposed||failed)return;
      let created:MapInstance|undefined;
      try {
      const key=apiKey??new URL(styleUrl,location.origin).searchParams.get('key');
      const active=new maplibregl.Map({container:element,style:styleUrl,
        center:selection.current.zone.position,zoom:12,minZoom:8,maxZoom:16,
        maxBounds:[[area[0]-.2,area[1]-.2],[area[2]+.2,area[3]+.2]],
        attributionControl:{compact:true},transformRequest:(url)=>{
          if(key&&/\.amazonaws\.com\//.test(url)){const target=new URL(url);if(!target.searchParams.has('key'))target.searchParams.set('key',key);return{url:target.toString()};}
          return{url};
        }});
      created=active;instance=active;map.current=active;
      active.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      active.on('load',()=>{
        if(disposed)return;
        const style=getComputedStyle(container.current!);
        const accent=style.getPropertyValue('--map-accent').trim(),success=style.getPropertyValue('--map-site').trim();
        active.addSource('capacity-selected-zone',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        active.addLayer({id:'capacity-zone-fill',type:'fill',source:'capacity-selected-zone',paint:{'fill-color':accent,'fill-opacity':.18}});
        active.addLayer({id:'capacity-zone-outline',type:'line',source:'capacity-selected-zone',paint:{'line-color':accent,'line-width':2}});
        active.addSource('capacity-selected-points',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        active.addLayer({id:'capacity-representative-points',type:'circle',source:'capacity-selected-points',paint:{
          'circle-radius':['case',['==',['get','kind'],'site'],8,7],
          'circle-color':['case',['==',['get','kind'],'site'],success,accent],
          'circle-stroke-color':style.getPropertyValue('--map-stroke').trim(),'circle-stroke-width':2}});
        initialized=true;fitSelection(active,selection.current.zone,selection.current.site);
        setError(null);setReady(true);
      });
      active.on('error',()=>{if(!disposed)setError('The AWS basemap could not finish loading. Use the representative coordinates below or retry the map.');});
      } catch {failed=true;created?.remove();instance=null;map.current=null;setError('This browser could not initialize the map. Representative coordinates remain available below.');}
    };
    const observer=new ResizeObserver(()=>{
      const element=container.current;
      // Native close and inactive tabs have zero area. Keep the SDK resource,
      // without resizing/refitting WebGL against a hidden presentation box.
      if(!element||element.clientWidth<=0||element.clientHeight<=0)return;
      const active=instance;
      if(!active){initialize();return;}
      active.resize();
      if(initialized)fitSelection(active,selection.current.zone,selection.current.site);
    });observer.observe(container.current);
    initialize();
    return()=>{disposed=true;observer.disconnect();homeLabel.current?.remove();homeLabel.current=null;instance?.remove();map.current=null;};
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
    homeLabel.current?.remove();homeLabel.current=null;
    let removePlacement:(()=>void)|undefined;
    if(site&&unit){
      // This label is attached to configured home geography, never to a vehicle
      // coordinate inferred from the replay's service/transport phase.
      const anchor=document.createElement('div');anchor.className='capacity-unit-home-anchor';
      const element=document.createElement('div');element.className='capacity-unit-home-marker';
      element.setAttribute('role','img');element.setAttribute('aria-label',`${unit.id}, ${unit.kind.replace(/_/g,' ')}. Assumed home ${site.name}; current vehicle location is unknown.`);
      element.dataset.testid='capacity-unit-home-marker';
      const kind=unit.kind.replace(/_/g,' ');
      const identity=document.createElement('strong');identity.textContent=`${unit.id} · ${kind.charAt(0).toUpperCase()+kind.slice(1)}`;
      const meaning=document.createElement('span');meaning.textContent='Assumed home · not GPS';
      element.append(identity,meaning);
      anchor.append(element);
      // The zero-size marker stays at the exact site. Only its child label box
      // receives a pixel offset, so edge clipping never moves the geographic dot.
      const marker=new maplibregl.Marker({element:anchor,anchor:'center'}).setLngLat(site.position).addTo(instance);
      homeLabel.current=marker;
      let frame:number|null=null;
      const place=()=>{
        const canvas=instance.getContainer(),bounds=canvas.getBoundingClientRect();
        if(bounds.width<=16||bounds.height<=16){element.style.visibility='hidden';return;}
        anchor.style.setProperty('--capacity-label-room',`${bounds.width-16}px`);
        const point=anchor.getBoundingClientRect(),box=element.getBoundingClientRect();
        if(point.left<bounds.left||point.left>bounds.right||point.top<bounds.top||point.top>bounds.bottom){element.style.visibility='hidden';return;}
        const controls=Array.from(canvas.parentElement?.querySelectorAll<HTMLElement>('.maplibregl-ctrl-group,.maplibregl-ctrl-attrib,.capacity-map-fit')??[])
          .map(control=>control.getBoundingClientRect()).filter(control=>control.width>0&&control.height>0)
          .map(control=>({left:control.left-bounds.left,top:control.top-bounds.top,width:control.width,height:control.height}));
        const position=placeHomeLabelBox({left:point.left-bounds.left,top:point.top-bounds.top},box,bounds,controls);
        element.style.left=`${position.left-(point.left-bounds.left)}px`;
        element.style.top=`${position.top-(point.top-bounds.top)}px`;
        element.style.visibility='visible';
      };
      const schedule=()=>{if(frame===null)frame=requestAnimationFrame(()=>{frame=null;place();});};
      const observer=new ResizeObserver(schedule);observer.observe(element);observer.observe(instance.getContainer());
      for(const control of instance.getContainer().parentElement?.querySelectorAll<HTMLElement>('.maplibregl-ctrl-group,.maplibregl-ctrl-attrib,.capacity-map-fit')??[])observer.observe(control);
      // Marker projection can commit during the SDK's render. Clamp there too,
      // before paint, rather than relying on a delayed move/resize observation.
      instance.on('move',schedule);instance.on('resize',schedule);instance.on('render',place);schedule();
      removePlacement=()=>{
        if(frame!==null)cancelAnimationFrame(frame);
        observer.disconnect();instance.off('move',schedule);instance.off('resize',schedule);instance.off('render',place);marker.remove();
        if(homeLabel.current===marker)homeLabel.current=null;
      };
    }
    fitSelection(instance,zone,site);
    return removePlacement;
  },[zone,site,unit,ready]);

  return <div className={`capacity-map-wrap ${expanded?'is-expanded':''}`} data-map-ready={ready&&!error?'true':'false'}>
    <div ref={container} className="capacity-job-map" role="region" aria-label="AWS map of the modeled job zone representative and assigned assumed home site" data-testid="capacity-job-map"/>
    {!ready&&!error?<div className="capacity-map-message" role="status"><Busy label="Loading AWS basemap"/></div>:null}
    {error?<div className="capacity-map-message capacity-map-error" role="alert"><AlertCircle size={22}/><p>{error}</p><button type="button" className="button secondary" onClick={()=>setAttempt(value=>value+1)}>Retry map</button></div>:null}
    {ready&&!error?<button type="button" className="capacity-map-fit icon-button" aria-label="Fit selected representative and assumed site" title="Fit selected locations" onClick={()=>map.current&&fitSelection(map.current,zone,site)}><LocateFixed size={18}/></button>:null}
  </div>;
}
