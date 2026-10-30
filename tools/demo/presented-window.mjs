/** Browser presentation timestamps, not page-creation or Node uptime, define a clip.
 * https://playwright.dev/docs/api/class-screencast#screencast-start
 * onFrame.timestamp is milliseconds since the Unix epoch.
 */
export class PresentedWindow {
  constructor(viewport) {this.viewport=viewport;this.first=null;this.last=null;this.frames=0;}
  observe(frame) {
    if(!Number.isFinite(frame.timestamp)||frame.timestamp<=0)throw new Error('invalid-presented-frame-timestamp');
    if(frame.viewportWidth!==this.viewport.width||frame.viewportHeight!==this.viewport.height)throw new Error('presented-frame-size-disagrees');
    if(this.last!==null&&frame.timestamp<this.last)throw new Error('presented-frame-clock-went-backwards');
    if(this.first===null)this.first=frame.timestamp;
    this.last=frame.timestamp;this.frames++;
  }
  hasPresentedAtOrAfter(timestamp) {return this.last!==null&&this.last>=timestamp;}
  receipt(seconds,actionsCompletedAtUnixMs) {
    if(this.first===null||this.last===null||this.frames<2)throw new Error('insufficient-presented-frames');
    if(this.last-this.first<seconds*1000)throw new Error('presented-frame-window-too-short');
    if(!Number.isFinite(actionsCompletedAtUnixMs)||actionsCompletedAtUnixMs<this.first||actionsCompletedAtUnixMs>this.first+seconds*1000)throw new Error('demo-actions-outside-presented-window');
    return {method:'playwright-screencast',firstPresentedAtUnixMs:this.first,lastPresentedAtUnixMs:this.last,framesObserved:this.frames,actionsCompletedAtUnixMs};
  }
}

/** Reuse is accepted only from a complete matching receipt AND probed media. */
export function validateCompletedCapture(metadata,{beat,releaseSha,datasetHash,capturedSeconds,viewport,fps}) {
  if(metadata?.schemaVersion!==2||metadata.id!==beat.id||metadata.releaseSha!==releaseSha||metadata.datasetHash!==datasetHash||metadata.videoFile!==`${beat.id}.webm`||metadata.trimStartSeconds!==0||metadata.durationSeconds!==beat.seconds||metadata.fps!==fps||metadata.viewport?.width!==viewport.width||metadata.viewport?.height!==viewport.height)throw new Error('existing-capture-identity-disagrees');
  if(!Number.isFinite(capturedSeconds)||capturedSeconds<beat.seconds)throw new Error('existing-capture-media-too-short');
  const receipt=metadata.captureClock;
  if(receipt?.method!=='playwright-screencast'||!Number.isInteger(receipt.framesObserved)||receipt.framesObserved<2)throw new Error('existing-capture-clock-receipt-invalid');
  const clock=new PresentedWindow(viewport);
  clock.observe({timestamp:receipt.firstPresentedAtUnixMs,viewportWidth:viewport.width,viewportHeight:viewport.height});
  clock.observe({timestamp:receipt.lastPresentedAtUnixMs,viewportWidth:viewport.width,viewportHeight:viewport.height});
  clock.receipt(beat.seconds,receipt.actionsCompletedAtUnixMs);
}
