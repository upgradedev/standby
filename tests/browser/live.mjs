/** Live acceptance, intentionally without screenshots, traces, video or payload logs.
 * Run only in hosted CI after installing the pinned Playwright browser there:
 * STANDBY_LIVE_URL=https://... node tests/browser/live.mjs
 * Public evaluations are stateless. All test writes remain in browser localStorage.
 */
import { chromium } from 'playwright';
import {assertRenderedMap} from '../../tools/demo/map-render-proof.mjs';
import {prepareCandidateUI} from './static-overlay.mjs';

const base = process.env.STANDBY_LIVE_URL?.replace(/\/$/, '');
if (!base || new URL(base).protocol !== 'https:') throw new Error('STANDBY_LIVE_URL must be an HTTPS deployment.');
const expectedRelease = process.env.STANDBY_EXPECTED_RELEASE;
const candidateSource = process.env.STANDBY_UI_SOURCE ?? process.env.GITHUB_SHA;
let step = 'browser-launch';
const check = (condition, code) => { if (!condition) throw new Error(code); };
const exact = (name) => ({ name, exact: true });
const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const navigationItems = [['Overview','overview'], ['Incident history','incidents'], ['Capacity lab','capacity'], ['Planning queues','queues'], ['Coverage map','map'], ['Settings','settings']];
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});

async function readinessDiagnostic(label, response) {
  let code = '';
  if (response.status() !== 200) {
    try {
      const body = await response.json();
      // Only a bounded symbolic error code is safe to retain; never the message/body.
      if (typeof body?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.code)) code = ` code=${body.code}`;
    } catch { /* An empty/non-JSON gateway error is represented by its HTTP status. */ }
  }
  console.log(`HTTP readiness ${label}=${response.status()}${code}`);
}

