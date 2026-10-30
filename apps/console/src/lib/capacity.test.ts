import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPACITY_LIMITS, CAPACITY_MODEL_VERSION, createDefaultCapacityInput,
  type CapacityComparisonResult,
} from '../../../../packages/contracts/src/capacity';
import type {Dataset, MatrixSnapshot} from '../../../../packages/contracts/src/index';
import {evaluateCapacityComparison} from '../../../../packages/domain/src/capacity';
import {hashValue} from '../../../../packages/domain/src/index';
import {ApiError} from './api';
import {capacityInputFingerprint, capacityInputKey, capacityUnavailableReason, validateCapacityResult} from './capacity';
import type {Manifest} from './types';

const now = new Date('2026-10-30T12:00:00Z');

/** Synthetic routing fixture exercises the real domain producer, never provider claims. */
function fixture() {
  const zones = ['x', 'y'].map(id => ({id, name: id, position: [0, 0] as [number, number], polygon: [] as [number, number][],
    trainCount: 10, holdoutCount: 1, trainHours: Array<number>(24).fill(0), holdoutHours: Array<number>(24).fill(0),
    trainDays: Array<number>(7).fill(0), holdoutDays: Array<number>(7).fill(0), qualityFlags: []}));
  const dataset: Dataset = {
    schemaVersion: '1', id: 'synthetic-browser-contract-fixture', hash: 'a'.repeat(64), configHash: 'b'.repeat(64),
    generatedAt: '2026-10-30T10:00:00Z', bounds: [-1, -1, 1, 1], zones,
    periods: {train: {start: '2023-01-01', end: '2025-01-01'}, holdout: {start: '2025-01-01', end: '2026-01-01'}},
    sites: ['a', 'b'].map(id => ({id, name: id, position: [0, 0], assumed: true})),
    distribution: {train: {hours: [], days: []}, holdout: {hours: [], days: []}},
    quality: {inputRows: {train: 20, holdout: 2}, accepted: {train: 20, holdout: 2}, excluded: {train: {}, holdout: {}},
      monthlyReports: {}, approximationMeters: {train: {p50: 0, p90: 0, max: 0}, holdout: {p50: 0, p90: 0, max: 0}}, warnings: []},
    source: {url: 'https://example.invalid/synthetic', attribution: 'Synthetic contract test only', semantics: 'test', policyUrl: 'https://example.invalid/policy'},
  };
  const matrix: MatrixSnapshot = {
    schemaVersion: '1', id: 'synthetic-route-fixture', hash: 'c'.repeat(64), datasetHash: dataset.hash,
    provider: 'HERE', profile: 'Car', generatedAt: '2026-10-30T10:00:00Z', expiresAt: '2026-11-27T10:00:00Z',
    siteIds: ['a', 'b'], zoneIds: ['x', 'y'], durationsSeconds: [[60, 120], [300, null]],
  };
  const manifest: Manifest = {
    dataset, release: 'synthetic-test',
    matrix: {id: matrix.id, hash: matrix.hash, provider: matrix.provider, profile: matrix.profile, generatedAt: matrix.generatedAt, expiresAt: matrix.expiresAt},
    capabilities: {capacity: {modelVersion: CAPACITY_MODEL_VERSION, limits: CAPACITY_LIMITS}},
    limits: {maxFleetSize: 12, minThresholdMinutes: 1, maxThresholdMinutes: 240},
  };
  return {dataset, matrix, manifest, input: createDefaultCapacityInput(['a', 'b'])};
}

