import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertCircle, LocateFixed } from 'lucide-react';
import type { PlanResult } from '../lib/types';
import { useStandby } from '../state';
import { Busy } from './ui';
import './unit-map.css';

interface Props {plan:PlanResult|undefined;layer:'coverage'|'demand'|'difference';selected:string|null;selectedSite:string|null;selectedUnit:string|null;focusRevision:number;onSelect:(id:string)=>void;onSelectSite:(id:string)=>void}
export default function MapCanvas({plan,layer,selected,selectedSite,selectedUnit,focusRevision,onSelect,onSelectSite}:Props){
 const{config,manifest,zones,result,input}=useStandby(),container=useRef<HTMLDivElement>(null),map=useRef<MapInstance|null>(null),markers=useRef<maplibregl.Marker[]>([]),callback=useRef(onSelect);
 const[ready,setReady]=useState(false),[mapError,setMapError]=useState<string|null>(null),[attempt,setAttempt]=useState(0),siteCallback=useRef(onSelectSite);callback.current=onSelect;siteCallback.current=onSelectSite;
 const bounds=manifest?.dataset.bounds;
 // The basemap remains dark in both console themes.
 const palette=useMemo(()=>{const style=getComputedStyle(document.documentElement),read=(name:string)=>style.getPropertyValue(name).trim();return{accent:read('--map-accent'),covered:read('--map-site'),stroke:read('--map-stroke'),warning:read('--map-warning'),danger:read('--map-danger'),demandMid:read('--map-demand-mid'),neutral:read('--map-neutral')};},[]);
 useEffect(()=>{
  if(!container.current||!config?.mapStyleUrl||!bounds){setMapError('The AWS map style is not configured. The zone list remains available.');return;}
  setReady(false);setMapError(null);let instance:MapInstance;
  try{
   const styleKey=config.mapApiKey??new URL(config.mapStyleUrl,location.origin).searchParams.get('key');
   instance=new maplibregl.Map({container:container.current,style:config.mapStyleUrl,center:[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],zoom:10.4,minZoom:9,maxZoom:16,maxBounds:[[bounds[0]-.15,bounds[1]-.12],[bounds[2]+.15,bounds[3]+.12]],attributionControl:{compact:true},transformRequest:(url)=>{if(styleKey&&/\.amazonaws\.com\//.test(url)){const target=new URL(url);if(!target.searchParams.has('key'))target.searchParams.set('key',styleKey);return{url:target.toString()};}return{url};}});
   map.current=instance;instance.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
   instance.on('load',()=>{instance.addSource('demand-zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});instance.addLayer({id:'zone-fill',type:'fill',source:'demand-zones',paint:{'fill-color':['get','color'],'fill-opacity':.36}});instance.addLayer({id:'zone-outline',type:'line',source:'demand-zones',paint:{'line-color':['get','color'],'line-width':['case',['==',['get','selected'],true],2,.65],'line-opacity':.7}});instance.addSource('representatives',{type:'geojson',data:{type:'FeatureCollection',features:[]}});instance.addLayer({id:'zone-points',type:'circle',source:'representatives',paint:{'circle-radius':['interpolate',['linear'],['get','demand'],0,2.5,40,6,150,10],'circle-color':['get','color'],'circle-opacity':.85,'circle-stroke-color':palette.stroke,'circle-stroke-width':1}});instance.on('click','zone-fill',event=>{const id=event.features?.[0]?.properties?.id;if(typeof id==='string')callback.current(id);});instance.on('mouseenter','zone-fill',()=>{instance.getCanvas().style.cursor='pointer';});instance.on('mouseleave','zone-fill',()=>{instance.getCanvas().style.cursor='';});setReady(true);});
   instance.on('error',()=>setMapError('The basemap could not finish loading. Zone data remains available below.'));
  }catch{setMapError('This browser could not initialize the interactive map. Use the accessible zone list below.');return;}
  const observer=new ResizeObserver(()=>instance.resize());observer.observe(container.current);
  return()=>{observer.disconnect();markers.current.forEach(m=>m.remove());markers.current=[];instance.remove();map.current=null;};
 },[config?.mapStyleUrl,config?.mapApiKey,bounds,attempt,palette]);
 const features=useMemo(()=>{
  const coverage=new Map(plan?.zones.map(z=>[z.zoneId,z])??[]),baseline=new Map(result?.plans.depot.zones.map(z=>[z.zoneId,z])??[]),proposal=new Map(result?.plans.proposal.zones.map(z=>[z.zoneId,z])??[]);
  return zones.map(zone=>{const outcome=coverage.get(zone.id),count=(plan?.cohort??input.cohort)==='train'?zone.trainCount:zone.holdoutCount;let color=palette.accent;
   if(layer==='coverage'&&outcome)color=outcome.covered?palette.covered:palette.warning;
   if(layer==='demand')color=count>=50?palette.accent:count>=15?palette.demandMid:palette.neutral;
   if(layer==='difference'){const before=baseline.get(zone.id)?.covered,after=proposal.get(zone.id)?.covered;color=after&&!before?palette.covered:before&&!after?palette.danger:palette.neutral;}
   return{zone,properties:{id:zone.id,color,demand:count,selected:zone.id===selected}};
  });
 },[zones,plan,layer,result,selected,input.cohort,palette]);
 useEffect(()=>{if(!ready||!map.current)return;const instance=map.current;
  (instance.getSource('demand-zones') as GeoJSONSource)?.setData({type:'FeatureCollection',features:features.map(({zone,properties})=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[zone.polygon]}}))});
  (instance.getSource('representatives') as GeoJSONSource)?.setData({type:'FeatureCollection',features:features.map(({zone,properties})=>({type:'Feature',properties,geometry:{type:'Point',coordinates:zone.position}}))});
 },[features,ready]);
 useEffect(()=>{
  if(!ready||!map.current)return;
  const focusedSite=(document.activeElement as HTMLElement|null)?.closest<HTMLButtonElement>('.unit-site-marker')?.dataset.siteId;
  markers.current.forEach(marker=>marker.remove());markers.current=[];
  for(const site of manifest?.dataset.sites??[]){
   const units=plan?.units.filter(unit=>unit.siteId===site.id)??[],active=units.some(unit=>unit.available);
   const element=document.createElement('button');element.type='button';
   element.className=`site-marker unit-site-marker ${units.length?'selected':''} ${units.length&&!active?'unavailable':''}`;
   element.dataset.siteId=site.id;element.dataset.unitIds=units.map(unit=>unit.id).join(',');element.dataset.residentCount=String(units.length);
   element.setAttribute('aria-controls','coverage-site-details');
   const pin=document.createElement('span');pin.className='unit-site-pin';pin.setAttribute('aria-hidden','true');element.append(pin);
   const label=document.createElement('span');label.className='unit-site-label';label.dataset.testid=`coverage-site-label-${site.id}`;
   const heading=document.createElement('strong');heading.className='unit-site-id';heading.textContent=site.id;label.append(heading);
   const count=document.createElement('span');count.className='unit-site-count';count.textContent=plan?`${units.length} ${units.length===1?'unit':'units'} · evaluated`:'Not evaluated';label.append(count);
   for(const unit of units){
    const row=document.createElement('span');row.className='unit-site-resident';row.dataset.unitId=unit.id;row.dataset.available=String(unit.available);
    const id=document.createElement('strong');id.textContent=unit.id;
    const status=document.createElement('span');status.textContent=unit.available?'Available':'Unavailable';
    row.append(id,status);label.append(row);
   }
   const help=document.createElement('span');help.className='sr-only';help.textContent=`${site.name}. Assumed planning site, not live GPS. Select site details.`;label.append(help);element.append(label);
   element.addEventListener('click',()=>siteCallback.current(site.id));
   markers.current.push(new maplibregl.Marker({element,anchor:'center'}).setLngLat(site.position).addTo(map.current));
   if(focusedSite===site.id)element.focus({preventScroll:true});
  }
 },[manifest?.dataset.sites,plan,ready]);
 useEffect(()=>{
  if(!ready||!map.current||!container.current)return;
  const instance=map.current,frame=container.current;
  // Only the label box moves to fit the viewport. Each pin remains at the exact site coordinate.
  function positionLabels(){
   const width=frame.clientWidth,height=frame.clientHeight;
   for(const marker of markers.current){
    const element=marker.getElement(),label=element.querySelector<HTMLElement>('.unit-site-label');if(!label)continue;
    const point=instance.project(marker.getLngLat()),visible=point.x>=0&&point.x<=width&&point.y>=0&&point.y<=height;
    element.style.visibility=visible?'visible':'hidden';element.tabIndex=visible?0:-1;
    const left=Math.max(8,Math.min(point.x-label.offsetWidth/2,width-label.offsetWidth-8));
    const preferredTop=point.y+18;
    const top=Math.max(52,Math.min(preferredTop+label.offsetHeight>height-52?point.y-label.offsetHeight-18:preferredTop,height-label.offsetHeight-52));
    label.style.left=`${22+left-point.x}px`;label.style.top=`${22+top-point.y}px`;
    element.classList.toggle('focused',element.dataset.siteId===selectedSite);element.setAttribute('aria-pressed',String(element.dataset.siteId===selectedSite));
    for(const row of element.querySelectorAll<HTMLElement>('.unit-site-resident')){
     const isSelected=row.dataset.unitId===selectedUnit;row.classList.toggle('is-selected-unit',isSelected);if(isSelected)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
    }
   }
  }
  positionLabels();instance.on('move',positionLabels);instance.on('resize',positionLabels);
  return()=>{instance.off('move',positionLabels);instance.off('resize',positionLabels);};
 },[ready,plan,manifest?.dataset.sites,selectedSite,selectedUnit]);
 useEffect(()=>{const zone=zones.find(z=>z.id===selected);if(zone&&ready)map.current?.easeTo({center:zone.position,zoom:12,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300});},[selected,zones,ready]);
 useEffect(()=>{const site=manifest?.dataset.sites.find(s=>s.id===selectedSite);if(site&&ready)map.current?.easeTo({center:site.position,zoom:12,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300});},[selectedSite,manifest?.dataset.sites,ready,focusRevision]);
 return <div className="map-canvas-wrap"><div ref={container} className="map-canvas" aria-label="Austin demand zones and hypothetical standby sites" role="region"/>{!ready&&!mapError?<div className="map-loading"><Busy label="Loading AWS basemap"/></div>:null}{mapError?<div className="map-error" role="alert"><AlertCircle size={16}/><span>{mapError}</span><button onClick={()=>setAttempt(n=>n+1)}>Retry map</button></div>:null}<button className="map-fit icon-button" title="Fit study area" aria-label="Fit Austin study area" onClick={()=>bounds&&map.current?.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:35,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300})}><LocateFixed size={18}/></button><div className="map-study-label"><span className="status-dot"/><span>AUSTIN STUDY AREA</span><small>Zone representatives · not isochrones</small></div></div>;
}
