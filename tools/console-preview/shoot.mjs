#!/usr/bin/env node
// shoot.mjs - screenshot matrix for QA of an ops console.
//
// What it does:
//   Opens every route at every width and theme (and, with --states, every data
//   state), waits for <main data-ready="true">, and writes one PNG per shot,
//   a contact-sheet.png that lays all shots out on one page (plus one sheet per
//   route when there are several routes), and report.json plus report.md. With --axe it runs axe-core on each shot. With --keyboard
//   it runs a short keyboard smoke test (Tab order, focus ring, "/" search).
//
// Why it waits for data-ready:
//   A screenshot taken before the first data load settles shows a skeleton,
//   not the page. The starter sets data-ready="true" once the first load ends
//   (ok, empty, error or unavailable). A wait that runs out is reported as a
//   timeout and fails the run, so a page that never settles cannot hide.
//
// Where Playwright comes from:
//   The target project, not this skill. It resolves "playwright", then
//   "@playwright/test", from --project, the current folder and the folder
//   above --dist. If neither resolves, it prints how to install it and
//   exits 2. axe-core is optional and resolved the same way.
//
// Requirements: Node 20 or newer. No dependencies of its own. Works on
// Windows, macOS and Linux.
//
// Exit codes: 0 pass; 1 any page error, navigation failure, ready timeout,
// failed screenshot, or serious or critical axe violation; 2 usage or setup error.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const HELP = `shoot.mjs - screenshot matrix for QA

Usage:
  node <skill>/scripts/shoot.mjs --dist <project>/dist [options]
  node <skill>/scripts/shoot.mjs --url http://localhost:5173 [options]

Setup (in the project, once):
  npm install -D playwright axe-core
  npx playwright install chromium     (once per machine; can be over 100 MB)
  axe-core is only needed for --axe.

Target (one of):
  --dist <dir>        Built app folder. The script serves it itself on a free
                      local port with an SPA fallback to index.html.
  --url <base url>    An app that is already running.

Options:
  --base <path>       With --dist: the base path the app was built with
                      (default "/"). "app" and "/app/" mean the same. Ignored
                      with --url (put it in the url).
  --routes <list>     Comma-separated routes (default "/,/records,/queue,/settings").
                      Hash routes work too, for example "/#/records". The
                      leading "/" is optional and "." means the root, which
                      helps in Git Bash on Windows, where arguments starting
                      with "/" are rewritten into Windows paths. If you set
                      MSYS_NO_PATHCONV=1 instead, write the script path as
                      C:/... too, because /c/... is then not converted either.
  --widths <list>     Viewport widths in px (default "390,768,1440").
  --themes <list>     light and/or dark (default "light,dark"). Sets ?theme=
                      and the browser colour scheme.
  --states [list]     Also shoot each route with ?state=<state>. Without a
                      list: loading,empty,error,unavailable. The loading state
                      is not expected to become ready, so it waits for <main>
                      only and is not counted as a timeout.
  --out <dir>         Output folder (default "qa-shots").
  --axe               Run axe-core on every shot, if the project has axe-core
                      installed. If not, it warns and continues.
  --keyboard          Keyboard smoke test per route and width (first theme,
                      default state): presses Tab a few times, records which
                      element has focus and whether a focus ring shows, then
                      checks that "/" focuses the search field. Results are
                      warnings and do not change the exit code.
  --project <dir>     Folder to resolve playwright and axe-core from
                      (default: the current folder, then the folder above --dist).
  --timeout <ms>      Wait limit for navigation and for data-ready (default 15000).
  --settle <ms>       Extra wait after ready, for fonts and transitions (default 300).
  --full-page         Capture the full scroll height instead of the viewport.
  --browser <name>    chromium, firefox or webkit (default chromium).
  --concurrency <n>   Pages shot at the same time (default 4).
  --storage-state <file>
                      A Playwright storage state file (cookies and
                      localStorage) loaded into every page, for an app
                      behind a real sign-in. Make one per role from a test
                      sign-in, for example with
                      "npx playwright codegen --save-storage=admin.json <url>",
                      and run once per role. Without it, a console that
                      fails closed shows only its sign-in view.
  -h, --help          Show this help.

Output (in --out):
  <route>[--<state>]--<width>--<theme>.png, contact-sheet.png and .html
  (every shot), contact-sheet--<route>.png and .html (one per route, when
  there are several routes), report.json, report.md

Exit codes:
  0  no page errors, navigation errors, ready timeouts, failed screenshots,
     or serious or critical axe violations
  1  at least one of those
  2  usage or setup error (bad flag, Playwright missing, browser not installed)
