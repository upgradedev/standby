import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMapRgb,validateMapGeometry} from '../../tools/demo/map-render-proof.mjs';

test('rejects actual failure geometry: ready canvas inside zero-height clipping container',()=>{
  const geometry={container:{width:931,height:0},canvas:{width:931,height:300},unclipped:{width:931,height:0},inViewport:{width:931,height:0},visibleMarkers:0,visibleZoomControls:0};
  assert.throws(()=>validateMapGeometry(geometry),/map-container-has-no-usable-area/);
});
test('positive canvas geometry does not excuse fully clipped content or offscreen controls',()=>{
  const good={container:{width:931,height:600},canvas:{width:931,height:600},unclipped:{width:931,height:600},inViewport:{width:931,height:600},visibleMarkers:12,visibleZoomControls:2};
  assert.doesNotThrow(()=>validateMapGeometry(good,{viewport:true}));
  assert.throws(()=>validateMapGeometry({...good,unclipped:{width:931,height:0}}),/clipped-by-ancestor/);
  assert.throws(()=>validateMapGeometry({...good,visibleZoomControls:0},{viewport:true}),/zoom-controls-not-painted/);
});
test('rejects a uniformly blank map even when geometry and SDK state are valid',()=>{
  const pixels=Buffer.alloc(96*64*3);for(let i=0;i<pixels.length;i+=3){pixels[i]=11;pixels[i+1]=21;pixels[i+2]=32;}
  assert.throws(()=>analyzeMapRgb(pixels),/rendered-pixels-are-blank/);
});
test('neutral UI texture cannot stand in for geographic map paint',()=>{
  const pixels=Buffer.alloc(96*64*3);for(let i=0;i<pixels.length;i+=3){const v=(i/3)%255;pixels[i]=v;pixels[i+1]=v;pixels[i+2]=v;}
  assert.throws(()=>analyzeMapRgb(pixels),/geographic-paint-not-visible/);
});
