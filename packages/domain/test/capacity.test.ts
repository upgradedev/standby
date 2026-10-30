import assert from 'node:assert/strict';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import type {Dataset, MatrixSnapshot} from '../../contracts/src/index.js';
import {createDefaultCapacityInput, type CapacityInput, type CapacityJobType, type CapacityUnit} from '../../contracts/src/capacity.js';
import {DomainError} from '../src/index.js';
import {evaluateCapacityComparison, simulateCapacityTrace, validateCapacityInput, type CapacitySyntheticJob} from '../src/capacity.js';

const now = new Date('2026-10-30T12:00:00Z');
function fixture(): {dataset: Dataset; matrix: MatrixSnapshot; input: CapacityInput} {
  const zones = [{id: 'x', trainCount: 10, holdoutCount: 0}, {id: 'y', trainCount: 0, holdoutCount: 10}]
    .map(zone => ({...zone, name: zone.id, position: [0, 0] as [number, number], polygon: [] as [number, number][],
      trainHours: Array<number>(24).fill(0), holdoutHours: Array<number>(24).fill(0), trainDays: Array<number>(7).fill(0), holdoutDays: Array<number>(7).fill(0), qualityFlags: []}));
  const dataset: Dataset = {schemaVersion: '1', id: 'synthetic-capacity-fixture', hash: 'dataset-fixture', configHash: 'config-fixture',
    generatedAt: '2026-10-30T10:00:00Z', bounds: [-1, -1, 1, 1],
    periods: {train: {start: '2023-01-01', end: '2025-01-01'}, holdout: {start: '2025-01-01', end: '2026-01-01'}}, zones,
    sites: ['a', 'b'].map(id => ({id, name: id, position: [0, 0], assumed: true})),
    distribution: {train: {hours: [], days: []}, holdout: {hours: [], days: []}},
    quality: {inputRows: {train: 10, holdout: 10}, accepted: {train: 10, holdout: 10}, excluded: {train: {}, holdout: {}},
      monthlyReports: {}, approximationMeters: {train: {p50: 0, p90: 0, max: 0}, holdout: {p50: 0, p90: 0, max: 0}}, warnings: []},
    source: {url: 'synthetic', attribution: 'Hand-computed synthetic test, not provider data', semantics: 'test', policyUrl: 'synthetic'}};
  const matrix: MatrixSnapshot = {schemaVersion: '1', id: 'matrix-fixture', hash: 'matrix-fixture', datasetHash: dataset.hash,
    provider: 'HERE', profile: 'Car', generatedAt: '2026-10-30T10:00:00Z', expiresAt: '2026-11-27T10:00:00Z',
    siteIds: ['a', 'b'], zoneIds: ['x', 'y'], durationsSeconds: [[60, 120], [300, null]]};
  const input = createDefaultCapacityInput(['a', 'b']);
  Object.assign(input, {horizonMinutes: 60, replications: 3, jobCount: 2, arrivalWeights: [1], responseTargetMinutes: 10,
    dispatchPrepMinutes: 2, recoveryMinutes: 5});
  for (const type of ['battery', 'tyre', 'breakdown', 'collision'] as const) input.typeProfiles[type] = {
    share: type === 'battery' ? 1 : 0, onSiteMinutes: {min: 10, mode: 10, max: 10}, flatbedTransportMinutes: 0, flatbedDropoffMinutes: 0};
  input.baseline = {units: [unit()]}; input.candidate = structuredClone(input.baseline);
  return {dataset, matrix, input};
}
function unit(overrides: Partial<CapacityUnit> = {}): CapacityUnit {
  return {id: 'unit-1', kind: 'service_van', siteId: 'a', capabilities: ['battery'], available: true,
    shiftStartMinutes: 0, shiftEndMinutes: 60, ...overrides};
}
function job(id: string, arrivalMinutes = 0, type: CapacityJobType = 'battery', zoneId = 'x'): CapacitySyntheticJob {
  return {id, arrivalMinutes, type, zoneId, serviceQuantile: .5};
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function trace(jobs: CapacitySyntheticJob[], adjust?: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture(); f.input.jobCount = jobs.length; adjust?.(f);
  return simulateCapacityTrace(f.dataset, f.matrix, f.input, 'baseline', jobs, now);
}

test('two simultaneous jobs and one unit have hand-calculated queue, response and renewal', () => {
  const result = trace([job('b'), job('a')]);
  const [first, second] = result.jobs;
  assert.equal(first!.id, 'a'); assert.equal(second!.id, 'b');
  assert.deepEqual([first!.assignedAtMinutes, first!.arrivedAtMinutes, first!.completedAtMinutes, first!.availableAgainMinutes], [0, 3, 13, 18]);
  assert.deepEqual([second!.assignedAtMinutes, second!.arrivedAtMinutes, second!.completedAtMinutes, second!.availableAgainMinutes], [18, 21, 31, 36]);
  assert.deepEqual([result.metrics.totalArrivals, result.metrics.completed, result.metrics.unserved, result.metrics.inProgress], [2, 2, 0, 0]);
  assert.equal(result.metrics.maxQueue, 1); assert.equal(result.metrics.p50ResponseMinutes, 3); assert.equal(result.metrics.p90ResponseMinutes, 21);
  assert.equal(result.metrics.onTimePct, 50); assert.equal(result.metrics.responseSampleSize, 2);
  assert.equal(result.metrics.meanQueueMinutes, 9); assert.equal(result.metrics.meanPrepMinutes, 2); assert.equal(result.metrics.meanTravelMinutes, 1);
  assert.equal(result.metrics.meanResponseMinutes, 12); assert.equal(result.units[0]!.busyMinutes, 36);
  close(result.units[0]!.utilization, .6);
});

test('eligible-pool FCFS allows an idle flatbed to serve collision while an older battery waits', () => {
  const result = trace([job('a'), job('b'), job('c', 0, 'collision'), job('d', 0, 'tyre')], ({input}) => {
    input.baseline.units = [unit({id: 'bike', kind: 'motorcycle'}), unit({id: 'tow', kind: 'flatbed', capabilities: ['collision']})];
    input.typeProfiles.collision.flatbedTransportMinutes = 30; input.typeProfiles.collision.flatbedDropoffMinutes = 10;
  });
  assert.equal(result.jobs[1]!.assignedAtMinutes, 18); assert.equal(result.jobs[2]!.assignedAtMinutes, 0);
  assert.equal(result.jobs[2]!.unitId, 'tow'); assert.equal(result.jobs[2]!.completedAtMinutes, 53);
  assert.equal(result.jobs[2]!.transportMinutes, 30); assert.equal(result.jobs[2]!.dropoffMinutes, 10);
  assert.equal(result.jobs[0]!.transportMinutes, 0); assert.equal(result.jobs[3]!.reason, 'no_compatible_unit');
  assert.equal(result.metrics.unserved, 1); assert.equal(result.metrics.maxQueue, 1);
});

test('a delayed shift can accept work, but a busy unit does not accept another job after shift end', () => {
  const result = trace([job('a', 0), job('b', 19), job('c', 20)], ({input}) => {
    input.baseline.units = [unit({shiftStartMinutes: 10, shiftEndMinutes: 20})];
  });
  assert.equal(result.jobs[0]!.assignedAtMinutes, 10); assert.equal(result.jobs[0]!.completedAtMinutes, 23);
  assert.equal(result.jobs[0]!.availableAgainMinutes, 28); assert.equal(result.units[0]!.overtimeMinutes, 8);
  assert.equal(result.jobs[1]!.reason, 'horizon_queue'); assert.equal(result.jobs[1]!.censoredAtHorizon, true);
  assert.equal(result.jobs[2]!.reason, 'no_shift_capacity');
  assert.deepEqual([result.metrics.started, result.metrics.completed, result.metrics.unserved], [1, 1, 2]);
});

test('planning horizon censors queued and accepted unfinished work without dropping either', () => {
  const result = trace([job('a', 20), job('b', 21)], ({input}) => {
    input.horizonMinutes = 30; input.baseline.units = [unit({shiftEndMinutes: 30})]; input.candidate = structuredClone(input.baseline);
  });
  assert.equal(result.jobs[0]!.status, 'in_progress'); assert.equal(result.jobs[0]!.completedAtMinutes, 33);
  assert.equal(result.jobs[0]!.censoredAtHorizon, true); assert.equal(result.jobs[1]!.reason, 'horizon_queue');
  assert.equal(result.metrics.completed, 0); assert.equal(result.metrics.inProgress, 1); assert.equal(result.metrics.unserved, 1);
  assert.equal(result.metrics.onTimePct, 50); assert.equal(result.units[0]!.overtimeMinutes, 8);
  assert.ok(result.events.some(event => event.type === 'service_completed' && event.atMinutes === 33));
  assert.equal(result.events.filter(event => event.type === 'assigned' && event.atMinutes >= 30).length, 0);
});

test('post-horizon scene arrival is not silently included in served response quantiles', () => {
  const result = trace([job('a', 29)], ({input}) => {
    input.horizonMinutes = 30; input.baseline.units = [unit({shiftEndMinutes: 30})]; input.candidate = structuredClone(input.baseline);
  });
  assert.equal(result.jobs[0]!.arrivedAtMinutes, 32); assert.equal(result.jobs[0]!.onTime, null);
  assert.equal(result.metrics.started, 1); assert.equal(result.metrics.arrived, 0); assert.equal(result.metrics.responseSampleSize, 0);
  assert.equal(result.metrics.queueSampleSize, 1); assert.equal(result.metrics.p50QueueMinutes, 0);
  assert.equal(result.metrics.p90QueueMinutes, 0); assert.equal(result.metrics.meanQueueMinutes, 0);
  assert.equal(result.metrics.p90ResponseMinutes, null); assert.equal(result.metrics.onTimePct, 0);
});

test('unreachable, unavailable and incompatible jobs retain different explicit reasons', () => {
  assert.equal(trace([job('a')], ({matrix}) => {matrix.durationsSeconds[0]![0] = null;}).jobs[0]!.reason, 'no_route');
  assert.equal(trace([job('a')], ({input}) => {input.baseline.units[0]!.available = false;}).jobs[0]!.reason, 'units_unavailable');
  const rejected = trace([job('a', 0, 'collision')]);
  assert.equal(rejected.jobs[0]!.reason, 'no_compatible_unit'); assert.equal(rejected.metrics.maxQueue, 0);
  assert.equal(rejected.metrics.onTimePct, 0); assert.equal(rejected.metrics.responseSampleSize, 0);
});

test('nearest eligible idle unit wins before stable ID tie-break; directional rows are not transposed', () => {
  const chosen = trace([job('a')], ({input}) => {
    input.baseline.units = [unit({id: 'a', siteId: 'b'}), unit({id: 'z', siteId: 'a'})];
  });
  assert.equal(chosen.jobs[0]!.unitId, 'z'); assert.equal(chosen.jobs[0]!.travelMinutes, 1);
  const tied = trace([job('a')], ({input}) => {input.baseline.units = [unit({id: 'z'}), unit({id: 'a'})];});
  assert.equal(tied.jobs[0]!.unitId, 'a');
});

test('zero-duration work keeps lifecycle order and cannot overlap the next assignment', () => {
  const result = trace([job('a'), job('b')], ({input, matrix}) => {
    input.dispatchPrepMinutes = 0; input.recoveryMinutes = 0; matrix.durationsSeconds[0]![0] = 0;
    input.typeProfiles.battery.onSiteMinutes = {min: 0, mode: 0, max: 0};
  });
  for (const id of ['a', 'b']) assert.deepEqual(result.events.filter(event => event.jobId === id).map(event => event.type),
    ['queued', 'assigned', 'travel_started', 'arrived', 'service_completed', 'available']);
  const releaseA = result.events.find(event => event.jobId === 'a' && event.type === 'available')!;
  const assignB = result.events.find(event => event.jobId === 'b' && event.type === 'assigned')!;
  assert.ok(releaseA.sequence < assignB.sequence); assert.equal(result.metrics.maxQueue, 0);
  assert.equal(result.metrics.completed, 2);
});

test('seeded comparison is deterministic, pairs all draws and returns zero deltas for unchanged policy', () => {
  const {dataset, matrix, input} = fixture();
  input.jobCount = 30; input.typeProfiles.battery.onSiteMinutes = {min: 2, mode: 5, max: 15};
  const first = evaluateCapacityComparison(dataset, matrix, input, now);
  assert.deepEqual(first, evaluateCapacityComparison(dataset, matrix, input, now));
  assert.deepEqual(first.baseline, first.candidate);
  for (const value of Object.values(first.delta)) if (value) assert.deepEqual([value.mean, value.min, value.max], [0, 0, 0]);
  assert.ok(first.baseline.replay.jobs.every(item => item.zoneId === 'x'));
  const untouched = structuredClone(input);
  input.candidate.units[0]!.available = false;
  const changed = evaluateCapacityComparison(dataset, matrix, input, now);
  assert.equal(first.pairedSamplesHash, changed.pairedSamplesHash);
  const drawn = (jobs: typeof first.baseline.replay.jobs) => jobs.map(({id, type, zoneId, arrivalMinutes, serviceQuantile}) => ({id, type, zoneId, arrivalMinutes, serviceQuantile}));
  assert.deepEqual(drawn(changed.baseline.replay.jobs), drawn(changed.candidate.replay.jobs));
  assert.deepEqual(untouched.baseline, input.baseline); assert.notEqual(first.inputHash, changed.inputHash);
});

test('empty-demand metrics distinguish no observations from zero-percent performance', () => {
  const {dataset, matrix, input} = fixture(); input.jobCount = 0;
  const result = evaluateCapacityComparison(dataset, matrix, input, now);
  assert.equal(result.baseline.replay.metrics.onTimePct, null); assert.equal(result.baseline.aggregate.onTimePct, null);
  assert.equal(result.baseline.replay.metrics.p50ResponseMinutes, null); assert.equal(result.baseline.replay.metrics.responseSampleSize, 0);
  assert.equal(result.baseline.aggregate.totalArrivals!.mean, 0);
});

test('default assumptions are browser-safe, editable independent copies and validate', () => {
  const input = createDefaultCapacityInput(['a', 'b']);
  assert.deepEqual(input.baseline, input.candidate); assert.deepEqual(validateCapacityInput(input), input);
  input.candidate.units[0]!.capabilities.push('collision'); assert.ok(!input.baseline.units[0]!.capabilities.includes('collision'));
  assert.ok(JSON.stringify(createDefaultCapacityInput(['a', 'b'])).length < 8192);
});

test('strict schema, finite limits and identities reject invalid input before touching models', () => {
  const {input} = fixture();
  const cases: unknown[] = [null, {...input, schemaVersion: 1}, {...input, extra: true}, {...input, seed: .1}, {...input, seed: Infinity},
    {...input, jobCount: 201}, {...input, replications: 21}, {...input, horizonMinutes: 1441}, {...input, arrivalWeights: [0]},
    {...input, travelMultiplier: NaN}, {...input, baseline: {units: []}}, {...input, baseline: {units: [unit(), unit()]}},
    {...input, baseline: {units: [unit({capabilities: ['battery', 'battery']})]}},
    {...input, typeProfiles: {...input.typeProfiles, battery: {...input.typeProfiles.battery, onSiteMinutes: {min: 10, mode: 5, max: 15}}}},
    {...input, typeProfiles: {...input.typeProfiles, battery: {...input.typeProfiles.battery, share: .5}}}];
  for (const raw of cases) assert.throws(() => evaluateCapacityComparison(null as unknown as Dataset, null as unknown as MatrixSnapshot, raw, now),
    (error: unknown) => error instanceof DomainError && error.code === 'INVALID_INPUT');
  const {dataset, matrix} = fixture(); input.baseline.units[0]!.siteId = 'not-a-site';
  assert.throws(() => evaluateCapacityComparison(dataset, matrix, input, now), /existing frozen candidate site/);
});

test('matrix expiry, identity mismatch and unsupported synthetic traces fail visibly', () => {
  const {dataset, matrix, input} = fixture();
  assert.throws(() => evaluateCapacityComparison(dataset, {...matrix, expiresAt: '2026-10-30T11:00:00Z'}, input, now),
    (error: unknown) => error instanceof DomainError && error.code === 'MATRIX_EXPIRED');
  assert.throws(() => evaluateCapacityComparison(dataset, {...matrix, datasetHash: 'other'}, input, now), /provenance/);
  assert.throws(() => simulateCapacityTrace(dataset, matrix, input, 'baseline', [job('a'), job('a')], now), /unique/);
  assert.throws(() => simulateCapacityTrace(dataset, matrix, input, 'baseline', [job('a'), job('b', 60)], now), /precede/);
});

test('bounded maximum run conserves every arrival and preserves per-unit non-overlap', () => {
  const {dataset, matrix, input} = fixture(); Object.assign(input, {horizonMinutes: 1440, jobCount: 200, replications: 20, arrivalWeights: Array<number>(24).fill(1)});
  input.baseline.units = Array.from({length: 12}, (_, i) => unit({id: `unit-${i}`, shiftEndMinutes: 1440}));
  input.candidate = structuredClone(input.baseline);
  assert.ok(JSON.stringify(input).length < 8192);
  const began = performance.now();
  const result = evaluateCapacityComparison(dataset, matrix, input, now);
  console.info(JSON.stringify({test: 'capacity-max-bounds', jobs: 200, replications: 20, unitsPerPolicy: 12,
    elapsedMilliseconds: performance.now() - began, qualification: 'Test runtime measurement, not a Lambda SLA'}));
  const replay = result.baseline.replay, metrics = replay.metrics;
  assert.equal(metrics.completed + metrics.inProgress + metrics.unserved, 200);
  assert.equal(metrics.started, metrics.completed + metrics.inProgress);
  for (const item of input.baseline.units) {
    const jobs = replay.jobs.filter(row => row.unitId === item.id).sort((a, b) => a.assignedAtMinutes! - b.assignedAtMinutes!);
    for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i]!.assignedAtMinutes! >= jobs[i - 1]!.availableAgainMinutes!);
  }
  assert.deepEqual(result.baseline, result.candidate);
});

test('replication aggregation of huge but finite snapshot durations never returns Infinity', () => {
  const {dataset, matrix, input} = fixture(); input.replications = 20; input.jobCount = 12; input.travelMultiplier = 3;
  matrix.durationsSeconds[0]![0] = Number.MAX_VALUE;
  input.baseline.units = Array.from({length: 12}, (_, i) => unit({id: `unit-${i}`})); input.candidate = structuredClone(input.baseline);
  const result = evaluateCapacityComparison(dataset, matrix, input, now);
  for (const aggregate of [result.baseline.aggregate, result.candidate.aggregate, result.delta]) {
    for (const value of Object.values(aggregate)) if (value) assert.ok(Object.values(value).every(Number.isFinite));
  }
});