`;

const ALL_STATES = ['loading', 'empty', 'error', 'unavailable'];
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Arguments

function parseArgs(argv) {
  const spec = {
    '--dist': 'value',
    '--url': 'value',
    '--base': 'value',
    '--routes': 'value',
    '--widths': 'value',
    '--themes': 'value',
    '--states': 'optional',
    '--out': 'value',
    '--axe': 'flag',
    '--keyboard': 'flag',
    '--project': 'value',
    '--timeout': 'value',
    '--settle': 'value',
    '--full-page': 'flag',
    '--browser': 'value',
    '--concurrency': 'value',
    '--storage-state': 'value',
    '--help': 'flag',
    '-h': 'flag',
  };
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const key = eq > 0 ? raw.slice(0, eq) : raw;
    const kind = spec[key];
    if (!kind) throw new UsageError(`Unknown argument: ${raw}`);
    const name = key === '-h' ? 'help' : key.slice(2);
    if (kind === 'flag') {
      if (eq > 0) throw new UsageError(`${key} takes no value`);
      out[name] = true;
    } else if (kind === 'optional') {
      if (eq > 0) {
        out[name] = raw.slice(eq + 1);
      } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) {
        out[name] = argv[i + 1];
        i += 1;
      } else {
        out[name] = true;
      }
    } else {
      const value = eq > 0 ? raw.slice(eq + 1) : argv[i + 1];
      if (eq < 0) i += 1;
      if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new UsageError(`${key} needs a value`);
      out[name] = value;
    }
  }
  return out;
}

function list(value, fallback) {
  const source = value === undefined ? fallback : value;
  return source.split(',').map((s) => s.trim()).filter(Boolean);
}

function positiveInt(value, flag, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${flag} must be a whole number from ${min} to ${max}, got "${value}"`);
  return n;
}

// Routes are paths on the app, never full URLs: a value such as "C:/x" would
// otherwise parse as a URL with its own scheme and leave the app entirely.
function normalizeRoute(route) {
  if (route === '.') return '/';
  if (/^[A-Za-z]:[\\/]/.test(route)) {
    throw new UsageError(
      `Route "${route}" looks like a Windows path. Git Bash rewrites arguments that start with "/". ` +
        'Run with MSYS_NO_PATHCONV=1, or write routes without the leading slash (for example ".,records,queue").',
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(route) || route.startsWith('//') || route.includes('\\')) {
    throw new UsageError(`Route "${route}" must be a path such as /records, not a URL. Use --url for the base address.`);
  }
  return route.startsWith('/') ? route : `/${route}`;
}

function readStorageState(value) {
  if (value === undefined) return null;
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new UsageError(`--storage-state file not found: ${file}`);
  }
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new UsageError(`--storage-state is not a JSON file: ${file}`);
  }
  return file;
}