test('accepts the actual default 24-job / 10-replication producer despite floating mean rounding', async () => {
  const {dataset, matrix, manifest, input} = fixture();
  // Draft ordering is editable. The producer and browser normalize the same IDs/capabilities.
  input.baseline.units.reverse();
  input.baseline.units[0]!.capabilities.reverse();
  input.candidate.units.reverse();
  const before = structuredClone(input);
  const response = evaluateCapacityComparison(dataset, matrix, input, now);
  assert.equal(input.jobCount, 24);
  assert.equal(input.replications, 10);
  assert.notEqual(response.baseline.aggregate.totalArrivals!.mean, input.jobCount);
  assert.equal(response.baseline.aggregate.totalArrivals!.min, input.jobCount);
  const fingerprint = await capacityInputFingerprint(input);
  assert.equal(fingerprint, response.inputHash);
  assert.equal(capacityInputKey(input), capacityInputKey(response.input));
  assert.equal(validateCapacityResult(response, input, fingerprint, manifest, now.getTime()), response);
  assert.deepEqual(input, before);
});

test('accepts a genuine zero-job output and retains undefined response/queue observations', () => {
  const {dataset, matrix, manifest, input} = fixture();
  input.jobCount = 0;
  const response = evaluateCapacityComparison(dataset, matrix, input, now);
  const accepted = validateCapacityResult(response, input, hashValue(response.input), manifest, now.getTime());
  assert.equal(accepted.baseline.replay.metrics.totalArrivals, 0);
  assert.equal(accepted.baseline.replay.metrics.onTimePct, null);
  assert.equal(accepted.baseline.replay.metrics.p90ResponseMinutes, null);
  assert.equal(accepted.baseline.replay.metrics.p90QueueMinutes, null);
  assert.equal(accepted.baseline.aggregate.onTimePct, null);
  assert.equal(accepted.delta.onTimePct, null);
  assert.deepEqual(accepted.baseline.replay.jobs, []);
  assert.ok(accepted.baseline.replay.events.some(event => event.type === 'horizon'));
});

test('accepts a partial-hour horizon, delayed short shifts and accepted work finishing after the horizon', () => {
  const {dataset, matrix, manifest, input} = fixture();
  Object.assign(input, {horizonMinutes: 37, arrivalWeights: [1], replications: 2, jobCount: 12});
  for (const [type, profile] of Object.entries(input.typeProfiles)) {
    profile.share = type === 'battery' ? 1 : 0;
    profile.onSiteMinutes = {min: 100, mode: 100, max: 100};
  }
  for (const policy of [input.baseline, input.candidate]) for (const unit of policy.units) {
    unit.shiftStartMinutes = 13; unit.shiftEndMinutes = unit.id === 'unit-2' ? 23 : 37;
  }
  const response = evaluateCapacityComparison(dataset, matrix, input, now);
  const accepted = validateCapacityResult(response, input, response.inputHash, manifest, now.getTime());
  assert.ok(accepted.baseline.replay.jobs.some(job => job.completedAtMinutes !== null && job.completedAtMinutes > input.horizonMinutes));
  assert.ok(accepted.baseline.replay.metrics.unserved > 0);
  assert.equal(accepted.baseline.replay.metrics.completed + accepted.baseline.replay.metrics.inProgress + accepted.baseline.replay.metrics.unserved, input.jobCount);
});

test('rejects altered hashes, model, normalized input and private matrix rows as INVALID_RESULT', () => {
  const {dataset, matrix, manifest, input} = fixture();
  const response = evaluateCapacityComparison(dataset, matrix, input, now);
  const changes: Array<(value: CapacityComparisonResult) => void> = [
    value => {value.inputHash = 'd'.repeat(64);},
    value => {value.datasetHash = 'd'.repeat(64);},
    value => {value.configHash = 'd'.repeat(64);},
    value => {value.matrix.hash = 'd'.repeat(64);},
    value => {Object.assign(value, {modelVersion: 'unknown-model'});},
    value => {value.input.seed++;},
    value => {Object.assign(value.matrix, {durationsSeconds: [[60]]});},
  ];
  for (const change of changes) {
    const altered = structuredClone(response); change(altered);
    assert.throws(() => validateCapacityResult(altered, input, response.inputHash, manifest, now.getTime()),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESULT');
  }
  assert.equal(capacityUnavailableReason(manifest, now.getTime()), null);
  assert.throws(() => validateCapacityResult(response, input, response.inputHash, manifest, Date.parse(matrix.expiresAt)),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESULT');
});
