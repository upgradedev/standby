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

/** Explicitly exclude JPEG bytes and any unrelated callback fields. */
export function frameObservation(frame,observedAtUnixMs,observedAtPerformanceMs) {
  return {presentedAtUnixMs:frame.timestamp,observedAtUnixMs,observedAtPerformanceMs,
    deliveryLagMs:observedAtUnixMs-frame.timestamp,viewportWidth:frame.viewportWidth,viewportHeight:frame.viewportHeight};
}

/** Reuse is accepted only from a complete matching receipt AND probed media. */
export function validateCompletedCapture(metadata,{beat,releaseSha,datasetHash,capturedSeconds,viewport,fps}) {
  if(![2,3].includes(metadata?.schemaVersion)||metadata.id!==beat.id||metadata.releaseSha!==releaseSha||metadata.datasetHash!==datasetHash||metadata.videoFile!==`${beat.id}.webm`||metadata.durationSeconds!==beat.seconds||metadata.fps!==fps||metadata.viewport?.width!==viewport.width||metadata.viewport?.height!==viewport.height)throw new Error('existing-capture-identity-disagrees');
  const trim=metadata.schemaVersion===3?metadata.trimStartSeconds:0;
  if(!Number.isFinite(trim)||trim<0||!Number.isFinite(capturedSeconds)||capturedSeconds-trim<beat.seconds)throw new Error('existing-capture-media-too-short');
  const receipt=metadata.captureClock;
  if(metadata.schemaVersion===3){
    if(receipt?.method!=='native-screencast-slate'||!Number.isFinite(receipt.actionsCompletedAtUnixMs-receipt.storyAnchorAtUnixMs)||receipt.actionsCompletedAtUnixMs<receipt.storyAnchorAtUnixMs||receipt.actionsCompletedAtUnixMs-receipt.storyAnchorAtUnixMs>beat.seconds*1000||!Number.isFinite(receipt.semanticElapsedSeconds)||receipt.semanticElapsedSeconds<0||receipt.semanticElapsedSeconds>beat.seconds||metadata.syncProof?.method!=='decoded-magenta-slate'||metadata.syncProof.firstClearFramePtsSeconds!==trim||metadata.syncProof.markerFrames<2)throw new Error('existing-capture-clock-receipt-invalid');
    return;
  }
  if(metadata.trimStartSeconds!==0)throw new Error('existing-capture-identity-disagrees');
  if(receipt?.method!=='playwright-screencast'||!Number.isInteger(receipt.framesObserved)||receipt.framesObserved<2)throw new Error('existing-capture-clock-receipt-invalid');
  const clock=new PresentedWindow(viewport);
  clock.observe({timestamp:receipt.firstPresentedAtUnixMs,viewportWidth:viewport.width,viewportHeight:viewport.height});
  clock.observe({timestamp:receipt.lastPresentedAtUnixMs,viewportWidth:viewport.width,viewportHeight:viewport.height});
  clock.receipt(beat.seconds,receipt.actionsCompletedAtUnixMs);
}
