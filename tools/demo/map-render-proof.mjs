/** Verify painted map content, not merely an initialized SDK or AX buttons.
 * Screenshot bytes and decoded samples stay in memory; nothing is written.
 */
import {execFileSync, spawnSync} from 'node:child_process';
const check=(condition,code)=>{if(!condition)throw new Error(code);};

export function validateMapGeometry(geometry,{viewport=false}={}) {
  check(geometry.container.width>=200&&geometry.container.height>=200,'map-container-has-no-usable-area');
  check(geometry.canvas.width>=200&&geometry.canvas.height>=200,'map-canvas-has-no-usable-area');
  check(geometry.unclipped.width>=200&&geometry.unclipped.height>=200,'map-canvas-clipped-by-ancestor');
  if(viewport){
    check(geometry.inViewport.width>=200&&geometry.inViewport.height>=200,'map-canvas-outside-viewport');
    check(geometry.visibleMarkers>=1,'map-markers-not-painted-in-viewport');
    check(geometry.visibleZoomControls===2,'map-zoom-controls-not-painted-in-viewport');
  }
}

export function analyzeMapRgb(rgb,width=96,height=64) {
  check(rgb.length===width*height*3,'map-pixel-decode-incomplete');
  const histogram=new Map(),paintCells=new Set();let painted=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*3,r=rgb[offset],g=rgb[offset+1],b=rgb[offset+2];
    const color=((r>>4)<<8)|((g>>4)<<4)|(b>>4);
    histogram.set(color,(histogram.get(color)||0)+1);
    // App map paints green coverage, amber uncovered, cyan demand or gain/loss.
    if((g-r>8&&g-b>2)||(r-g>15&&g-b>8)||(g-r>12&&b-r>15)){
      painted++;paintCells.add(`${Math.floor(x*4/width)}:${Math.floor(y*3/height)}`);
    }
  }
  const largest=Math.max(...histogram.values());
  check(histogram.size>=6&&largest/rgb.length*3<.99,'map-rendered-pixels-are-blank');
  check(painted>=Math.max(8,width*height*.001)&&paintCells.size>=2,'map-geographic-paint-not-visible');
  return {method:'in-memory-rendered-map-pixels',colorBins:histogram.size,paintedCells:paintCells.size};
}

export async function assertRenderedMap(page,{requirePixels=false}={}) {
  const collect=()=>{
    const container=document.querySelector('.map-canvas.maplibregl-map'),canvas=container?.querySelector('canvas.maplibregl-canvas');
    if(!container||!canvas)return null;
    const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    const intersection=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return{x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};};
    const clipped=element=>{
      let result=rect(element);
      for(let parent=element.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent);
        if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return{x:0,y:0,width:0,height:0};
        if(/hidden|clip|scroll|auto/.test(`${style.overflowX} ${style.overflowY}`))result=intersection(result,rect(parent));
      }
      return result;
    };
    const viewport={x:0,y:0,width:innerWidth,height:innerHeight};
    const actual=element=>{const r=intersection(clipped(element),viewport);return r.width>=5&&r.height>=5;};
    return{container:rect(container),canvas:rect(canvas),unclipped:clipped(canvas),inViewport:intersection(clipped(canvas),viewport),
      visibleMarkers:[...container.querySelectorAll('.site-marker')].filter(actual).length,
      visibleZoomControls:[...container.querySelectorAll('.maplibregl-ctrl-zoom-in,.maplibregl-ctrl-zoom-out')].filter(actual).length};
  };
  let geometry=await page.evaluate(collect);
  check(geometry,'map-render-elements-missing');
  validateMapGeometry(geometry);
  const container=page.locator('.map-canvas.maplibregl-map');
  await container.scrollIntoViewIfNeeded();
  geometry=await page.evaluate(collect);
  validateMapGeometry(geometry,{viewport:true});
  const ffmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore',timeout:5000});
  if(ffmpeg.error||ffmpeg.status!==0){
    check(!requirePixels,'map-pixel-decoder-unavailable');
    console.warn('UNAVAILABLE map pixel proof: ffmpeg is not installed; geometry remains mandatory.');
    return{method:'rendered-map-geometry',pixels:'UNAVAILABLE'};
  }
  const screenshot=await container.screenshot({type:'png',animations:'disabled',scale:'css'});
  let rgb;
  try{
    // Discard border controls/labels; inspect the real map's central pixels.
    rgb=execFileSync('ffmpeg',['-v','error','-f','image2pipe','-i','pipe:0','-vf','crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,scale=96:64:flags=area,format=rgb24','-frames:v','1','-f','rawvideo','pipe:1'],{input:screenshot,timeout:30000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});
  }catch{throw new Error('map-rendered-pixel-decode-failed');}
  return{...analyzeMapRgb(rgb),geometry:'PASS'};
}