async function visible(locator, code) {
  await locator.waitFor({state: 'visible', timeout: 20_000});
  check(await locator.isVisible(), code);
}
async function noHorizontalOverflow(page) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'viewport-horizontal-overflow');
}
async function renderedAttribute(page, locator, name, value) {
  // Playwright clicks and history.pushState can finish before a React transition commits.
  await locator.and(page.locator(`[${name}="${value}"]`)).waitFor({state: 'visible'});
}
async function renderedPage(page, expectedPage, previousIds) {
  await page.waitForFunction(({expectedPage, previousIds}) => {
    const counter = document.querySelector('.table-pagination')?.textContent ?? '';
    const ids = [...document.querySelectorAll('table.data-table tbody .zone-cell small')].map((element) => element.textContent);
    return new RegExp(`Page ${expectedPage} of`).test(counter) && ids.length > 0 && JSON.stringify(ids) !== JSON.stringify(previousIds);
  }, {expectedPage, previousIds});
}
async function navigate(page, label, heading = label) {
  const menu = page.getByRole('button', exact('Open navigation'));
  if (await menu.isVisible()) {
    await menu.click();
    await visible(page.getByRole('dialog', exact('Navigation')), 'mobile-navigation-not-open');
  }
  await page.getByRole('navigation', exact('Main navigation')).getByRole('link', {name: new RegExp(`^${regexEscape(label)}(?:,|$)`)}).click();
  await visible(page.getByRole('heading', exact(heading)), 'navigation-heading-missing');
  check(await page.locator('dialog.mobile-nav[open]').count() === 0, 'mobile-navigation-did-not-close');
  await noHorizontalOverflow(page);
}
async function navigationContract(page, navigation, pendingReview) {
  check(Number.isInteger(pendingReview) && pendingReview >= 0, 'navigation-review-count-unverified');
  const links = [];
  check(await navigation.getByRole('link').count() === navigationItems.length, 'navigation-destination-count-wrong');
  for (const [label, path] of navigationItems) {
    const link = navigation.getByRole('link', {name: new RegExp(`^${regexEscape(label)}(?:,|$)`)});
    await visible(link, 'navigation-destination-hidden');
    const target = new URL(await link.getAttribute('href'), page.url());
    check(target.origin === new URL(base).origin && target.pathname === `/${path}`, 'navigation-destination-wrong');
    check(await link.evaluate(element => element instanceof HTMLAnchorElement && element.tabIndex >= 0 && !element.closest('[inert]') && element.getAttribute('aria-disabled') !== 'true'), 'navigation-link-not-keyboard-reachable');
    const expectedName = path === 'queues' && pendingReview > 0 ? `${label}, ${pendingReview} plans need review` : label;
    check(await navigation.getByRole('link', exact(expectedName)).count() === 1, 'navigation-accessible-name-wrong');
    const badge = link.locator('.nav-badge');
    if (path === 'queues' && pendingReview > 0) {
      check(await badge.count() === 1, 'pending-review-badge-missing');
      await visible(badge, 'pending-review-badge-hidden');
      check((await badge.innerText()).trim() === String(pendingReview), 'pending-review-badge-count-wrong');
    } else check(await badge.count() === 0, 'navigation-has-misleading-total-badge');
    links.push(link);
  }
  await links[0].focus();
  for (let index = 0; index < links.length; index++) {
    check(await links[index].evaluate(element => document.activeElement === element), 'navigation-keyboard-order-broken');
    if (index + 1 < links.length) await page.keyboard.press('Tab');
  }
}
async function navigationRail(page, pendingReview) {
  const collapse = page.getByRole('button', exact('Collapse sidebar'));
  const menu = page.getByRole('button', exact('Open navigation'));
  if (await collapse.isVisible()) {
    await collapse.click();
    await page.locator('.app-shell.sidebar-collapsed').waitFor({state:'visible'});
    check(await page.locator('.app-shell.sidebar-collapsed').count() === 1, 'rail-did-not-collapse');
    await navigationContract(page, page.locator('aside.sidebar').getByRole('navigation', exact('Main navigation')), pendingReview);
    await page.getByRole('button', exact('Expand sidebar')).click();
    await page.locator('.app-shell:not(.sidebar-collapsed)').waitFor({state:'visible'});
  } else if (await menu.isVisible()) {
    await menu.click();
    const mobile = page.getByRole('dialog', exact('Navigation'));
    await visible(mobile, 'mobile-navigation-not-open');
    await navigationContract(page, mobile.getByRole('navigation', exact('Main navigation')), pendingReview);
    await page.keyboard.press('Escape');
    await mobile.waitFor({state:'hidden'});
    check(await menu.evaluate(element => document.activeElement === element), 'mobile-navigation-focus-not-restored');
  } else {
    const rail = page.locator('aside.sidebar');
    await visible(rail, 'permanent-rail-missing');
    const bounds = await rail.boundingBox();
    check(bounds && bounds.width > 0 && bounds.width <= 80, 'permanent-rail-not-compact');
    await navigationContract(page, rail.getByRole('navigation', exact('Main navigation')), pendingReview);
  }
}
async function waitEvaluation(page, action, expectedInput) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/public/evaluations') && response.request().method() === 'POST', {timeout: 30_000});
  await action();
  const response = await pending;
  check(response.status() === 200, 'evaluation-http-failure');
  check(response.headers()['cache-control']?.includes('no-store'), 'evaluation-cache-control');
  const result = await response.json();
  check(result.input.fleetSize === expectedInput.fleetSize && result.input.thresholdMinutes === expectedInput.thresholdMinutes, 'evaluation-input-mismatch');
  check(result.input.unavailableUnitId === expectedInput.unavailableUnitId, 'evaluation-availability-mismatch');
  check(result.solver.selectionCohort === 'train' && result.solver.method === 'exhaustive-enumeration', 'evaluation-selection-contract');
  check(result.plans.proposal.totalDemand > 0 && result.plans.proposal.zones.length > 0, 'evaluation-empty-demand');
  for (const plan of Object.values(result.plans)) {
    check(plan.coveredDemand + plan.uncoveredDemand === plan.totalDemand, 'evaluation-denominator-accounting');
    check(plan.coveragePct >= 0 && plan.coveragePct <= 100, 'evaluation-invalid-percentage');
  }
  await page.getByRole('button', exact('Compare positions')).waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.querySelector('.stale-banner') && !document.querySelector('.map-controls button:disabled'));
  return result;
}
async function evaluatedSiteResidents(page, sites, plan) {
  const expected = sites.map(site => ({id: site.id, units: plan.units.filter(unit => unit.siteId === site.id).map(unit => ({id: unit.id, available: unit.available}))}));
  // Wait for the marker effect, not merely the placement tab's React commit.
  await page.waitForFunction(expected => {
    const markers = [...document.querySelectorAll('.site-marker')];
    return markers.length === expected.length && expected.every(site => {
      const matches = markers.filter(marker => marker.dataset.siteId === site.id);
      if (matches.length !== 1) return false;
      const marker = matches[0], rows = [...marker.querySelectorAll('.unit-site-resident')];
      return marker.dataset.unitIds === site.units.map(unit => unit.id).join(',')
        && marker.dataset.residentCount === String(site.units.length)
        && marker.querySelector('.unit-site-id')?.textContent === site.id
        && marker.querySelector('.unit-site-count')?.textContent === `${site.units.length} ${site.units.length === 1 ? 'unit' : 'units'} · evaluated`
        && rows.length === site.units.length && site.units.every((unit, index) => rows[index].dataset.unitId === unit.id
          && rows[index].querySelector('strong')?.textContent === unit.id
          && rows[index].querySelector('span')?.textContent === (unit.available ? 'Available' : 'Unavailable'));
    });
  }, expected);
  check(await page.locator('.site-marker').count() === sites.length, 'evaluated-site-marker-count-changed');
}
async function coverageLabelsFit(page) {
  await page.locator('.map-canvas.maplibregl-map').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const map = document.querySelector('.map-canvas.maplibregl-map');
    if (!map) return false;
    const frame = map.getBoundingClientRect();
    const labels = [...map.querySelectorAll('.unit-site-label')].filter(label => getComputedStyle(label).visibility !== 'hidden');
    return labels.length > 0 && labels.every(label => {
      const rect = label.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= frame.left - 1 && rect.right <= frame.right + 1
        && rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1
        && [...label.querySelectorAll('.unit-site-id, .unit-site-resident strong')].every(id => id.scrollWidth <= id.clientWidth + 1);
    });
  });
  await noHorizontalOverflow(page);
}
async function draftAvailability(page) {
  return page.locator('.coverage-availability').evaluateAll(buttons => buttons.map(button => ({
    id: button.dataset.testid, pressed: button.getAttribute('aria-pressed'), name: button.getAttribute('aria-label'),
  })));
}
async function locatedUnit(page, unit) {
  await page.waitForURL(url => url.searchParams.get('site') === unit.siteId && url.searchParams.get('unit') === unit.id);
  await page.waitForFunction(unit => {
    const marker = [...document.querySelectorAll('.site-marker')].find(marker => marker.dataset.siteId === unit.siteId);
    const residents = [...document.querySelectorAll('#coverage-site-details .coverage-residents > li.is-selected-unit')];
    return marker?.getAttribute('aria-pressed') === 'true' && residents.length === 1 && residents[0].dataset.unitId === unit.id;
  }, unit);
}

