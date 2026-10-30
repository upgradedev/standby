import assert from 'node:assert/strict';
import test from 'node:test';
import {PresentedWindow} from './presented-window.mjs';
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
