#!/usr/bin/env node
// capture_app.mjs: owner-run live capture of a real web app, with a marks file of event times.
//
// Commands:
//   node capture_app.mjs login   --url <app url> [--profile DIR] [--channel msedge|chrome|chromium] [--size WxH]
//       Opens a visible browser on the URL. YOU sign in yourself in that window (this script never
//       reads, types or stores a password). Press Enter in this terminal when you are signed in, or
//       pass --signed-in "<css selector>" to continue as soon as that element is visible.
//       The session stays in the profile folder for the record command.
//
//   node capture_app.mjs record  --url <app url> [--out DIR] [--profile DIR] [--size WxH] [--channel ...]
//                                [--mark-on name=<css>]... [--mark-url name=<regex>]... [--key k=name]...
//                                [--geo lat,lon] [--no-cursor] [--max-seconds N]
//                                [--driver ./approved-driver.mjs] [--headless]
//       Reuses the signed-in profile, opens the URL and records the page as video
//       (<out>/video/capture_<time>.webm). You drive the app by hand. Marks are written to
//       <out>/marks_<time>.json as they happen:
//         * press a letter or digit key in this terminal: a mark named by --key k=name, else key_<k>;
//         * press Enter: a mark named 'mark';
//         * --mark-on name=<css>: a mark when that element first becomes visible;
//         * --mark-url name=<regex>: a mark when the page URL first matches;
//         * press q or Ctrl+C, close the browser window, or reach --max-seconds (default 900): stop.
//       Each mark has t (seconds since the page was created, which is where the video starts, to
//       within a few frames), wall (UTC ISO time) and source. Feed the marks to cut_clips.py.
//       Project-only adaptation: --driver loads a local module BEFORE navigation and calls its
//       default async export with {page, context, mark, url, out, signal}. The driver owns initial
//       navigation, may call mark(name, details), and stops recording when it resolves. Rejection,
//       interruption or the recording deadline aborts signal, retains marks/video and exits nonzero.
//       --headless affects record only; without either flag, visible manual capture is unchanged.
//
//   node capture_app.mjs cleanup [--profile DIR]
//       Deletes the profile folder (the signed-in session). Do this after the capture.
//
// Defaults: --profile ./capture-profile, --out ./live, --size 1536x864 (scales cleanly to 1920x1080),
// --channel msedge on Windows, else bundled chromium. Use a test account and synthetic data;
// never record secrets, real customer data, bookmarks or other tabs.
//
// Playwright is resolved from env PLAYWRIGHT_MODULE, else require('playwright') from the current
// working directory; otherwise the script prints: npm i -D playwright && npx playwright install chromium
//
// This project copy contains no product logic; an explicitly selected owner-approved local driver
// may drive the page. The original skill folder is never modified.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const HELP = (() => {
  // The leading block of '//' comment lines is the help text.
  const out = [];
  for (const l of readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1)) {
    if (!l.startsWith('//')) break;
    out.push(l.replace(/^\/\/ ?/, ''));
  }
  return out.join('\n');
})();

