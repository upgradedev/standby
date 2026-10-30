import assert from 'node:assert/strict';
import test from 'node:test';
import {PresentedWindow,validateCompletedCapture,frameObservation} from './presented-window.mjs';
const viewport={width:1440,height:900};
const frame=timestamp=>({timestamp,viewportWidth:1440,viewportHeight:900});
test('presentation clock starts at the first captured frame, independent of earlier setup',()=>{
  const clock=new PresentedWindow(viewport),epoch=1793370000123;
  clock.observe(frame(epoch));clock.observe(frame(epoch+25120));
  assert.deepEqual(clock.receipt(25,epoch+23000),{method:'playwright-screencast',firstPresentedAtUnixMs:epoch,lastPresentedAtUnixMs:epoch+25120,framesObserved:2,actionsCompletedAtUnixMs:epoch+23000});
});
test('an actual short presentation span fails even if a host clock would report 48 seconds',()=>{
  const clock=new PresentedWindow(viewport),epoch=1793370000123;
  clock.observe(frame(epoch));clock.observe(frame(epoch+23980));
  assert.throws(()=>clock.receipt(25,epoch+23000),/window-too-short/);
});
test('actions that overrun the published clip fail instead of being silently cut',()=>{
  const clock=new PresentedWindow(viewport),epoch=1793370000123;
  clock.observe(frame(epoch));clock.observe(frame(epoch+27000));
  assert.throws(()=>clock.receipt(25,epoch+26000),/actions-outside/);
});
test('frame ordering and actual viewport are validated',()=>{
  const clock=new PresentedWindow(viewport);clock.observe(frame(1793370000123));
  assert.throws(()=>clock.observe(frame(1793370000000)),/went-backwards/);
  assert.throws(()=>clock.observe({...frame(1793370000223),viewportWidth:800}),/size-disagrees/);
});
test('only a complete matching receipt and actual sufficient media can be reused',()=>{
  const epoch=1793370000123,metadata={schemaVersion:2,id:'history',releaseSha:'a'.repeat(40),datasetHash:'dataset-a',videoFile:'history.webm',trimStartSeconds:0,durationSeconds:25,fps:30,viewport,captureClock:{method:'playwright-screencast',firstPresentedAtUnixMs:epoch,lastPresentedAtUnixMs:epoch+25120,framesObserved:38,actionsCompletedAtUnixMs:epoch+23000}};
  const expected={beat:{id:'history',seconds:25},releaseSha:'a'.repeat(40),datasetHash:'dataset-a',capturedSeconds:25.12,viewport,fps:30};
  assert.doesNotThrow(()=>validateCompletedCapture(metadata,expected));
  assert.throws(()=>validateCompletedCapture(metadata,{...expected,datasetHash:'dataset-b'}),/identity-disagrees/);
  assert.throws(()=>validateCompletedCapture(metadata,{...expected,capturedSeconds:24.9}),/media-too-short/);
  assert.throws(()=>validateCompletedCapture({...metadata,captureClock:undefined},expected),/receipt-invalid/);
  assert.throws(()=>validateCompletedCapture({...metadata,schemaVersion:1,trimStartSeconds:23},expected),/identity-disagrees/);
});
test('diagnostics preserve first-frame lag and exclude JPEG or unrelated payload fields',()=>{
  const observed=frameObservation({...frame(1793370000123),data:Buffer.from('not-retained'),unrelated:'not-retained'},1793370013123,48000);
  assert.equal(observed.deliveryLagMs,13000);
  assert.equal(observed.observedAtPerformanceMs,48000);
  assert.equal(observed.presentedAtUnixMs,1793370000123);
  assert.equal('data'in observed,false);assert.equal('unrelated'in observed,false);
});
