/** Capture visible pixels without element-screenshot viewport resizing. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

export function captureErrorCategory(error){
  const message=error instanceof Error?error.message:'';
  if(error?.code==='ETIMEDOUT'||/Timeout \d+ms exceeded|viewport-shot-deadline/.test(message))return 'timeout';
  if(/Protocol error/.test(message))return 'browser-protocol';
  if(/Target.*closed|page.*closed|browser.*closed/i.test(message))return 'browser-closed';
  if(/viewport-shot-target/.test(message))return 'target-geometry';
  if(/viewport-shot-moved/.test(message))return 'target-moved';
  return 'capture-operation';
}

export async function viewportShot(page,locator,{timeout=25_000,record={}}={}){
  const deadline=performance.now()+timeout;
  const remaining=()=>{
    const value=Math.floor(deadline-performance.now());
    assert.ok(value>0,'viewport-shot-deadline');return value;
  };
  record.method='viewport-png-then-in-memory-crop';
  try{
    record.stage='frame-target';
    if(locator){
      await locator.scrollIntoViewIfNeeded({timeout:remaining()});
      // The browser can report intersectionRatio=1 with a fractional edge still
      // below the viewport. Center the target, rather than relaxing its bounds.
      await locator.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}),undefined,{timeout:remaining()});
    }
    const viewport=page.viewportSize();assert.ok(viewport,'viewport-shot-target-no-viewport');
    const box=locator?await locator.boundingBox({timeout:remaining()}):{x:0,y:0,...viewport};
    record.viewport=viewport;record.box=box;
    assert.ok(box&&Object.values(box).every(Number.isFinite)&&box.width>0&&box.height>0,'viewport-shot-target-empty');
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'viewport-shot-target-clipped');
    record.stage='capture-viewport';
    const png=await page.screenshot({animations:'disabled',fullPage:false,scale:'css',timeout:remaining()});
    assert.equal(png.readUInt32BE(16),viewport.width,'viewport-shot-target-image-width');
    assert.equal(png.readUInt32BE(20),viewport.height,'viewport-shot-target-image-height');
    if(locator){
      record.stage='verify-target';
      const after=await locator.boundingBox({timeout:remaining()});
      assert.ok(after&&['x','y','width','height'].every(key=>Math.abs(after[key]-box[key])<=1),'viewport-shot-moved');
    }
    record.stage='crop-pixels';
    const x=Math.floor(box.x),y=Math.floor(box.y),width=Math.ceil(box.x+box.width)-x,height=Math.ceil(box.y+box.height)-y;
    const bytes=locator?execFileSync('ffmpeg',['-v','error','-f','image2pipe','-i','pipe:0','-vf',`crop=${width}:${height}:${x}:${y}`,'-frames:v','1','-f','image2pipe','-c:v','png','-threads','1','pipe:1'],
      {input:png,timeout:remaining(),maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}):png;
    remaining();record.status='pass';return bytes;
  }catch(error){record.status='fail';record.errorCategory=captureErrorCategory(error);throw error;}
}