function readOptions(args) {
  if (Boolean(args.dist) === Boolean(args.url)) throw new UsageError('Pass exactly one of --dist <dir> or --url <base url>.');
  const routes = list(args.routes, '/,/records,/queue,/settings').map(normalizeRoute);
  if (routes.length === 0) throw new UsageError('--routes is empty');
  const widths = list(args.widths, '390,768,1440').map((w) => positiveInt(w, '--widths', 200, 4000));
  const themes = list(args.themes, 'light,dark');
  for (const t of themes) if (t !== 'light' && t !== 'dark') throw new UsageError(`--themes accepts light and dark, got "${t}"`);
  let states = [];
  if (args.states === true) states = [...ALL_STATES];
  else if (typeof args.states === 'string') states = list(args.states, '');
  for (const s of states) if (!/^[a-z][a-z0-9-]*$/i.test(s)) throw new UsageError(`--states has an invalid state "${s}"`);
  const browserName = args.browser ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new UsageError('--browser must be chromium, firefox or webkit');
  let base = args.base ?? '/';
  if (/^[A-Za-z]:[\\/]/.test(base)) {
    throw new UsageError(`--base "${base}" looks like a Windows path (Git Bash rewrites values that start with "/"). Write it without the leading slash, for example --base app.`);
  }
  if (/[\\?#]|^[a-z][a-z0-9+.-]*:/i.test(base)) throw new UsageError(`--base must be a plain path such as /app/, got "${base}"`);
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return {
    dist: args.dist ? path.resolve(args.dist) : null,
    url: args.url ?? null,
    base,
    routes,
    widths,
    themes,
    states,
    out: path.resolve(args.out ?? 'qa-shots'),
    axe: Boolean(args.axe),
    keyboard: Boolean(args.keyboard),
    project: args.project ? path.resolve(args.project) : null,
    timeout: args.timeout === undefined ? 15000 : positiveInt(args.timeout, '--timeout', 1000, 600000),
    settle: args.settle === undefined ? 300 : positiveInt(args.settle, '--settle', 0, 60000),
    fullPage: Boolean(args['full-page']),
    browserName,
    concurrency: args.concurrency === undefined ? 4 : positiveInt(args.concurrency, '--concurrency', 1, 16),
    storageState: readStorageState(args['storage-state']),
  };
}

// ---------------------------------------------------------------------------
// Resolving Playwright and axe-core from the target project

function resolutionDirs(opts) {
  const dirs = [];
  if (opts.project) dirs.push(opts.project);
  dirs.push(process.cwd());
  if (opts.dist) dirs.push(path.dirname(opts.dist));
  return [...new Set(dirs)];
}

function resolveFrom(dirs, specifiers) {
  for (const dir of dirs) {
    const req = createRequire(path.join(dir, '__shoot_resolve__.js'));
    for (const spec of specifiers) {
      try {
        return { spec, file: req.resolve(spec) };
      } catch {
        // try the next one
      }
    }
  }
  return null;
}

async function loadPlaywright(opts) {
  const dirs = resolutionDirs(opts);
  const found = resolveFrom(dirs, ['playwright', '@playwright/test']);
  if (!found) return { error: dirs };
  const mod = await import(pathToFileURL(found.file).href);
  const api = mod[opts.browserName] ? mod : mod.default;
  if (!api || !api[opts.browserName]) return { error: dirs, detail: `${found.spec} has no ${opts.browserName} export` };
  return { api, spec: found.spec, file: found.file };
}

function findAxe(opts) {
  const found = resolveFrom(resolutionDirs(opts), ['axe-core/axe.min.js', 'axe-core/axe.js']);
  return found ? found.file : null;
}

// ---------------------------------------------------------------------------
// Static server for --dist with an SPA fallback

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function startServer(root, base) {
  const indexFile = path.join(root, 'index.html');
  const server = http.createServer((req, res) => {
    const send = (code, text) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(text);
    };
    try {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(u.pathname);
      if (base !== '/') {
        if (`${pathname}/` === base) pathname = base;
        if (!pathname.startsWith(base)) return send(404, 'Not under the base path');
        pathname = `/${pathname.slice(base.length)}`;
      }
      const filePath = path.resolve(root, `.${pathname}`);
      if (filePath !== root && !isInside(filePath, root)) return send(403, 'Forbidden');
      let target = null;
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) target = filePath;
        else if (stat.isDirectory() && fs.existsSync(path.join(filePath, 'index.html'))) target = path.join(filePath, 'index.html');
      }
      const wantsHtml = (req.headers.accept ?? '').includes('text/html');
      if (!target && (path.extname(pathname) === '' || wantsHtml)) target = indexFile;
      if (!target || !fs.existsSync(target)) return send(404, 'Not found');
      const type = CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    } catch {
      send(400, 'Bad request');
    }
    return undefined;
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Shots

function viewportHeight(width) {
  if (width < 600) return 844;
  if (width < 1100) return 1024;
  return 900;
}

function slug(route) {
  const s = route.replace(/^[/#]+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'root';
}

function buildUrl(baseUrl, route, params) {
  const rel = route.startsWith('/') ? route.slice(1) : route;
  const base = new URL(baseUrl);
  const u = new URL(rel, base);
  if (u.origin !== base.origin) throw new UsageError(`Route "${route}" leaves the app (${u.href}).`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}

function clip(text, max = 500) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function isTimeoutError(err) {
  return Boolean(err) && (err.name === 'TimeoutError' || /timeout/i.test(String(err.message)));
}

// Every in-page step gets its own time limit, so a page whose main thread is
// stuck is reported as a problem instead of stopping the whole run.
function withTimeout(promise, ms, label) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} did not finish within ${ms} ms (the page may be frozen)`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function describeMain(page) {
  try {
    return await withTimeout(
      page.evaluate(() => {
        const m = document.querySelector('main');
        if (!m) return 'no <main> element in the page';
        const id = m.id ? ` id="${m.id}"` : '';
        const ready = m.getAttribute('data-ready');
        return ready === null ? `<main${id}> has no data-ready attribute` : `<main${id}> data-ready="${ready}"`;
      }),
      5000,
      'Inspecting <main>',
    );
  } catch {
    return 'no answer from the page (its main thread may be frozen)';
  }
}

async function runAxe(page, axePath) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  });
}

async function keyboardSmoke(page, tabs = 6) {
  const describe = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { desc: 'body', focusRing: false, skipLink: false };
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
      const shadow = Boolean(cs.boxShadow) && cs.boxShadow !== 'none';
      const tag = el.tagName.toLowerCase();
      let desc = tag;
      if (el.id) desc += `#${el.id}`;
      const testid = el.getAttribute('data-testid');
      if (testid) desc += `[data-testid="${testid}"]`;
      const role = el.getAttribute('role');
      if (role) desc += `[role="${role}"]`;
      // An approximation of the accessible name, in the order browsers use:
      // aria-labelledby, aria-label, a <label>, then the text without
      // aria-hidden parts (so a visible label next to a screen-reader-only
      // label is not read twice), then title and placeholder.
      const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const byIds = (ids) => clean((ids || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
      let name = byIds(el.getAttribute('aria-labelledby')) || clean(el.getAttribute('aria-label'));
      if (!name && el.labels && el.labels.length > 0) name = clean([...el.labels].map((l) => l.textContent).join(' '));
      if (!name) {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
        name = clean(copy.textContent);
      }
      if (!name) name = clean(el.getAttribute('title') || el.getAttribute('placeholder'));
      name = name.slice(0, 60);
      if (name) desc += ` "${name}"`;
      const href = el.getAttribute('href') || '';
      return { desc, focusRing: outline || shadow, skipLink: tag === 'a' && /#main$/.test(href) };
    });

  const result = { sequence: [], skipLinkFirst: false, missingFocusRing: [], slashFocusesSearch: false, slashTarget: '', warnings: [] };
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.blur();
    window.scrollTo(0, 0);
  });
  for (let i = 0; i < tabs; i += 1) {
    await page.keyboard.press('Tab');
    const d = await describe();
    result.sequence.push(`${d.desc}${d.focusRing || d.desc === 'body' ? '' : ' (no visible focus ring)'}`);
    if (i === 0) result.skipLinkFirst = d.skipLink;
    if (d.desc !== 'body' && !d.focusRing) result.missingFocusRing.push(d.desc);
  }
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.blur();
  });
  await page.keyboard.press('/');
  const search = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: false, desc: 'body' };
    const ok = el.matches(
      'input[type="search"], [role="searchbox"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], [data-testid*="search" i]',
    );
    const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    return { ok, desc: `${el.tagName.toLowerCase()}${label ? ` "${label}"` : ''}` };
  });
  result.slashFocusesSearch = search.ok;
  result.slashTarget = search.desc;
  await page.keyboard.press('Escape');

  if (!result.skipLinkFirst) result.warnings.push('The first Tab does not reach a skip link to #main.');
  if (result.missingFocusRing.length > 0) result.warnings.push(`No visible focus ring on: ${result.missingFocusRing.join('; ')}`);
  if (!result.slashFocusesSearch) result.warnings.push(`"/" did not focus a search field (focus went to ${search.desc}).`);
  return result;
}

