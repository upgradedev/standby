import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {viewportShot,captureErrorCategory} from './viewport-shot.mjs';

test('viewport capture frames a scrolled modal card and preserves actual colored pixels',async()=>{
  assert.equal(process.env.CI,'true','Browser instruments run in hosted CI only');
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [1440,390]){
      const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
      let requests=0;await page.route('**/*',route=>{requests++;return route.abort();});
      await page.setContent('<style>dialog{width:85vw;height:700px;padding:0;overflow:auto;border:0} .space{height:1100px} #card{height:250px;background:rgb(210,30,40)}</style><dialog open><div class="space"></div><section id="card">Actual fixture pixels</section><div class="space"></div></dialog>');
      const record={},bytes=await viewportShot(page,page.locator('#card'),{record});
      assert.equal(record.status,'pass');assert.equal(bytes.readUInt32BE(20),250);
      const rgb=execFileSync('ffmpeg',['-v','error','-f','image2pipe','-i','pipe:0','-vf','crop=20:20:100:100,format=rgb24','-frames:v','1','-f','rawvideo','pipe:1'],{input:bytes,timeout:10_000});
      assert.ok([...rgb].every((value,at)=>Math.abs(value-[210,30,40][at%3])<=1));
      assert.equal(requests,0);await page.close();
    }
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent('<section style="width:100px;height:1200px">Oversized target</section>');
    const record={};await assert.rejects(viewportShot(page,page.locator('section'),{record}),/viewport-shot-target-clipped/);
    assert.equal(record.status,'fail');assert.equal(record.errorCategory,'target-geometry');
    assert.equal(record.stage,'frame-target');await page.close();
  }finally{await browser.close();}
});

test('failure diagnostics retain fixed categories without browser exception text',()=>{
  assert.equal(captureErrorCategory(new Error('Protocol error (Page.captureScreenshot): private-detail')),'browser-protocol');
  assert.equal(captureErrorCategory(new Error('Timeout 25000ms exceeded')),'timeout');
  assert.equal(captureErrorCategory(Object.assign(new Error('crop failed'),{code:'ETIMEDOUT'})),'timeout');
  assert.equal(captureErrorCategory(new Error('viewport-shot-moved')),'target-moved');
});
