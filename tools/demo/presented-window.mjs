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
