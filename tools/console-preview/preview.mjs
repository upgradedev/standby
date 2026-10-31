#!/usr/bin/env node
/** Hosted-CI UI review only. New UI build, unchanged public AWS data/API.
 * Results/config stay in memory. Only public app pixels and symbolic provenance
 * are retained. This does not deploy, use an operator identity or build routes.
 * shoot.mjs and lint_ui.mjs beside this file are unmodified skill copies.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir, writeFile, stat, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const HELP = `Standby shell/overview preview (hosted CI only)
Usage: node tools/console-preview/preview.mjs [options]
  --dist <dir>       Built console (default apps/console/dist)
  --out <dir>        Review output (default .runtime/console-preview)
  --source <sha>     Exact UI source SHA (or GITHUB_SHA)
  --live-url <url>   Existing public AWS app (default official Standby URL)
  --help            Print this help without network or browser work
Uses the copied skill shoot.mjs after live HTTP/snapshot readiness checks.
Public API payloads are transient; only screenshots and metadata are saved.
No AWS writes, routing builds, private-workspace calls, identities or deployment.
`;
if (process.argv.includes('--help')) {console.log(HELP); process.exit(0);}
function argument(flag, fallback) {const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1];}
const dist = path.resolve(argument('--dist', 'apps/console/dist'));
const out = path.resolve(argument('--out', '.runtime/console-preview'));
const source = argument('--source', process.env.GITHUB_SHA);
const live = new URL(argument('--live-url', 'https://d34x1513u5u1qs.cloudfront.net/'));
assert.match(source ?? '', /^[a-f0-9]{40}$/, 'An exact source commit SHA is required.');
assert.equal(live.href, 'https://d34x1513u5u1qs.cloudfront.net/', 'Preview is bound to the approved public Standby source.');
assert.ok((await stat(path.join(dist, 'index.html'))).isFile(), 'Build the console in CI first.');
await mkdir(out, {recursive: true});
const receipt = {source, sourceSurface: live.origin, startedAt: new Date().toISOString(), status: 'running',
  scope: 'New shell/overview UI with the existing public historical AWS snapshot; not a deployment.',
  pending: ['Owner shell/overview review', 'Capacity page/list implementation', 'Full release axe and human keyboard/role matrix'],
  calls: {readiness: 0, evaluation: 0}, checks: []};
let server, browser, failure;
const emit = (response, status, payload, type = 'application/json; charset=utf-8') => {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  response.end(type.startsWith('application/json') ? JSON.stringify(payload) : payload);
};
async function fetchPublic(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(15000), redirect: 'error'});
  assert.equal(response.status, 200, `Public readiness failed: ${new URL(url).pathname} HTTP${response.status}`);
  return response;
}
async function jsonPublic(url, options) {
  const response = await fetchPublic(url, options);
  const text = await response.text(); assert.ok(Buffer.byteLength(text) <= 5_000_000, 'Public snapshot response exceeds the preview bound.');
  return JSON.parse(text);
}
async function child(args) {
  const code = await new Promise((resolve, reject) => {const processChild = spawn(process.execPath, args, {stdio: 'inherit'}); processChild.once('error', reject); processChild.once('exit', resolve);});
  assert.equal(code, 0, `Preview command exited ${code}.`);
}
async function serve(config, publicReads, api) {
  const evaluations = new Map();
  const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2'};
  server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/config.json') return emit(response, 200, {...config, apiBase: '/api/v1'});
      if (request.method === 'GET' && publicReads.has(url.pathname) && !url.search) return emit(response, 200, publicReads.get(url.pathname));
      if (request.method === 'POST' && url.pathname === '/api/v1/public/evaluations' && !url.search) {
        let body = '';
        for await (const chunk of request) {body += chunk; assert.ok(Buffer.byteLength(body) <= 8192, 'Bounded preview request body required.');}
        const value = JSON.parse(body);
        assert.deepEqual(Object.keys(value).sort(), ['cohort', 'fleetSize', 'thresholdMinutes']);
        assert.ok(Number.isInteger(value.fleetSize) && value.fleetSize >= 1 && value.fleetSize <= 4);
        assert.ok(Number.isInteger(value.thresholdMinutes) && value.thresholdMinutes >= 5 && value.thresholdMinutes <= 30);
        assert.ok(['train', 'holdout'].includes(value.cohort));
        const key = JSON.stringify([value.fleetSize, value.thresholdMinutes, value.cohort]);
        if (!evaluations.has(key)) {
          receipt.calls.evaluation++;
          evaluations.set(key, jsonPublic(`${api}/public/evaluations`, {method: 'POST', headers: {'content-type': 'application/json'}, body}));
        }
        return emit(response, 200, await evaluations.get(key));
      }
      if (url.pathname.startsWith('/api/')) return emit(response, 404, {code: 'PREVIEW_ROUTE_UNAVAILABLE', message: 'This review preview exposes public historical reads only.', requestId: 'preview', retryable: false});
      if (!['GET', 'HEAD'].includes(request.method)) return emit(response, 405, {code: 'METHOD_NOT_ALLOWED'});
      const filename = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      const relative = path.relative(dist, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return emit(response, 403, {code: 'FORBIDDEN'});
      let target = filename;
      try {if (!(await stat(target)).isFile()) target = path.join(dist, 'index.html');}
      catch {if (path.extname(url.pathname)) return emit(response, 404, {code: 'NOT_FOUND'}); target = path.join(dist, 'index.html');}
      const bytes = await readFile(target);
      response.writeHead(200, {'content-type': mime[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {emit(response, 503, {code: 'PREVIEW_SOURCE_UNAVAILABLE', message: 'The public source did not provide a valid preview response.', requestId: 'preview', retryable: true});}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return `http://127.0.0.1:${server.address().port}/`;
}
async function ready(page, base, width = 1440) {
  await page.setViewportSize({width, height: width < 600 ? 844 : 1000});
  const response = await page.goto(`${base}overview?theme=dark`, {waitUntil: 'domcontentloaded'});
  assert.equal(response.status(), 200);
  await page.locator('main#main[data-ready="true"]').waitFor();
  await page.locator('.comparison-row.proposal').waitFor();
  assert.equal(await page.locator('.api-banner').count(), 0, 'Normal preview must not contain an API banner.');
  assert.equal(await page.locator('.skeleton').count(), 0, 'Normal preview must finish loading before review.');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal page overflow at ${width}px.`);
}
async function smoke(base, publicZones) {
  const {chromium} = await import('playwright');
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({reducedMotion: 'reduce', serviceWorkers: 'block'});
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const normalErrors = [];
  page.on('pageerror', () => normalErrors.push('uncaught-page-error'));
  page.on('console', entry => {if (entry.type() === 'error') normalErrors.push('console-error');});
  await ready(page, base);
  assert.equal(await page.getByRole('navigation', {name: 'Main navigation', exact: true}).getByRole('link').count(), 6, 'All six destinations must remain reachable.');
  const observed = new Intl.NumberFormat('en-US').format(publicZones.reduce((sum, zone) => sum + zone.holdoutCount, 0));
  assert.ok((await page.locator('.kpi-grid').innerText()).includes(observed), 'Overview must show the actual held-out report count.');
  await page.screenshot({path: path.join(out, 'overview-full-desktop.png'), fullPage: true, animations: 'disabled'});
  await page.locator('a.skip-link').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', 'Skip link must focus main.');
  await page.keyboard.press('/');
  const search = page.getByRole('textbox', {name: 'Search all demand zones, candidate sites and scenarios', exact: true});
  await search.waitFor(); assert.ok(await search.evaluate(element => document.activeElement === element), 'Search shortcut must focus its field.');
  await search.fill(publicZones[0].id);
  await page.locator('.search-results button').first().waitFor();
  assert.ok((await page.locator('.search-results').innerText()).includes(publicZones[0].id));
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Collapse sidebar', exact: true}).click();
  await page.reload(); await page.locator('main#main[data-ready="true"]').waitFor();
  assert.equal(await page.locator('.app-shell.sidebar-collapsed').count(), 1, 'Rail preference must survive reload.');
  await page.screenshot({path: path.join(out, 'overview-rail.png'), animations: 'disabled'});
  await page.getByRole('button', {name: 'Expand sidebar', exact: true}).click();
  const workspaceSelect = page.getByRole('combobox', {name: 'Active workspace', exact: true});
  await workspaceSelect.focus();
  await page.screenshot({path: path.join(out, 'workspace-select-focus.png'), animations: 'disabled'});
  await workspaceSelect.click();
  await page.screenshot({path: path.join(out, 'workspace-select-open.png'), animations: 'disabled'});
  await page.keyboard.press('Escape');
  await page.locator('.user-menu summary').click();
  await page.locator('.user-dropdown').waitFor();
  await page.screenshot({path: path.join(out, 'user-dropdown.png'), animations: 'disabled'});
  await page.keyboard.press('Escape');
  for (const width of [390, 320]) {
    await ready(page, base, width);
    const menu = page.getByRole('button', {name: 'Open navigation', exact: true}); await menu.click();
    const dialog = page.getByRole('dialog', {name: 'Navigation', exact: true}); await dialog.waitFor();
    assert.equal(await dialog.getByRole('navigation', {name: 'Main navigation', exact: true}).getByRole('link').count(), 6);
    await page.screenshot({path: path.join(out, `navigation-${width}.png`), animations: 'disabled'});
    await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'});
    assert.ok(await menu.evaluate(element => document.activeElement === element), 'Mobile navigation must return focus.');
  }
  assert.deepEqual(normalErrors, [], 'Normal shell interactions must not emit errors.');
  receipt.checks.push('Live-derived figures', 'No overflow at320/390/1440', 'Six destination nav', 'Search', 'Persisted rail', 'Native select focus', 'User dropdown', 'Mobile navigation/Escape/focus return', 'No normal console errors');
  await context.close();
  const fault = await browser.newContext({viewport: {width: 1440, height: 950}, reducedMotion: 'reduce'});
  await fault.route('**/api/v1/public/manifest', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'FORCED_QA_OUTAGE', message: 'Intentional QA outage. Real data is unavailable.', requestId: 'forced-preview-outage', retryable: true})}));
  const faultPage = await fault.newPage(); await faultPage.goto(`${base}overview?theme=dark`);
  await faultPage.locator('main#main[data-ready="true"]').waitFor(); await faultPage.locator('.api-banner').waitFor();
  assert.equal(await faultPage.locator('.kpi-grid').count(), 0, 'API failure must never render fake KPI zeros or fallback rows.');
  await faultPage.screenshot({path: path.join(out, 'overview-forced-api-error.png'), fullPage: true, animations: 'disabled'});
  receipt.checks.push('Forced API outage is visibly unavailable, with no fake KPI fallback');
  await fault.close();
}
try {
  await fetchPublic(live.href); receipt.calls.readiness++;
  const config = await jsonPublic(new URL('config.json', live)); receipt.calls.readiness++;
  const api = new URL(`${config.apiBase.replace(/\/$/, '')}/`, live);
  assert.equal(api.origin, live.origin); assert.equal(api.pathname, '/api/v1/');
  const endpoint = api.href.replace(/\/$/, '');
  // Sequential reads respect the existing public API rate budget.
  const health = await jsonPublic(`${endpoint}/health`); receipt.calls.readiness++;
  const manifest = await jsonPublic(`${endpoint}/public/manifest`); receipt.calls.readiness++;
  const zones = await jsonPublic(`${endpoint}/public/zones`); receipt.calls.readiness++;
  assert.equal(health.status, 'ready'); assert.equal(health.release, config.release); assert.equal(manifest.release, config.release);
  assert.match(config.release, /^[a-f0-9]{40}$/);
  assert.ok(manifest.matrix && Date.parse(manifest.matrix.expiresAt) > Date.now());
  assert.ok(Array.isArray(zones.zones) && zones.zones.length > 0);
  receipt.live = {release: config.release, datasetHash: manifest.dataset.hash, matrixHash: manifest.matrix.hash, matrixExpiresAt: manifest.matrix.expiresAt, zoneCount: zones.zones.length};
  const base = await serve(config, new Map([['/api/v1/health', health], ['/api/v1/public/manifest', manifest], ['/api/v1/public/zones', zones]]), endpoint);
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  receipt.skillScriptHashes = Object.fromEntries(await Promise.all(['shoot.mjs', 'lint_ui.mjs'].map(async name =>
    [name, createHash('sha256').update(await readFile(path.join(scripts, name))).digest('hex')])));
  // This checkpoint covers the two changed layers only. Full-app strict lint is
  // a later release gate; unrelated pages remain outside this review approval.
  const lintScope = path.resolve('.runtime/console-preview-lint');
  for (const name of ['components/Shell.tsx', 'pages/Overview.tsx']) {
    const target = path.join(lintScope, name); await mkdir(path.dirname(target), {recursive: true});
    await copyFile(path.join('apps/console/src', name), target);
  }
  await child([path.join(scripts, 'lint_ui.mjs'), '--src', lintScope]);
  receipt.checks.push('Skill lint scoped to Shell.tsx and Overview.tsx');
  const skill = path.join(scripts, 'shoot.mjs');
  await child([skill, '--url', base, '--routes', 'overview', '--widths', '1440,390,320', '--themes', 'dark,light', '--keyboard', '--concurrency', '1', '--project', process.cwd(), '--out', path.join(out, 'shots')]);
  const report = JSON.parse(await readFile(path.join(out, 'shots', 'report.json'), 'utf8'));
  const shots = report.shots ?? report.records;
  assert.ok(Array.isArray(shots) && shots.length === 6, 'All six normal screenshots must exist.');
  for (const shot of shots) {
    for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'httpErrors']) assert.deepEqual(shot[key], [], `Unexpected ${key} on ${shot.width}/${shot.theme}.`);
  }
  await smoke(base, zones.zones);
  receipt.status = 'pass';
} catch (error) {failure = error; receipt.status = 'fail'; receipt.failure = error instanceof Error ? error.message : 'Preview failed.';}
finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  receipt.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
if (failure) throw failure;
console.log(JSON.stringify({preview: 'pass', source, serviceRelease: receipt.live.release, normalShots: 6, checks: receipt.checks.length, out}));