async function shootOne(browser, opts, axePath, shot) {
  const record = {
    route: shot.route,
    state: shot.state,
    width: shot.width,
    theme: shot.theme,
    url: shot.url,
    file: shot.file,
    ready: 'pending',
    readyMs: null,
    readyDetail: '',
    navigationError: '',
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
    axe: null,
    axeError: '',
    screenshotError: '',
    keyboard: null,
  };
  const context = await browser.newContext({
    viewport: { width: shot.width, height: viewportHeight(shot.width) },
    colorScheme: shot.theme,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    bypassCSP: Boolean(axePath),
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  try {
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') record.consoleErrors.push(clip(msg.text()));
    });
    page.on('pageerror', (err) => record.pageErrors.push(clip(err && err.message ? err.message : err)));
    page.on('requestfailed', (req) => {
      const reason = req.failure()?.errorText ?? 'failed';
      if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) record.failedRequests.push(clip(`${reason} ${req.url()}`, 300));
    });
    page.on('response', (resp) => {
      if (resp.status() >= 400) record.httpErrors.push(clip(`${resp.status()} ${resp.url()}`, 300));
    });

    const started = Date.now();
    let navigated = false;
    try {
      await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
      navigated = true;
      if (shot.state === 'loading') {
        await page.waitForSelector('main', { state: 'attached', timeout: opts.timeout });
        record.ready = 'loading-expected';
      } else {
        await page.waitForSelector('main[data-ready="true"]', { state: 'attached', timeout: opts.timeout });
        record.ready = 'ok';
      }
      record.readyMs = Date.now() - started;
    } catch (err) {
      if (!navigated && !isTimeoutError(err)) {
        record.ready = 'navigation-error';
        record.navigationError = clip(err && err.message ? err.message.split('\n')[0] : err, 300);
      } else {
        record.ready = 'timeout';
        record.readyMs = Date.now() - started;
        record.readyDetail = navigated
          ? `waited ${opts.timeout} ms for ${shot.state === 'loading' ? '<main>' : 'main[data-ready="true"]'}; found ${await describeMain(page)}`
          : `navigation did not finish within ${opts.timeout} ms`;
      }
    }

    if (record.ready !== 'navigation-error') {
      const fontsReady = page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
      await withTimeout(fontsReady, Math.min(5000, opts.timeout), 'Waiting for fonts').catch(() => {});
      if (opts.settle > 0) await page.waitForTimeout(opts.settle);
      try {
        const shotDone = page.screenshot({ path: path.join(opts.out, shot.file), fullPage: opts.fullPage, animations: 'disabled', timeout: opts.timeout });
        await withTimeout(shotDone, opts.timeout + 5000, 'Screenshot');
      } catch (err) {
        record.screenshotError = clip(err && err.message ? err.message.split('\n')[0] : err, 300);
        record.file = null;
      }

      if (axePath && !record.screenshotError) {
        try {
          record.axe = await withTimeout(runAxe(page, axePath), Math.max(30000, opts.timeout), 'axe');
        } catch (err) {
          record.axeError = clip(err && err.message ? err.message.split('\n')[0] : err, 300);
        }
      }
      if (opts.keyboard && shot.keyboard && record.ready === 'ok' && !record.screenshotError) {
        try {
          record.keyboard = await withTimeout(keyboardSmoke(page), 30000, 'Keyboard smoke');
        } catch (err) {
          record.keyboard = { warnings: [`Keyboard smoke failed: ${clip(err && err.message ? err.message.split('\n')[0] : err, 200)}`] };
        }
      }
    } else {
      record.file = null;
    }
  } finally {
    await context.close().catch(() => {});
  }
  return record;
}

