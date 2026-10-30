import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dataset, FleetUnit, MatrixSnapshot } from '../../contracts/src/index.js';
import { DomainError, evaluatePlacement, evaluateScenario, validateEvaluationInput, validateModel } from '../src/index.js';

const now = new Date('2026-10-30T12:00:00Z');
function fixture(): {dataset: Dataset; matrix: MatrixSnapshot} {
  const zones = [
    {id: 'x', position: [0, 0] as [number, number], trainCount: 8, holdoutCount: 1},
    {id: 'y', position: [1, 0] as [number, number], trainCount: 1, holdoutCount: 7},
    {id: 'z', position: [2, 0] as [number, number], trainCount: 1, holdoutCount: 2},
  ].map((z) => ({...z, name: z.id, polygon: [[0, 0], [1, 0], [0, 1], [0, 0]] as [number, number][], trainHours: Array(24).fill(0), holdoutHours: Array(24).fill(0), trainDays: Array(7).fill(0), holdoutDays: Array(7).fill(0), qualityFlags: []}));
  const dataset: Dataset = {
    schemaVersion: '1', id: 'synthetic', hash: 'source-fixture', configHash: 'config-fixture', generatedAt: '2026-10-30T10:00:00Z',
    bounds: [-1, -1, 3, 1], periods: {train: {start: '2023-01-01T00:00:00Z', end: '2025-01-01T00:00:00Z'}, holdout: {start: '2025-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z'}}, zones,
    sites: ['a', 'b', 'c'].map((id, i) => ({id, name: id, position: [i, 0], assumed: true})),
    distribution: {train: {hours: [], days: []}, holdout: {hours: [], days: []}},
    quality: {inputRows: {train: 10, holdout: 10}, accepted: {train: 10, holdout: 10}, excluded: {train: {}, holdout: {}}, monthlyReports: {}, approximationMeters: {train: {p50: 0, p90: 0, max: 0}, holdout: {p50: 0, p90: 0, max: 0}}, warnings: []},
    source: {url: 'synthetic', attribution: 'Hand-written synthetic test, not provider data', semantics: 'fixture', policyUrl: 'synthetic'},
  };
  const matrix: MatrixSnapshot = {
    schemaVersion: '1', id: 'synthetic-matrix', hash: 'matrix-fixture', datasetHash: dataset.hash,
    provider: 'HERE', profile: 'Car', generatedAt: '2026-10-30T10:00:00Z', expiresAt: '2026-11-26T10:00:00Z',
    siteIds: ['a', 'b', 'c'], zoneIds: ['x', 'y', 'z'], durationsSeconds: [[60, 600, null], [600, 60, 240], [400, 250, 120]],
  };
  return {dataset, matrix};
}
function unit(id: string, siteId: string, available = true, capabilities = ['generic_assistance']): FleetUnit {
  return {id, siteId, available, capabilities, type: 'service_vehicle'};
}

test('exact solve chooses training optimum, then evaluates heldout without changing selection', () => {
  const {dataset, matrix} = fixture();
  const result = evaluateScenario(dataset, matrix, {fleetSize: 1, thresholdMinutes: 5}, now);
  assert.deepEqual(result.plans.proposal.siteIds, ['a']);
  assert.equal(result.plans.proposal.coveragePct, 10);
  assert.equal(result.plans.proposal.totalDemand, 10);
  assert.equal(result.plans.proposal.coveredDemand, 1);
  assert.equal(result.solver.combinations, 3);
  assert.deepEqual(result.plans.proposal.p50, {status: 'reachable', seconds: 600});
  assert.deepEqual(result.plans.proposal.p90, {status: 'unreachable'});
  dataset.zones[0]!.holdoutCount = 10_000;
  dataset.zones[1]!.holdoutCount = 0;
  assert.deepEqual(evaluateScenario(dataset, matrix, {fleetSize: 1, thresholdMinutes: 5, cohort: 'train'}, now).plans.proposal.siteIds, ['a']);
});

test('hand-computed two-unit optimum and denominator are exact', () => {
  const {dataset, matrix} = fixture();
  const result = evaluateScenario(dataset, matrix, {fleetSize: 2, thresholdMinutes: 5}, now);
  assert.deepEqual(result.plans.proposal.siteIds, ['a', 'b']);
  assert.equal(result.plans.proposal.coveredDemand, 10);
  assert.equal(result.plans.proposal.coveragePct, 100);
  assert.equal(result.plans.proposal.backupCoveragePct, 0);
  assert.deepEqual(result.plans.proposal.p90, {status: 'reachable', seconds: 240});
  assert.equal(result.plans.depot.coveragePct, 10);
  assert.equal(result.plans.depot.backupCoveragePct, 10);
});