try {
  const installUI = await prepareCandidateUI(base);
  for (const viewport of [{name: 'desktop', width: 1440}, {name: 'tablet', width: 768}, {name: 'mobile', width: 375}]) {
    step = `${viewport.name}:http-and-provenance`;
    const context = await browser.newContext({viewport: {width: viewport.width, height: 950}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const page = await context.newPage();
    const overlay = await installUI(context, page);
    page.setDefaultTimeout(15_000);
    const pageErrors = [];
    let capacityRequests = 0, placementRequests = 0;
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/public/capacity-evaluations')) capacityRequests++;
      if (path.endsWith('/public/evaluations')) placementRequests++;
    });
    page.on('pageerror', () => pageErrors.push('uncaught-page-error'));
    page.on('response', (received) => {
      const path = new URL(received.url()).pathname;
      const route = ['health', 'public/manifest', 'public/zones', 'public/evaluations'].find((name) => path.endsWith(`/v1/${name}`));
      if (route && received.status() >= 400) console.log(`HTTP browser-api ${route}=${received.status()}`);
    });
    const response = await page.goto(`${base}/overview`, {waitUntil: 'domcontentloaded', timeout: 45_000});
    overlay.assertHealthy();
    check(response?.status() === 200, 'live-document-not-200');
    if (process.env.STANDBY_UI_DIST) check(response.headers()['x-standby-qa-source'] === candidateSource, 'candidate-document-not-delivered');
    const configResponse = await context.request.get(`${base}/config.json`);
    check(configResponse.status() === 200, 'config-not-200');
    const config = await configResponse.json();
    const apiBase = new URL(config.apiBase.replace(/\/$/, '') + '/', base + '/').href.replace(/\/$/, '');
    const [healthResponse, manifestResponse, zonesResponse] = await Promise.all([
      context.request.get(`${apiBase}/health`), context.request.get(`${apiBase}/public/manifest`), context.request.get(`${apiBase}/public/zones`),
    ]);
    await Promise.all([
      readinessDiagnostic('health', healthResponse), readinessDiagnostic('manifest', manifestResponse), readinessDiagnostic('zones', zonesResponse),
    ]);
    check([healthResponse, manifestResponse, zonesResponse].every((r) => r.status() === 200), 'live-api-not-ready');
    const health = await healthResponse.json(), manifest = await manifestResponse.json(), {zones} = await zonesResponse.json();
    check(health.status === 'ready' && health.release === manifest.release && config.release === manifest.release, 'release-identifiers-disagree');
    if (expectedRelease) check(manifest.release === expectedRelease, 'unexpected-live-release');
    check(Array.isArray(zones) && zones.length === manifest.limits.zoneCount && zones.length > 20, 'public-zone-snapshot-invalid');
    check(zones.reduce((sum, z) => sum + z.trainCount, 0) === manifest.dataset.quality.accepted.train, 'training-accounting-disagrees');
    check(zones.reduce((sum, z) => sum + z.holdoutCount, 0) === manifest.dataset.quality.accepted.holdout, 'heldout-accounting-disagrees');
    check(manifest.dataset.periods.train.end === manifest.dataset.periods.holdout.start, 'cohort-period-boundaries-disagree');
    check(manifest.matrix && Date.parse(manifest.matrix.expiresAt) > Date.now(), 'matrix-not-fresh');
    check(!JSON.stringify(manifest).includes('durationsSeconds') && !JSON.stringify(zones).includes('traffic_report_id'), 'private-fields-in-public-snapshot');
    step = `${viewport.name}:overview-charts`;
    await visible(page.getByRole('heading', exact('Overview')), 'overview-missing');
    const publication = page.getByRole('img', {name: /^Publication counts by hour,/});
    await visible(publication, 'publication-chart-missing');
    check(await publication.locator('rect.publication-bar').count() === 24, 'hour-chart-not-complete');
    await page.getByText('View hourly data table', {exact: true}).click();
    check(await page.locator('.data-alternative[open] tbody tr').count() === 24, 'hour-chart-accessible-table-incomplete');
    const hourlyCounts = (await page.locator('.data-alternative[open] tbody tr td:last-child').allTextContents()).map(value=>Number(value.replaceAll(',','')));
    check(JSON.stringify(hourlyCounts) === JSON.stringify(manifest.dataset.distribution.holdout.hours), 'hour-chart-data-does-not-match-source');
    await page.waitForSelector('.comparison-row.proposal', {timeout: 30_000});
    await visible(page.getByRole('heading', exact('Same fleet. Different positions.')), 'coverage-chart-missing');
    await noHorizontalOverflow(page);

    step = `${viewport.name}:navigation-rail`;
    await navigationRail(page, 0);

    step = `${viewport.name}:public-capacity-deep-link-and-reload`;
    const capacityUrl = `${base}/capacity?view=baseline&t=17`;
    const capacityDocument = await page.goto(capacityUrl, {waitUntil:'domcontentloaded',timeout:45_000});
    check(capacityDocument?.status() === 200, 'capacity-deep-link-not-200');
    await visible(page.getByRole('heading', exact('Capacity lab')), 'capacity-deep-link-heading-missing');
    await page.locator('main[data-ready="true"]').waitFor();
    await visible(page.getByTestId('capacity-assumption-label'), 'capacity-assumptions-not-visible');
    await renderedAttribute(page, page.getByTestId('capacity-status'), 'data-state', 'not_run');
    check(await page.getByRole('combobox', exact('Active workspace')).inputValue() === 'public', 'capacity-public-path-requires-workspace');
    check(await page.locator('[data-testid="capacity-results"]').count() === 0, 'capacity-shows-uncomputed-results');
    check((await page.title()).includes('[Assumption-based]'), 'capacity-title-not-labeled');
    await page.reload({waitUntil:'domcontentloaded'});
    await visible(page.getByRole('heading', exact('Capacity lab')), 'capacity-reload-heading-missing');
    await page.locator('main[data-ready="true"]').waitFor();
    await renderedAttribute(page, page.getByTestId('capacity-status'), 'data-state', 'not_run');
    const capacityQuery = new URL(page.url()).searchParams;
    check(capacityQuery.get('view') === 'baseline' && capacityQuery.get('t') === '17', 'capacity-reload-lost-url-state');
    check(capacityRequests === 0, 'capacity-deep-link-starts-unsolicited-evaluation');
    await noHorizontalOverflow(page);

    step = `${viewport.name}:history-sort-filter-pagination`;
    await navigate(page, 'Incident history');
    const table = page.locator('table.data-table');
    await visible(table, 'history-table-missing');
    const rows = table.locator('tbody tr');
    await rows.first().waitFor({state: 'visible'});
    const firstIds = await rows.locator('.zone-cell small').allTextContents();
    await page.getByRole('button', exact('Next page')).click();
    await page.waitForURL((url) => url.searchParams.get('page') === '2');
    await renderedPage(page, 2, firstIds);
    const nextIds = await rows.locator('.zone-cell small').allTextContents();
    check(nextIds.length > 0 && firstIds.every((id) => !nextIds.includes(id)), 'pagination-repeats-first-page');
    await table.getByRole('button', exact('Training reports')).click();
    await page.waitForURL((url) => url.searchParams.get('sort') === 'trainCount');
    const expectedSort = new URL(page.url()).searchParams.get('dir') === 'asc' ? 'ascending' : 'descending';
    await renderedAttribute(page, table.getByRole('columnheader', {name: 'Training reports'}), 'aria-sort', expectedSort);
    const sortDirection = await table.getByRole('columnheader', {name: 'Training reports'}).getAttribute('aria-sort');
    const counts = await rows.locator('td:nth-child(2)').allTextContents();
    const values = counts.map((value) => Number(value.replace(/,/g, '')));
    check(values.every((value, i) => i === 0 || (sortDirection === 'ascending' ? value >= values[i - 1] : value <= values[i - 1])), 'training-sort-wrong-order');
    const filter = page.getByRole('textbox', exact('Filter all demand zones'));
    await filter.fill('no-such-zone-browser-gate');
    await visible(page.getByRole('heading', exact('No zones match these filters')), 'history-empty-state-missing');
    await page.getByRole('button', exact('Clear filters')).click();
    await rows.first().waitFor({state: 'visible'});
    await filter.focus();
    await page.keyboard.press('/');
    check(await page.locator('dialog.search-modal[open]').count() === 0, 'search-shortcut-intercepts-editable-field');
    await filter.fill('');
    await page.waitForFunction(() => document.querySelector('input[aria-label="Filter all demand zones"]')?.value === '' && document.querySelectorAll('table.data-table tbody tr').length > 0);

    step = `${viewport.name}:global-search-beyond-current-page`;
    const visibleIds = await rows.locator('.zone-cell small').allTextContents();
    const offPageZone = zones.find((zone) => !visibleIds.includes(zone.id));
    check(Boolean(offPageZone), 'search-fixture-not-outside-page');
    await page.getByRole('heading', exact('Incident history')).click();
    await page.keyboard.press('/');
    const search = page.getByRole('dialog', exact('Global search'));
    await visible(search, 'global-search-shortcut-missing');
    await search.getByRole('textbox', {name: /^Search all demand zones/}).fill(offPageZone.id);
    await search.getByRole('button').filter({hasText: offPageZone.id}).click();
    await visible(page.locator('dialog.detail-drawer[open]'), 'global-search-did-not-open-off-page-zone');
    check(new URL(page.url()).searchParams.get('zone') === offPageZone.id, 'global-search-selected-wrong-zone');
    await page.keyboard.press('Escape');
    await page.locator('dialog.detail-drawer').waitFor({state: 'hidden'});
    await page.waitForURL((url) => !url.searchParams.has('zone'));

    step = `${viewport.name}:master-detail-keyboard-focus`;
    const beforeDrawerPageIds = await rows.locator('.zone-cell small').allTextContents();
    await page.getByRole('button', exact('Next page')).click();
    await page.waitForURL((url) => url.searchParams.get('page') === '2');
    await renderedPage(page, 2, beforeDrawerPageIds);
    const row = rows.first();
    const selectedId = await row.locator('.zone-cell small').textContent();
    const rowLink = row.getByRole('link');
    await rowLink.press('Enter');
    const drawer = page.locator('dialog.detail-drawer[open]');
    await visible(drawer, 'keyboard-row-does-not-open-drawer');
    check(new URL(page.url()).searchParams.get('zone') === selectedId, 'drawer-zone-url-wrong');
    await drawer.getByRole('tab', exact('Coverage')).click();
    await renderedAttribute(page, drawer.getByRole('tab', exact('Coverage')), 'aria-selected', 'true');
    await visible(drawer.getByRole('tabpanel'), 'drawer-coverage-panel-missing');
    await drawer.getByRole('tab', exact('Coverage')).press('ArrowRight');
    await renderedAttribute(page, drawer.getByRole('tab', exact('Provenance')), 'aria-selected', 'true');
    check(await drawer.getByRole('tab', exact('Provenance')).getAttribute('aria-selected') === 'true', 'drawer-keyboard-tabs-broken');
    await visible(drawer.getByText(manifest.dataset.hash, {exact: true}), 'drawer-provenance-hash-missing');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      check(await drawer.evaluate((element) => element.contains(document.activeElement)), 'drawer-focus-escaped');
    }
    await page.keyboard.press('Escape');
    await drawer.waitFor({state: 'hidden'});
    await page.waitForFunction(id => document.activeElement?.id === `history-zone-${id}`, selectedId);
    check(await rowLink.evaluate((element) => document.activeElement === element), 'drawer-focus-not-restored-to-zone-link');
    check(new URL(page.url()).searchParams.get('page') === '2', 'drawer-reset-master-page');

    step = `${viewport.name}:live-map-evaluation-and-unit-unavailable`;
    await navigate(page, 'Coverage map');
    await visible(page.locator('.maplibregl-canvas'), 'map-canvas-missing');
    await visible(page.locator('.site-marker:visible').first(), 'aws-map-did-not-finish-loading');
    check(await page.locator('.site-marker').count() === manifest.dataset.sites.length, 'map-site-layer-incomplete');
    check(await page.locator('.map-error').count() === 0, 'basemap-reported-loading-error');
    await assertRenderedMap(page,{requirePixels:true});
    await page.getByRole('combobox', exact('Hypothetical fleet size')).selectOption('2');
    await page.getByRole('combobox', exact('Road approach threshold')).selectOption('5');
    await visible(page.getByText('Inputs changed. The map shows the previous comparison until you calculate again.', {exact: true}), 'map-stale-state-missing');
    const fresh = await waitEvaluation(page, () => page.getByRole('button', exact('Compare positions')).click(), {fleetSize: 2, thresholdMinutes: 5});
    check(fresh.datasetHash === manifest.dataset.hash, 'map-evaluated-wrong-snapshot');
    step = `${viewport.name}:coverage-unit-location-and-colocation`;
    await page.getByRole('button', exact('Depot')).click();
    await renderedAttribute(page, page.getByRole('button', exact('Depot')), 'aria-pressed', 'true');
    check(await page.getByRole('button', exact('Depot')).getAttribute('aria-pressed') === 'true', 'depot-display-not-selected');
    await evaluatedSiteResidents(page, manifest.dataset.sites, fresh.plans.depot);
    const [depotUnit, secondDepotUnit] = fresh.plans.depot.units;
    check(depotUnit && secondDepotUnit && fresh.plans.depot.units.every(unit => unit.siteId === depotUnit.siteId), 'depot-does-not-colocate-evaluated-units');
    const beforeLocateUrl = page.url(), beforeLocateAvailability = JSON.stringify(await draftAvailability(page)), beforeLocateRequests = placementRequests;
    const locate = page.getByTestId(`coverage-locate-${depotUnit.id}`);
    check(await locate.getAttribute('aria-label') === `Locate ${depotUnit.id}`, 'locate-control-name-wrong');
    check(await locate.evaluate(element => element instanceof HTMLAnchorElement && element.tabIndex >= 0), 'locate-is-not-native-keyboard-link');
    await locate.focus();await locate.press('Enter');
    await locatedUnit(page, depotUnit);
    await coverageLabelsFit(page);
    check(JSON.stringify(await draftAvailability(page)) === beforeLocateAvailability, 'locate-mutates-draft-availability');
    await page.getByTestId(`coverage-locate-${secondDepotUnit.id}`).click();
    await locatedUnit(page, secondDepotUnit);
    await page.goBack();await locatedUnit(page, depotUnit);
    await page.locator('.site-marker.focused').click();
    await page.waitForURL(url => url.searchParams.get('site') === depotUnit.siteId && !url.searchParams.has('unit'));
    await page.waitForFunction(() => document.querySelectorAll('#coverage-site-details .coverage-residents > li.is-selected-unit').length === 0);
    check(await page.locator('#coverage-site-details .coverage-residents > li').count() === fresh.plans.depot.units.length, 'colocated-site-details-omit-unit');
    await page.goBack();await locatedUnit(page, depotUnit);
    await page.goBack();await page.waitForURL(beforeLocateUrl);
    check(JSON.stringify(await draftAvailability(page)) === beforeLocateAvailability, 'site-selection-or-back-mutates-draft-availability');
    check(placementRequests === beforeLocateRequests, 'locate-site-selection-or-back-starts-evaluation');
    await page.getByRole('button', exact('Proposal')).click();
    await renderedAttribute(page, page.getByRole('button', exact('Proposal')), 'aria-pressed', 'true');
    check(await page.getByRole('button', exact('Proposal')).getAttribute('aria-pressed') === 'true', 'proposal-display-not-selected');
    await evaluatedSiteResidents(page, manifest.dataset.sites, fresh.plans.proposal);
    step = `${viewport.name}:coverage-draft-vs-evaluated-availability`;
    const beforeToggleUrl = page.url(), availability = page.getByTestId('coverage-availability-unit-1');
    check(await availability.getAttribute('aria-label') === 'Available: toggle unit-1 draft availability', 'draft-availability-name-wrong');
    await availability.click();
    const unavailableUnit = page.getByRole('button', exact('Unavailable: toggle unit-1 draft availability'));
    await visible(unavailableUnit, 'availability-toggle-not-rendered');
    check(await unavailableUnit.getAttribute('aria-pressed') === 'false', 'availability-toggle-not-unavailable');
    check(page.url() === beforeToggleUrl, 'draft-availability-toggle-mutates-url');
    await evaluatedSiteResidents(page, manifest.dataset.sites, fresh.plans.proposal);
    const busy = await waitEvaluation(page, () => page.getByRole('button', exact('Compare positions')).click(), {fleetSize: 2, thresholdMinutes: 5, unavailableUnitId: 'unit-1'});
    check(busy.inputHash !== fresh.inputHash, 'availability-change-did-not-change-evaluation');
    check(busy.plans.proposal.units.filter((unit) => unit.available).length === 1, 'unavailable-unit-still-counts-as-available');
    check(busy.plans.proposal.backupCoveredDemand === 0, 'single-available-unit-creates-backup');
    await evaluatedSiteResidents(page, manifest.dataset.sites, busy.plans.proposal);
    await coverageLabelsFit(page);
    await page.getByRole('button', exact('Accessible list of all zones')).click();
    await page.locator('.accessible-zone-list button').first().waitFor({state: 'visible'});
    check(await page.locator('.accessible-zone-list button').count() === zones.length, 'accessible-map-list-incomplete');
    await noHorizontalOverflow(page);

    step = `${viewport.name}:local-scenario-input-only-persistence`;
    await page.getByRole('button', exact('Save local scenario')).click();
    await visible(page.getByRole('status').filter({hasText: 'Scenario saved on this device.'}), 'local-save-acknowledgement-missing');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('standby.scenarios.v1') || '[]'));
    check(stored.length === 1 && stored[0].input.fleetSize === 2 && stored[0].input.unavailableUnitId === 'unit-1', 'local-input-not-saved');
    const allowedLocalKeys = new Set(['id', 'name', 'input', 'updatedAt', 'inputHash']);
    check(Object.keys(stored[0]).every((key) => allowedLocalKeys.has(key)), 'provider-result-persisted-in-scenario');
    const storage = await page.evaluate(() => ({...localStorage}));
    check(!JSON.stringify(storage).includes('durationsSeconds') && !JSON.stringify(storage).includes('coveragePct') && !JSON.stringify(storage).includes('travelSeconds'), 'provider-derived-values-persisted');
    await navigate(page, 'Planning queues');
    await page.getByRole('tab', {name: /^Reviewed/}).click();
    await visible(page.getByRole('heading', exact('No plans marked reviewed')), 'public-reviewed-queue-not-empty');
    await page.getByRole('tab', {name: /^Needs review/}).click();
    await visible(page.getByRole('heading', exact(stored[0].name)), 'local-scenario-not-in-review-queue');
    const reviewCount = page.getByRole('tab', {name:/^Needs review/}).locator('span');
    await visible(reviewCount, 'saved-scenario-review-count-hidden');
    check((await reviewCount.innerText()).trim() === '1', 'saved-scenario-review-count-wrong');
    await navigationRail(page, 1);
    await page.reload({waitUntil: 'domcontentloaded'});
    await visible(page.getByRole('heading', exact(stored[0].name)), 'local-input-not-restored-after-reload');
    await renderedAttribute(page, page.getByRole('tab', {name: /^Draft/}), 'aria-selected', 'true');
    check(await page.getByRole('tab', {name: /^Draft/}).getAttribute('aria-selected') === 'true', 'reload-retained-unverified-evaluation-status');
    await navigationRail(page, 0);

    step = `${viewport.name}:preferences-save-reset`;
    await navigate(page, 'Settings');
    const timezone = page.getByLabel(/^Display timezone/), units = page.getByLabel(/^Distance units/);
    await timezone.selectOption('UTC');
    await units.selectOption('km');
    await page.getByRole('button', exact('Save preferences')).click();
    await visible(page.getByRole('status').filter({hasText: 'Preferences saved on this device.'}), 'preferences-save-acknowledgement-missing');
    await page.reload({waitUntil: 'domcontentloaded'});
    await visible(page.getByRole('heading', exact('Settings')), 'settings-reload-failed');
    check(await timezone.inputValue() === 'UTC' && await units.inputValue() === 'km', 'preferences-not-persisted');
    await page.getByRole('button', exact('Reset defaults')).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('.settings-form');
      const selects = panel?.querySelectorAll('select');
      return selects?.[0]?.value === 'America/Chicago' && selects?.[1]?.value === 'mi';
    });
    check(await timezone.inputValue() === 'America/Chicago' && await units.inputValue() === 'mi', 'preferences-reset-failed');
    await page.getByRole('tab', exact('Data & model')).click();
    await visible(page.getByText(manifest.dataset.hash, {exact: true}), 'settings-provenance-missing');
    await noHorizontalOverflow(page);

    step = `${viewport.name}:real-api-outage-banner-and-retry`;
    const outagePattern = '**/v1/public/manifest';
    await page.route(outagePattern, (route) => route.abort('failed'));
    await page.reload({waitUntil: 'domcontentloaded'});
    await visible(page.locator('.api-banner[role="alert"]').filter({hasText: 'API unavailable.'}), 'outage-global-banner-missing');
    await visible(page.getByRole('heading', exact('We could not load this view')), 'outage-route-error-state-missing');
    await page.unroute(outagePattern);
    await page.locator('.api-banner').getByRole('button', exact('Retry')).click();
    // The shell keeps a screen-reader route heading during loading/error. Wait
    // for actual page content and the settled load, not that preserved heading.
    await visible(page.getByLabel(/^Display timezone/), 'outage-settings-content-did-not-recover');
    await page.locator('main[data-ready="true"]').waitFor();
    await visible(page.getByRole('heading', exact('Settings')), 'outage-retry-did-not-recover');
    await page.locator('.api-banner').waitFor({state:'hidden'});
    check(await page.locator('.api-banner').count() === 0, 'outage-banner-remains-after-recovery');
    overlay.assertHealthy();
    check(pageErrors.length === 0, 'uncaught-browser-runtime-error');
    await context.close();
    console.log(`PASS anonymous core journey: ${viewport.name}`);
  }
  console.log('PASS live browser acceptance. No provider results or media artifacts retained.');
} catch (error) {
  // Error messages from browser libraries can quote rendered provider-derived values.
  // Emit the bounded step and our own symbolic assertion only, never DOM/payload dumps.
  const symbolic = error instanceof Error && /^[a-z][a-z0-9-]+$/.test(error.message) ? error.message : 'browser-action-or-timeout';
  console.error(`FAIL ${step}: ${symbolic}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