async function runPool(items, size, worker, onDone) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
      onDone(results[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

// ---------------------------------------------------------------------------
// Contact sheet and reports

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function shotProblems(r) {
  const p = [];
  if (r.ready === 'timeout') p.push('timeout');
  if (r.ready === 'navigation-error') p.push('navigation error');
  if (r.screenshotError) p.push('screenshot failed');
  if (r.pageErrors.length) p.push(`${r.pageErrors.length} page error(s)`);
  if (r.consoleErrors.length) p.push(`${r.consoleErrors.length} console error(s)`);
  const severe = (r.axe ?? []).filter((v) => v.impact === 'critical' || v.impact === 'serious').length;
  if (severe) p.push(`${severe} serious axe rule(s)`);
  return p;
}

// One sheet for the whole run, plus one per route when there are several
// routes: a full matrix (5 routes, 4 states) is too tall to read as one image.
async function writeContactSheets(browser, opts, records) {
  const written = ['contact-sheet.png'];
  await writeContactSheet(browser, opts, records, 'contact-sheet', 'QA contact sheet');
  const routes = [...new Set(records.map((r) => r.route))];
  if (routes.length < 2) return written;
  const used = new Set();
  for (const route of routes) {
    let name = `contact-sheet--${slug(route)}`;
    for (let n = 2; used.has(name); n += 1) name = `contact-sheet--${slug(route)}-${n}`;
    used.add(name);
    const subset = records.filter((r) => r.route === route);
    if (!subset.some((r) => r.file)) continue;
    await writeContactSheet(browser, opts, subset, name, `QA contact sheet: ${route}`);
    written.push(`${name}.png`);
  }
  return written;
}

async function writeContactSheet(browser, opts, records, name, title) {
  const tileWidth = 260;
  const columns = opts.widths.length * opts.themes.length;
  const groups = new Map();
  for (const r of records) {
    const key = `${r.route}${r.state ? `  ?state=${r.state}` : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sections = [...groups.entries()].map(([key, rs]) => {
    const tiles = rs.map((r) => {
      const problems = shotProblems(r);
      const label = `${r.route}${r.state ? ` ?state=${r.state}` : ''} | ${r.width}px | ${r.theme}`;
      const img = r.file ? `<img src="${escapeHtml(encodeURI(r.file))}" alt="">` : '<div class="missing">no screenshot</div>';
      return `<figure class="${problems.length ? 'bad' : ''}">${img}<figcaption><b>${escapeHtml(label)}</b>${problems.length ? `<br>${escapeHtml(problems.join(', '))}` : ''}</figcaption></figure>`;
    });
    return `<h2>${escapeHtml(key)}</h2><div class="row">${tiles.join('')}</div>`;
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{margin:16px;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f4f5;color:#18181b}
h1{font-size:16px;margin:0 0 4px}
p{margin:0 0 8px;color:#52525b}
h2{font-size:13px;margin:18px 0 6px;font-family:ui-monospace,Consolas,monospace}
.row{display:grid;grid-template-columns:repeat(${columns},${tileWidth}px);gap:12px;align-items:start}
figure{margin:0;background:#fff;border:1px solid #d4d4d8;border-radius:4px;padding:6px}
figure img{display:block;width:100%;height:auto;max-height:440px;object-fit:cover;object-position:top;border:1px solid #e4e4e7}
figcaption{margin-top:4px;word-break:break-word}
.bad{border:2px solid #b91c1c}
.bad figcaption{color:#991b1b}
.missing{height:120px;display:grid;place-items:center;color:#71717a;background:#e4e4e7}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>${records.length} shots. Red border: timeout, page or console error, or a serious axe finding. Details in report.md.</p>
${sections.join('\n')}
</body></html>
`;
  const htmlPath = path.join(opts.out, `${name}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const context = await browser.newContext({ viewport: { width: columns * (tileWidth + 12) + 40, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 60000 });
    await page.screenshot({ path: path.join(opts.out, `${name}.png`), fullPage: true });
  } finally {
    await context.close().catch(() => {});
  }
}

function summarize(records, axeEnabled) {
  const impacts = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
  const axeRules = new Map();
  for (const r of records) {
    for (const v of r.axe ?? []) {
      impacts[v.impact in impacts ? v.impact : 'unknown'] += 1;
      if (!axeRules.has(v.id)) axeRules.set(v.id, { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, shots: [], nodes: 0, example: v.targets[0] ?? '' });
      const rule = axeRules.get(v.id);
      rule.shots.push(`${r.route}${r.state ? ` ?state=${r.state}` : ''} ${r.width} ${r.theme}`);
      rule.nodes += v.nodes;
    }
  }
  const s = {
    shots: records.length,
    ready: records.filter((r) => r.ready === 'ok').length,
    loadingExpected: records.filter((r) => r.ready === 'loading-expected').length,
    timeouts: records.filter((r) => r.ready === 'timeout').length,
    navigationErrors: records.filter((r) => r.ready === 'navigation-error').length,
    screenshotErrors: records.filter((r) => r.screenshotError).length,
    pageErrors: records.reduce((n, r) => n + r.pageErrors.length, 0),
    consoleErrors: records.reduce((n, r) => n + r.consoleErrors.length, 0),
    failedRequests: records.reduce((n, r) => n + r.failedRequests.length + r.httpErrors.length, 0),
    axe: axeEnabled ? impacts : null,
    axeErrors: records.filter((r) => r.axeError).length,
    keyboardWarnings: records.reduce((n, r) => n + (r.keyboard?.warnings?.length ?? 0), 0),
  };
  s.failed = s.timeouts > 0 || s.navigationErrors > 0 || s.screenshotErrors > 0 || s.pageErrors > 0 || (axeEnabled && impacts.critical + impacts.serious > 0);
  return { summary: s, axeRules: [...axeRules.values()] };
}

function writeReports(opts, meta, records) {
  const { summary, axeRules } = summarize(records, Boolean(meta.axePath));
  const report = { generatedAt: new Date().toISOString(), target: meta.target, options: meta.options, playwright: meta.playwright, axe: meta.axeNote, summary, axeRules, shots: records };
  fs.writeFileSync(path.join(opts.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  const shotName = (r) => `\`${r.route}${r.state ? ` ?state=${r.state}` : ''}\` ${r.width}px ${r.theme}`;
  md.push('# QA screenshot report', '');
  md.push(`- Generated: ${report.generatedAt}`);
  md.push(`- Target: ${meta.target}`);
  md.push(`- Matrix: ${opts.routes.length} route(s) x ${opts.widths.length} width(s) x ${opts.themes.length} theme(s)${opts.states.length ? ` x (default + ${opts.states.length} state(s))` : ''} = ${records.length} shots`);
  md.push(`- Result: **${summary.failed ? 'FAIL' : 'PASS'}** (fails on page errors, navigation errors, ready timeouts, serious or critical axe violations)`);
  md.push(`- Contact sheet: contact-sheet.png${new Set(records.map((r) => r.route)).size > 1 ? ', and contact-sheet--<route>.png per route' : ''}`, '');
  md.push('## Summary', '', '| Check | Count |', '| --- | --- |');
  md.push(`| Shots | ${summary.shots} |`);
  md.push(`| Ready (data-ready="true") | ${summary.ready} |`);
  if (opts.states.includes('loading')) md.push(`| Loading state (not expected to be ready) | ${summary.loadingExpected} |`);
  md.push(`| Ready timeouts | ${summary.timeouts} |`);
  md.push(`| Navigation errors | ${summary.navigationErrors} |`);
  md.push(`| Screenshot failures | ${summary.screenshotErrors} |`);
  md.push(`| Page errors (uncaught) | ${summary.pageErrors} |`);
  md.push(`| Console errors | ${summary.consoleErrors} |`);
  md.push(`| Failed requests and HTTP 4xx/5xx | ${summary.failedRequests} |`);
  if (summary.axe) md.push(`| Axe violations: critical / serious / moderate / minor | ${summary.axe.critical} / ${summary.axe.serious} / ${summary.axe.moderate} / ${summary.axe.minor} |`);
  else md.push(`| Axe | ${meta.axeNote} |`);
  if (opts.keyboard) md.push(`| Keyboard warnings | ${summary.keyboardWarnings} |`);
  md.push('');

  if (summary.axe) {
    md.push('## Accessibility (axe) by impact', '');
    if (axeRules.length === 0) md.push('No violations found.', '');
    for (const impact of ['critical', 'serious', 'moderate', 'minor', 'unknown']) {
      const rules = axeRules.filter((r) => (r.impact ?? 'unknown') === impact);
      if (rules.length === 0) continue;
      md.push(`### ${impact}`, '');
      for (const r of rules) {
        md.push(`- \`${r.id}\`: ${r.help} (${r.shots.length} shot(s), ${r.nodes} element(s)). Example: \`${r.example}\`. ${r.helpUrl}`);
        md.push(`  - Seen on: ${r.shots.slice(0, 6).join('; ')}${r.shots.length > 6 ? `; and ${r.shots.length - 6} more` : ''}`);
      }
      md.push('');
    }
    if (summary.axeErrors) md.push(`Axe could not run on ${summary.axeErrors} shot(s); see report.json (axeError).`, '');
  }

  const section = (title, rows) => {
    md.push(`## ${title}`, '');
    if (rows.length === 0) md.push('None.');
    else md.push(...rows);
    md.push('');
  };
  section('Ready timeouts', records.filter((r) => r.ready === 'timeout').map((r) => `- ${shotName(r)}: ${r.readyDetail}`));
  section('Navigation errors', records.filter((r) => r.ready === 'navigation-error').map((r) => `- ${shotName(r)}: ${r.navigationError}`));
  section('Screenshot failures', records.filter((r) => r.screenshotError).map((r) => `- ${shotName(r)}: ${r.screenshotError}`));
  section('Page errors', records.flatMap((r) => r.pageErrors.map((e) => `- ${shotName(r)}: ${e}`)));
  section('Console errors', records.flatMap((r) => r.consoleErrors.map((e) => `- ${shotName(r)}: ${e}`)));
  section('Failed requests', records.flatMap((r) => [...r.failedRequests, ...r.httpErrors].map((e) => `- ${shotName(r)}: ${e}`)));

  if (opts.keyboard) {
    md.push('## Keyboard smoke (warnings only)', '');
    const kb = records.filter((r) => r.keyboard);
    if (kb.length === 0) md.push('No keyboard checks ran (they need a page that reached data-ready).');
    for (const r of kb) {
      md.push(`- ${shotName(r)}`);
      if (r.keyboard.sequence) md.push(`  - Tab order: ${r.keyboard.sequence.join(' > ')}`);
      if (r.keyboard.slashTarget !== undefined) md.push(`  - "/" focused: ${r.keyboard.slashTarget}${r.keyboard.slashFocusesSearch ? ' (search field)' : ''}`);
      for (const w of r.keyboard.warnings) md.push(`  - Warning: ${w}`);
    }
    md.push('');
  }

  md.push('## Shots', '', '| Route | State | Width | Theme | Ready | Time (ms) | Problems | File |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of records) {
    md.push(`| \`${r.route}\` | ${r.state ?? 'default'} | ${r.width} | ${r.theme} | ${r.ready} | ${r.readyMs ?? ''} | ${shotProblems(r).join(', ') || 'none'} | ${r.file ?? ''} |`);
  }
  md.push('');
  fs.writeFileSync(path.join(opts.out, 'report.md'), md.join('\n'), 'utf8');
  return summary;
}

// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(HELP);
      return 0;
    }
    opts = readOptions(args);
  } catch (err) {
    console.error(`shoot: ${err.message}\nRun with --help to see the flags.`);
    return 2;
  }

  if (opts.dist) {
    if (!fs.existsSync(opts.dist) || !fs.statSync(opts.dist).isDirectory()) {
      console.error(`shoot: --dist folder not found: ${opts.dist}\nBuild the app first (for example npm run build).`);
      return 2;
    }
    if (!fs.existsSync(path.join(opts.dist, 'index.html'))) {
      console.error(`shoot: no index.html in ${opts.dist}. Point --dist at the built output folder.`);
      return 2;
    }
  }
  let baseUrl;
  if (opts.url) {
    try {
      const u = new URL(opts.url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('not http');
      u.search = '';
      u.hash = '';
      if (!u.pathname.endsWith('/')) u.pathname += '/';
      baseUrl = u.href;
    } catch {
      console.error(`shoot: --url must be an http or https address, got "${opts.url}"`);
      return 2;
    }
  }

  const pw = await loadPlaywright(opts);
  if (pw.error) {
    console.error(
      `shoot: Playwright was not found${pw.detail ? ` (${pw.detail})` : ''}. Looked from:\n  ${pw.error.join('\n  ')}\n` +
        'Install it in the project, then the browser:\n  npm install -D playwright\n  npx playwright install chromium\n' +
        'Or run this script from the project folder, or pass --project <dir>.',
    );
    return 2;
  }

  let axePath = null;
  let axeNote = 'not requested (--axe)';
  if (opts.axe) {
    axePath = findAxe(opts);
    if (axePath) {
      axeNote = `axe-core from ${axePath}`;
    } else {
      axeNote = 'skipped: axe-core is not installed in the project (npm install -D axe-core)';
      console.warn(`shoot: warning: --axe was given but axe-core was not found; accessibility checks are skipped.\n  Install it with: npm install -D axe-core`);
    }
  }

  fs.mkdirSync(opts.out, { recursive: true });

  let server = null;
  let browser = null;
  const cleanup = async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(() => r()));
  };
  const onSignal = () => {
    cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);

  try {
    let target;
    if (opts.dist) {
      server = await startServer(opts.dist, opts.base);
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}${opts.base}`;
      target = `${baseUrl} (serving ${opts.dist})`;
    } else {
      target = baseUrl;
    }

    try {
      browser = await pw.api[opts.browserName].launch({ headless: true });
    } catch (err) {
      console.error(
        `shoot: could not start ${opts.browserName}: ${clip(err && err.message ? err.message.split('\n')[0] : err, 300)}\n` +
          `Install the browser with: npx playwright install ${opts.browserName}`,
      );
      return 2;
    }

    const shots = [];
    const used = new Set();
    const variants = [null, ...opts.states];
    for (const route of opts.routes) {
      for (const state of variants) {
        for (const width of opts.widths) {
          for (const theme of opts.themes) {
            const params = { theme };
            if (state) params.state = state;
            let file = `${slug(route)}${state ? `--${state}` : ''}--${width}--${theme}.png`;
            for (let n = 2; used.has(file); n += 1) file = `${slug(route)}-${n}${state ? `--${state}` : ''}--${width}--${theme}.png`;
            used.add(file);
            shots.push({ route, state, width, theme, file, url: buildUrl(baseUrl, route, params), keyboard: !state && theme === opts.themes[0] });
          }
        }
      }
    }

    console.log(`shoot: ${shots.length} shots of ${target}`);
    console.log(`shoot: using ${pw.spec} from ${pw.file}`);
    let done = 0;
    const records = await runPool(shots, opts.concurrency, (shot) => shootOne(browser, opts, axePath, shot), (r) => {
      done += 1;
      const problems = shotProblems(r);
      console.log(`  [${String(done).padStart(String(shots.length).length)}/${shots.length}] ${r.route}${r.state ? ` ?state=${r.state}` : ''} ${r.width} ${r.theme}: ${r.ready}${problems.length ? ` (${problems.join(', ')})` : ''}`);
    });

    const sheets = records.some((r) => r.file) ? await writeContactSheets(browser, opts, records) : [];
    const summary = writeReports(
      opts,
      {
        target,
        axePath,
        axeNote,
        playwright: `${pw.spec} (${pw.file})`,
        options: { routes: opts.routes, widths: opts.widths, themes: opts.themes, states: opts.states, base: opts.base, timeout: opts.timeout, settle: opts.settle, fullPage: opts.fullPage, browser: opts.browserName, keyboard: opts.keyboard, storageState: Boolean(opts.storageState) },
      },
      records,
    );

    console.log('');
    console.log(`shoot: ${summary.failed ? 'FAIL' : 'PASS'}: ${summary.shots} shots, ${summary.timeouts} timeout(s), ${summary.navigationErrors} navigation error(s), ${summary.pageErrors} page error(s), ${summary.consoleErrors} console error(s)` +
      (summary.axe ? `, axe critical ${summary.axe.critical} serious ${summary.axe.serious} moderate ${summary.axe.moderate} minor ${summary.axe.minor}` : `, axe ${axeNote}`));
    console.log(`shoot: wrote ${path.join(opts.out, 'report.md')}, report.json${sheets.length ? ` and ${sheets.length === 1 ? sheets[0] : `${sheets[0]} plus ${sheets.length - 1} per-route sheet(s)`}` : ''}`);
    return summary.failed ? 1 : 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    await cleanup();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const prefix = err instanceof UsageError ? 'shoot: ' : 'shoot: unexpected error: ';
    console.error(`${prefix}${err && err.message ? err.message : String(err)}`);
    process.exitCode = 2;
  },
);