test('matrix IDs bind asymmetric origin rows and destination columns independently', () => {
  const {dataset, matrix} = fixture();
  matrix.siteIds = ['c', 'a', 'b'];
  matrix.zoneIds = ['z', 'x', 'y'];
  matrix.durationsSeconds = [[120, 400, 250], [null, 60, 600], [240, 600, 60]];
  assert.deepEqual(evaluateScenario(dataset, matrix, {fleetSize: 2, thresholdMinutes: 5}, now).plans.proposal.siteIds, ['a', 'b']);
  // This transposition would report a 240-second approach to x instead of the true 600 seconds.
  assert.equal(evaluatePlacement(dataset, matrix, [unit('one', 'b')], 5, 'holdout').zones.find((z) => z.zoneId === 'x')!.travelSeconds, 600);
});

test('unavailable and incompatible units never create phantom coverage', () => {
  const {dataset, matrix} = fixture();
  const busy = evaluateScenario(dataset, matrix, {fleetSize: 1, thresholdMinutes: 5, unavailableUnitId: 'unit-1'}, now);
  assert.equal(busy.plans.proposal.coveragePct, 0);
  assert.equal(busy.plans.proposal.unreachableDemand, 10);
  assert.ok(busy.plans.proposal.zones.every((zone) => zone.reason === 'no_available_unit'));
  const incompatible = evaluatePlacement(dataset, matrix, [unit('tow', 'a', true, ['towing'])], 5, 'holdout');
  assert.equal(incompatible.coveredDemand, 0);
  assert.ok(incompatible.zones.every((zone) => zone.reason === 'incompatible_unit'));
  assert.throws(() => evaluatePlacement(dataset, matrix, [unit('duplicate', 'a'), unit('duplicate', 'b')], 5, 'train'), /unique identities/);
});

test('busy scenario recomputes the remaining fleet against training only', () => {
  const {dataset, matrix} = fixture();
  const result = evaluateScenario(dataset, matrix, {fleetSize: 2, thresholdMinutes: 5, unavailableUnitId: 'unit-1', cohort: 'train'}, now);
  assert.deepEqual(result.plans.proposal.units.filter((u) => u.available).map((u) => u.siteId), ['a']);
  assert.equal(result.plans.proposal.coveragePct, 80);
  assert.equal(result.plans.proposal.backupCoveragePct, 0);
});

test('threshold boundary is inclusive in seconds; NoRoute remains unreachable', () => {
  const {dataset, matrix} = fixture();
  matrix.durationsSeconds[0]![0] = 300;
  const result = evaluatePlacement(dataset, matrix, [unit('one', 'a')], 5, 'train');
  assert.equal(result.zones[0]!.covered, true);
  assert.equal(result.zones[2]!.travelSeconds, null);
  assert.equal(result.zones[2]!.reason, 'no_route');
  assert.equal(result.unreachableDemand, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('malformed cells, IDs, provenance, empty cohorts and expiry fail closed', () => {
  for (const mutate of [
    (d: Dataset, m: MatrixSnapshot) => { m.durationsSeconds[1]!.pop(); },
    (d: Dataset, m: MatrixSnapshot) => { m.durationsSeconds[0]![0] = Number.NaN; },
    (d: Dataset, m: MatrixSnapshot) => { m.durationsSeconds[0]![0] = -1; },
    (d: Dataset, m: MatrixSnapshot) => { m.zoneIds[1] = 'missing'; },
    (d: Dataset, m: MatrixSnapshot) => { m.datasetHash = 'another-source'; },
    (d: Dataset, m: MatrixSnapshot) => { m.expiresAt = '2026-10-30T12:00:00Z'; },
    (d: Dataset, m: MatrixSnapshot) => { d.zones.forEach((z) => { z.holdoutCount = 0; }); },
  ]) {
    const {dataset, matrix} = fixture();
    mutate(dataset, matrix);
    assert.throws(() => validateModel(dataset, matrix, now), DomainError);
  }
});

test('strict public inputs reject coordinate injection and invalid units', () => {
  for (const raw of [null, [], {fleetSize: 2, thresholdMinutes: 5, origins: [[0, 0]]}, {fleetSize: 5, thresholdMinutes: 5}, {fleetSize: 2, thresholdMinutes: 5.5}, {fleetSize: 2, thresholdMinutes: 5, unavailableUnitId: 'unit-3'}, {fleetSize: 2, thresholdMinutes: 5, cohort: 'future'}]) {
    assert.throws(() => validateEvaluationInput(raw), DomainError);
  }
  assert.deepEqual(validateEvaluationInput({fleetSize: 1, thresholdMinutes: 5}), {fleetSize: 1, thresholdMinutes: 5, cohort: 'holdout'});
});

test('tie breaks remain stable lexicographic site IDs despite source order', () => {
  const {dataset, matrix} = fixture();
  matrix.durationsSeconds = [[60, 60, 60], [60, 60, 60], [60, 60, 60]];
  dataset.sites.reverse();
  assert.deepEqual(evaluateScenario(dataset, matrix, {fleetSize: 2, thresholdMinutes: 5}, now).plans.proposal.siteIds, ['a', 'b']);
});