function fail(msg) { console.error(`error: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const o = { cmd: argv[0], url: null, profile: path.resolve('capture-profile'), out: path.resolve('live'),
    size: '1536x864', channel: process.platform === 'win32' ? 'msedge' : 'chromium', markOn: [], markUrl: [],
    keys: {}, geo: null, cursor: true, maxSeconds: 900, signedIn: null, driver: null, headless: false };
  if (!o.cmd || o.cmd === '-h' || o.cmd === '--help') { console.log(HELP); process.exit(0); }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) fail(`missing value for ${a}`); return argv[++i]; };
    const pair = (v) => { const k = v.indexOf('='); if (k <= 0) fail(`${a} needs name=value, got ${v}`); return [v.slice(0, k), v.slice(k + 1)]; };
    switch (a) {
      case '--url': o.url = next(); break;
      case '--profile': o.profile = path.resolve(next()); break;
      case '--out': o.out = path.resolve(next()); break;
      case '--size': o.size = next(); break;
      case '--channel': o.channel = next(); break;
      case '--mark-on': o.markOn.push(pair(next())); break;
      case '--mark-url': { const [n, r] = pair(next()); o.markUrl.push([n, new RegExp(r)]); break; }
      case '--key': { const [k, n] = pair(next()); if (k.length !== 1) fail('--key needs a single character'); o.keys[k.toLowerCase()] = n; break; }
      case '--geo': { const [la, lo] = next().split(',').map(Number); if (!Number.isFinite(la) || !Number.isFinite(lo)) fail('--geo needs lat,lon'); o.geo = { latitude: la, longitude: lo }; break; }
      case '--no-cursor': o.cursor = false; break;
      case '--max-seconds': o.maxSeconds = Number(next()); break;
      case '--signed-in': o.signedIn = next(); break;
      case '--driver': {
        const value = next();
        if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !path.isAbsolute(value)) fail('--driver must be a local module path');
        o.driver = path.resolve(value); break;
      }
      case '--headless': o.headless = true; break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default: fail(`unknown option ${a}`);
    }
  }
  if (!['login', 'record', 'cleanup'].includes(o.cmd)) fail(`unknown command ${o.cmd} (login, record or cleanup)`);
  const m = /^(\d+)x(\d+)$/.exec(o.size);
  if (!m) fail('--size must look like 1536x864');
  o.viewport = { width: Number(m[1]), height: Number(m[2]) };
  if (!['msedge', 'chrome', 'chromium'].includes(o.channel)) fail('--channel must be msedge, chrome or chromium');
  if (o.cmd !== 'cleanup' && !o.url) fail('--url is required');
  if (o.url && !/^https?:\/\//i.test(o.url)) fail('--url must start with http:// or https://');
  if (o.cmd !== 'record' && (o.driver || o.headless)) fail('--driver and --headless are record-only options');
  if (!Number.isFinite(o.maxSeconds) || o.maxSeconds <= 0) fail('--max-seconds must be a positive number');
  if (o.driver && !existsSync(o.driver)) fail('--driver module does not exist');
  return o;
}

function loadPlaywright() {
  const req = createRequire(path.join(process.cwd(), 'noop.js'));
  const env = process.env.PLAYWRIGHT_MODULE;
  const tried = [];
  if (env) {
    try { return req(path.isAbsolute(env) || env.startsWith('.') ? path.resolve(env) : env); } catch (e) { tried.push(`PLAYWRIGHT_MODULE=${env}: ${String(e.message).split('\n')[0]}`); }
  }
  try { return req('playwright'); } catch (e) { tried.push(`require('playwright') from ${process.cwd()}: ${String(e.message).split('\n')[0]}`); }
  console.error('Playwright not found.');
  for (const t of tried) console.error(`  ${t}`);
  console.error('Install it in your project:  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const CURSOR_INIT = `(() => {
  const install = () => {
    if (document.getElementById('__capture_cursor')) return;
    const c = document.createElement('div');
    c.id = '__capture_cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(255,255,255,0.85);border:3px solid #22D3EE;box-shadow:0 0 12px rgba(34,211,238,0.8);' +
      'z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 40ms linear;';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:16px;height:16px;margin:-8px 0 0 -8px;' +
        'border-radius:50%;border:3px solid #22D3EE;z-index:2147483646;pointer-events:none;transition:all 450ms ease-out;opacity:1;';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.width = '70px'; r.style.height = '70px'; r.style.margin = '-35px 0 0 -35px'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

async function openContext(chromium, o, videoDir) {
  const opts = { headless: o.headless, viewport: o.viewport, deviceScaleFactor: 1, args: ['--window-position=0,0'] };
  if (o.driver && o.headless) opts.args.push('--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist');
  if (o.channel !== 'chromium') opts.channel = o.channel;
  if (o.geo) { opts.geolocation = o.geo; opts.permissions = ['geolocation']; }
  if (videoDir) opts.recordVideo = { dir: videoDir, size: o.viewport };
  return chromium.launchPersistentContext(o.profile, opts);
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function localDate() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

async function login(o) {
  const { chromium } = loadPlaywright();
  mkdirSync(o.profile, { recursive: true });
  const ctx = await openContext(chromium, o, null);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(o.url, { waitUntil: 'domcontentloaded' });
  console.log('Sign in yourself in the browser window. This script does not type or read anything there.');
  let done;
  const finished = new Promise((r) => { done = r; });
  ctx.on('close', () => done('window closed'));
  if (o.signedIn) {
    page.locator(o.signedIn).first().waitFor({ state: 'visible', timeout: 0 }).then(() => done('signed-in element visible')).catch(() => {});
    console.log(`Waiting for ${o.signedIn} to appear (or press Enter).`);
  } else {
    console.log('Press Enter here when you are signed in.');
  }
  const rl = readline.createInterface({ input: process.stdin });
  rl.once('line', () => done('Enter pressed'));
  const why = await finished;
  rl.close();
  console.log(`${why}; closing. The session is saved in ${o.profile}`);
  try { await ctx.close(); } catch { /* already closed */ }
}

async function record(o) {
  // Load the explicitly selected local module before creating a page or navigating.
  let driver = null;
  if (o.driver) {
    try {
      driver = (await import(pathToFileURL(o.driver).href)).default;
      if (typeof driver !== 'function') throw new Error('driver-default-export-required');
    } catch {
      console.error('error: driver-module-load-failed (a local default async function is required)');
      process.exitCode = 1; return;
    }
  }
  if (!existsSync(o.profile)) console.warn(`warning: no profile at ${o.profile}; run login first if the app needs a sign-in`);
  const { chromium } = loadPlaywright();
  const videoDir = path.join(o.out, 'video');
  mkdirSync(videoDir, { recursive: true });
  const id = stamp();
  const marksPath = path.join(o.out, `marks_${id}.json`);
  const ctx = await openContext(chromium, o, videoDir);
  const initialPages = ctx.pages();
  // Do not reuse the persistent context's initial page: its video clock starts at launch.
  // Keep the new page open before closing old blanks, so a headed window stays alive.
  let page;
  try {
    if (o.cursor) await ctx.addInitScript(CURSOR_INIT);
    page = await ctx.newPage();
  } catch {
    const wall = new Date().toISOString();
    writeFileSync(marksPath, `${JSON.stringify({summary:{tool:'capture_app.mjs',driver:o.driver?path.basename(o.driver):null,
      headless:o.headless,video:null,stopped_by:'recording page setup failed',failure:'capture-page-setup-failed',
      t_basis:'no recording page clock was established; initial raw recordings, if any, remain in video/'},
      marks:[{name:'driver_failed',t:0,wall,source:'setup',code:'capture-page-setup-failed'},{name:'stop',t:0,wall,source:'stop'}]}, null, 1)}\n`, 'utf8');
    await bounded(ctx.close(), 15000).catch(() => {});
    console.error('capture-page-setup-failed; marks and any raw video were retained');
    process.exit(1); return;
  }
  const t0 = Date.now();
  const state = {
    summary: { tool: 'capture_app.mjs', url: o.url, started_at: new Date(t0).toISOString(), capture_date: localDate(),
      capture_date_basis: 'local date of this machine at the start', viewport: o.viewport, channel: o.channel,
      project_adaptation: 'standby-pitch-v2 local driver and headless support',
      driver: o.driver ? path.basename(o.driver) : null, headless: o.headless,
      t_basis: 'seconds since newPage resolved; video begins at page creation, within a few frames',
      video: null, stopped_by: null, failure: null },
    marks: [],
  };
  const save = () => writeFileSync(marksPath, `${JSON.stringify(state, null, 1)}\n`, 'utf8');
  const mark = (name, source, extra = {}) => {
    const m = { ...extra, name, t: Number(((Date.now() - t0) / 1000).toFixed(3)), wall: new Date().toISOString(), source };
    state.marks.push(m);
    save();
    console.log(`mark ${m.t.toFixed(2)} s  ${name}  (${source})`);
    return m;
  };
  mark('start', 'start');

  let stopping = false;
  let stopResolve;
  const controller = new AbortController();
  const stopped = new Promise((r) => { stopResolve = r; });
  const stop = (why, failure = null) => {
    if (stopping) return;
    stopping = true; state.summary.stopped_by = why;
    if (failure) { state.summary.failure = failure; mark('driver_failed', 'driver', { code: failure }); }
    controller.abort(new Error(failure || why));
    stopResolve();
  };
  const interrupted = why => stop(why, driver ? 'driver-interrupted' : null);
  ctx.on('close', () => interrupted('window closed'));
  page.on('close', () => interrupted('recording page closed'));
  const timer = setTimeout(() => stop(`max ${o.maxSeconds} s`, driver ? 'driver-timeout' : null), o.maxSeconds * 1000);

  const seenSel = new Set();
  const seenUrl = new Set();
  const poll = setInterval(async () => {
    if (stopping) return;
    for (const [name, css] of o.markOn) {
      if (seenSel.has(name)) continue;
      try { if (await page.locator(css).first().isVisible()) { seenSel.add(name); mark(name, 'selector', { selector: css }); } } catch { /* page navigating */ }
    }
    for (const [name, re] of o.markUrl) {
      if (seenUrl.has(name)) continue;
      try { if (re.test(page.url())) { seenUrl.add(name); mark(name, 'url'); } } catch { /* ignore */ }
    }
  }, 200);

  const onKey = (k) => {
    if (k === '\u0003' || k === 'q') return interrupted(k === 'q' ? 'q pressed' : 'Ctrl+C');
    if (k === '\r' || k === '\n') return mark('mark', 'key');
    if (/^[a-z0-9]$/i.test(k)) mark(o.keys[k.toLowerCase()] || `key_${k.toLowerCase()}`, 'key');
  };
  const stdinData = (d) => { for (const ch of d) onKey(ch); };
  let rl = null;
  if (!driver && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', stdinData);
  } else if (!driver) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => { const s = l.trim(); if (s === 'q') interrupted('q entered'); else mark(s || 'mark', 'line'); });
  }
  const onInterrupt = () => interrupted('SIGINT'), onTerminate = () => interrupted('SIGTERM');
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
  console.log(driver ? 'Recording with the explicitly selected local driver.' : `Recording. Keys: letters/digits = marks${Object.keys(o.keys).length ? ` (${Object.entries(o.keys).map(([k, n]) => `${k}=${n}`).join(', ')})` : ''}, Enter = 'mark', q = stop.`);

  let driverSettled = null;
  try {
    await Promise.race([
      Promise.all(initialPages.filter(initial => initial.url() === 'about:blank').map(async initial => {
        const blankVideo = initial.video();
        await initial.close();
        // Remove only this confirmed unused blank page's own recording, never a directory glob.
        if (blankVideo) await blankVideo.delete();
      })),
      stopped,
    ]);
    if (!stopping && driver) {
      mark('driver_start', 'driver');
      driverSettled = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return driver({ page, context: ctx, mark: (name, details = {}) => mark(name, 'driver', details),
          url: o.url, out: o.out, signal: controller.signal });
      }).then(() => {
        if (!stopping) { mark('driver_complete', 'driver'); stop('driver complete'); }
      }, error => {
        if (!stopping) {
          // Driver exceptions can contain API URLs. Retain only a bounded symbolic code.
          const candidate = error?.code ?? error?.message;
          const code = typeof candidate === 'string' && /^[a-z0-9_.:-]{1,96}$/i.test(candidate) ? candidate : 'driver-failed';
          stop('driver failed', code);
        }
      });
    } else if (!stopping) {
      page.goto(o.url, { waitUntil: 'domcontentloaded' }).catch((e) => console.error(`navigation: ${e.message}`));
    }
  } catch {
    stop('recording setup failed', 'recording-setup-failed');
  }

  await stopped;
  clearTimeout(timer);
  clearInterval(poll);
  mark('stop', 'stop');
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
  process.stdin.removeListener('data', stdinData);
  if (!driver && process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch { /* ignore */ } }
  process.stdin.pause();
  if (rl) rl.close();
  const video = page.video();
  async function bounded(promise, milliseconds) {
    let timeout;
    try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('capture-finalization-timeout')), milliseconds); })]); }
    finally { clearTimeout(timeout); }
  }
  try { await bounded(ctx.close(), 15000); }
  catch { state.summary.failure ||= 'capture-context-close-failed'; }
  // An aborted driver gets a short chance to flush its own sanitized proof after page teardown.
  if (driverSettled) await bounded(driverSettled, 2000).catch(() => {});
  if (video) {
    try {
      const raw = await bounded(video.path(), 5000);
      const dest = path.join(videoDir, `capture_${id}.webm`);
      renameSync(raw, dest);
      state.summary.video = path.relative(o.out, dest).split(path.sep).join('/');
    } catch { state.summary.failure ||= 'capture-video-finalization-failed'; console.error('could not finalize the video; raw files remain in the video directory'); }
  }
  else state.summary.failure ||= 'capture-video-unavailable';
  save();
  console.log(`video: ${state.summary.video ? path.join(o.out, state.summary.video) : '(none)'}`);
  console.log(`marks: ${marksPath}`);
  console.log('next: write a cuts file and run cut_clips.py; afterwards run "capture_app.mjs cleanup" to delete the session.');
  process.exit(state.summary.failure ? 1 : 0);
}

function cleanup(o) {
  if (!existsSync(o.profile)) { console.log(`no profile at ${o.profile}`); return; }
  // Guard: only delete a folder that looks like a browser profile, never an arbitrary folder.
  if (!existsSync(path.join(o.profile, 'Local State')) && !existsSync(path.join(o.profile, 'Default'))) {
    fail(`${o.profile} does not look like a browser profile (no 'Local State' or 'Default'); not deleting it`);
  }
  rmSync(o.profile, { recursive: true, force: true });
  console.log(`deleted ${o.profile}`);
}

const o = parseArgs(process.argv.slice(2));
if (o.cmd === 'login') await login(o);
else if (o.cmd === 'record') await record(o);
else cleanup(o);
