import {
  CAPACITY_JOB_TYPES, CAPACITY_LIMITS, CAPACITY_MODEL_VERSION,
  type CapacityAggregateMetrics, type CapacityComparisonResult, type CapacityInput,
  type CapacityMetrics, type CapacityPolicy, type CapacityReplay,
} from '../../../../packages/contracts/src/capacity';
import {ApiError} from './api';
import type {Manifest, MatrixMetadata} from './types';

/** Stable identity for a completed run, including its paired synthetic sample. */
export function capacityRunKey(result: CapacityComparisonResult): string {
  return [result.inputHash, result.datasetHash, result.matrix.hash, result.modelHash, result.pairedSamplesHash].join('.');
}

/** Match server ordering without changing, filtering or coercing the editable draft. */
export function normalizedCapacityInput(input: CapacityInput): CapacityInput {
  const copy = structuredClone(input);
  for (const policy of [copy.baseline, copy.candidate]) {
    policy.units.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const unit of policy.units) unit.capabilities.sort((a, b) => CAPACITY_JOB_TYPES.indexOf(a) - CAPACITY_JOB_TYPES.indexOf(b));
  }
  return copy;
}

/** Arrays retain order; object keys use the same recursive ordering as the API. */
export function capacityCanonicalJson(value: unknown): string {
  let remaining = 12_000;
  const encode = (item: unknown, depth: number): string => {
    if (--remaining < 0 || depth > 32) throw new ApiError('The scenario is too large to submit.', 'INVALID_INPUT', '', 400);
    if (Array.isArray(item)) return `[${item.map(child => encode(child, depth + 1)).join(',')}]`;
    if (item !== null && typeof item === 'object') {
      if (Object.getPrototypeOf(item) !== Object.prototype) throw new ApiError('The scenario must contain plain JSON values.', 'INVALID_INPUT', '', 400);
      const row = item as Record<string, unknown>;
      return `{${Object.keys(row).sort().filter(key => row[key] !== undefined).map(key => `${JSON.stringify(key)}:${encode(row[key], depth + 1)}`).join(',')}}`;
    }
    if (typeof item === 'number' && !Number.isFinite(item)) throw new ApiError('Enter finite numbers before running the scenario. Your draft is preserved.', 'INVALID_INPUT', '', 400);
    const encoded = JSON.stringify(item);
    if (encoded === undefined) throw new ApiError('The scenario contains a value that cannot be submitted as JSON.', 'INVALID_INPUT', '', 400);
    return encoded;
  };
  return encode(value, 0);
}

export function capacityInputKey(input: CapacityInput): string {
  return capacityCanonicalJson(normalizedCapacityInput(input));
}

export async function capacityInputFingerprint(input: CapacityInput): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ApiError('Secure browser hashing is unavailable. Open Standby over HTTPS and retry.', 'BROWSER_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(capacityInputKey(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const count = (value: unknown): value is number => nonnegative(value) && Number.isInteger(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const matrixKeys = ['id', 'hash', 'provider', 'profile', 'generatedAt', 'expiresAt'] as const;

function validMatrix(value: unknown): value is MatrixMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === matrixKeys.length && matrixKeys.every(key => key in row)
    && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 200 && hash(row.hash)
    && row.provider === 'HERE' && row.profile === 'Car'
    && typeof row.generatedAt === 'string' && Number.isFinite(Date.parse(row.generatedAt))
    && typeof row.expiresAt === 'string' && Number.isFinite(Date.parse(row.expiresAt))
    && Date.parse(row.expiresAt) > Date.parse(row.generatedAt);
}

export function capacityUnavailableReason(manifest: Manifest | null, now = Date.now()): string | null {
  if (!manifest) return 'Load the active dataset before running a capacity comparison.';
  const capability = manifest.capabilities?.capacity;
  if (!capability) return 'Capacity evaluation is not enabled by this API release. Reload after the capacity API is available.';
  if (capability.modelVersion !== CAPACITY_MODEL_VERSION || !capability.limits
    || Object.entries(CAPACITY_LIMITS).some(([key, value]) => capability.limits[key as keyof typeof CAPACITY_LIMITS] !== value)) {
    return 'The API capacity model or limits differ from this console. Reload a matching release before running.';
  }
  if (!hash(manifest.dataset.hash) || !hash(manifest.dataset.configHash) || !manifest.dataset.sites.length) return 'Valid dataset provenance and candidate sites are required for a comparison.';
  if (!manifest.matrix) return 'A real route snapshot is required. Capacity evaluation is unavailable until one is ready.';
  if (!validMatrix(manifest.matrix)) return 'Route snapshot metadata is invalid. Reload the active dataset and retry.';
  if (Date.parse(manifest.matrix.expiresAt) <= now) return 'The route snapshot expired. Reload after a fresh snapshot is published.';
  return null;
}

const metricKeys = [
  'totalArrivals', 'started', 'arrived', 'completed', 'inProgress', 'unserved', 'onTime', 'onTimePct',
  'responseSampleSize', 'queueSampleSize', 'p50ResponseMinutes', 'p90ResponseMinutes', 'p50QueueMinutes',
  'p90QueueMinutes', 'meanResponseMinutes', 'meanQueueMinutes', 'meanPrepMinutes', 'meanTravelMinutes',
  'maxQueue', 'totalBusyMinutes', 'busyWithinHorizonMinutes', 'totalOvertimeMinutes',
] as const satisfies readonly (keyof CapacityMetrics)[];
const nullableMetrics = new Set<keyof CapacityMetrics>(['onTimePct', 'p50ResponseMinutes', 'p90ResponseMinutes', 'p50QueueMinutes', 'p90QueueMinutes', 'meanResponseMinutes', 'meanQueueMinutes', 'meanPrepMinutes', 'meanTravelMinutes']);
const countMetrics = ['totalArrivals', 'started', 'arrived', 'completed', 'inProgress', 'unserved', 'onTime', 'responseSampleSize', 'queueSampleSize', 'maxQueue'] as const;
const nullableJobNumbers = ['assignedAtMinutes', 'departAtMinutes', 'arrivedAtMinutes', 'completedAtMinutes', 'availableAgainMinutes', 'queueMinutes', 'prepMinutes', 'travelMinutes', 'onSiteMinutes', 'transportMinutes', 'dropoffMinutes', 'recoveryMinutes'] as const;
const eventTypes = new Set(['queued', 'assigned', 'travel_started', 'arrived', 'service_completed', 'available', 'off_shift', 'shift_ended', 'unserved', 'horizon']);
const reasons = new Set(['no_compatible_unit', 'no_route', 'units_unavailable', 'no_shift_capacity', 'horizon_queue']);

function invalid(): never {
  throw new ApiError('The capacity response failed provenance or consistency checks. Your inputs are preserved; reload the dataset and retry.', 'INVALID_RESULT', '', 502);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function check(condition: unknown): asserts condition { if (!condition) invalid(); }

function validateAggregate(raw: unknown, replications: number, delta = false): CapacityAggregateMetrics {
  const row = object(raw);
  for (const key of metricKeys) {
    const value = row[key];
    if (value === null) { check(nullableMetrics.has(key)); continue; }
    const range = object(value);
    check(finite(range.mean) && finite(range.min) && finite(range.max) && count(range.n) && range.n >= 1 && range.n <= replications);
    check((range.min <= range.mean || near(range.min, range.mean)) && (range.mean <= range.max || near(range.mean, range.max)));
    if (!delta) check(range.min >= 0 && (key !== 'onTimePct' || range.max <= 100));
    if (!nullableMetrics.has(key)) check(range.n === replications);
  }
  const aggregate = row as unknown as CapacityAggregateMetrics;
  const mean = (key: keyof CapacityMetrics) => aggregate[key]!.mean;
  check(near(mean('completed') + mean('inProgress') + mean('unserved'), mean('totalArrivals')));
  check(near(mean('started'), mean('completed') + mean('inProgress')) && near(mean('arrived'), mean('responseSampleSize')) && near(mean('started'), mean('queueSampleSize')));
  return aggregate;
}

/** Validate stored facts and bounds; never rerun dispatch or infer missing observations. */
function validateReplay(raw: unknown, input: CapacityInput, policy: CapacityPolicy): CapacityReplay {
  const row = object(raw);
  check(row.replication === 0 && Array.isArray(row.jobs) && row.jobs.length === input.jobCount && row.jobs.length <= CAPACITY_LIMITS.maxJobs);
  check(Array.isArray(row.units) && row.units.length === policy.units.length && row.units.length <= CAPACITY_LIMITS.maxUnits);
  check(Array.isArray(row.events) && row.events.length <= 8 * CAPACITY_LIMITS.maxJobs + 4 * CAPACITY_LIMITS.maxUnits + 4);
  const metrics = object(row.metrics);
  for (const key of metricKeys) check(metrics[key] === null ? nullableMetrics.has(key) : nonnegative(metrics[key]));
  for (const key of countMetrics) check(count(metrics[key]));
  const m = metrics as unknown as CapacityMetrics;
  check(m.totalArrivals === input.jobCount && m.completed + m.inProgress + m.unserved === m.totalArrivals && m.started === m.completed + m.inProgress);
  check(m.arrived === m.responseSampleSize && m.started === m.queueSampleSize && m.arrived <= m.started && m.onTime <= m.arrived && m.maxQueue <= m.totalArrivals);
  check(m.totalArrivals ? m.onTimePct !== null && near(m.onTimePct, m.onTime / m.totalArrivals * 100) : m.onTimePct === null);
  const responseKeys = ['p50ResponseMinutes', 'p90ResponseMinutes', 'meanResponseMinutes', 'meanPrepMinutes', 'meanTravelMinutes'] as const;
  const queueKeys = ['p50QueueMinutes', 'p90QueueMinutes', 'meanQueueMinutes'] as const;
  check(responseKeys.every(key => (m[key] === null) === (m.responseSampleSize === 0)) && queueKeys.every(key => (m[key] === null) === (m.queueSampleSize === 0)));
  const unitIds = new Set(policy.units.map(unit => unit.id)), jobIds = new Set<string>();
  let completed = 0, inProgress = 0, unserved = 0, arrived = 0, onTime = 0;
  const assignedCounts = new Map<string, number>();
  for (const rawJob of row.jobs) {
    const job = object(rawJob);
    check(identifier(job.id) && !jobIds.has(job.id) && identifier(job.zoneId)); jobIds.add(job.id);
    check(CAPACITY_JOB_TYPES.includes(job.type as typeof CAPACITY_JOB_TYPES[number]) && nonnegative(job.arrivalMinutes) && job.arrivalMinutes < input.horizonMinutes);
    check(nonnegative(job.serviceQuantile) && job.serviceQuantile <= 1 && typeof job.censoredAtHorizon === 'boolean');
    check(nullableJobNumbers.every(key => job[key] === null || nonnegative(job[key])));
    if (job.assignedAtMinutes === null) {
      check(job.status === 'unserved' && job.unitId === null && reasons.has(job.reason as string) && nullableJobNumbers.every(key => job[key] === null) && job.onTime === null);
      check(job.censoredAtHorizon === (job.reason === 'horizon_queue')); unserved++; continue;
    }
    check(typeof job.unitId === 'string' && unitIds.has(job.unitId) && job.reason === null && nullableJobNumbers.every(key => nonnegative(job[key])));
    const times = [job.arrivalMinutes, job.assignedAtMinutes, job.departAtMinutes, job.arrivedAtMinutes, job.completedAtMinutes, job.availableAgainMinutes] as number[];
    check(times.every((time, index) => index === 0 || time >= times[index - 1]!) && times[1]! < input.horizonMinutes);
    const done = times[4]! <= input.horizonMinutes, responded = times[3]! <= input.horizonMinutes;
    check(job.status === (done ? 'completed' : 'in_progress') && job.censoredAtHorizon === !done);
    const expectedOnTime = responded ? times[3]! - times[0]! <= input.responseTargetMinutes : null;
    check(job.onTime === expectedOnTime);
    done ? completed++ : inProgress++; if (responded) arrived++; if (expectedOnTime) onTime++;
    assignedCounts.set(job.unitId, (assignedCounts.get(job.unitId) ?? 0) + 1);
  }
  check(completed === m.completed && inProgress === m.inProgress && unserved === m.unserved && arrived === m.arrived && onTime === m.onTime);
  const seenUnits = new Set<string>();
  for (const rawUnit of row.units) {
    const unit = object(rawUnit);
    check(typeof unit.unitId === 'string' && unitIds.has(unit.unitId) && !seenUnits.has(unit.unitId)); seenUnits.add(unit.unitId);
    check(['assignedJobs', 'busyMinutes', 'busyWithinHorizonMinutes', 'overtimeMinutes', 'shiftMinutes', 'utilization'].every(key => nonnegative(unit[key])));
    check(unit.assignedJobs === (assignedCounts.get(unit.unitId) ?? 0) && (unit.utilization as number) <= 1);
    check((unit.busyWithinHorizonMinutes as number) <= (unit.busyMinutes as number) && (unit.overtimeMinutes as number) <= (unit.busyMinutes as number));
  }
  let lastTime = -1, lastSequence = -1;
  for (const rawEvent of row.events) {
    const event = object(rawEvent);
    check(nonnegative(event.atMinutes) && event.atMinutes >= lastTime && count(event.sequence) && event.sequence > lastSequence && eventTypes.has(event.type as string));
    check(event.jobId === undefined || typeof event.jobId === 'string' && jobIds.has(event.jobId));
    check(event.unitId === undefined || typeof event.unitId === 'string' && unitIds.has(event.unitId));
    check(event.reason === undefined || event.reason === 'scenario_unavailable' || reasons.has(event.reason as string));
    lastTime = event.atMinutes; lastSequence = event.sequence;
  }
  return row as unknown as CapacityReplay;
}

export function validateCapacityResult(raw: unknown, submitted: CapacityInput, fingerprint: string, manifest: Manifest, now = Date.now()): CapacityComparisonResult {
  const result = object(raw);
  check(result.schemaVersion === '1' && result.modelVersion === CAPACITY_MODEL_VERSION && result.replications === submitted.replications);
  check(typeof result.generatedAt === 'string' && Number.isFinite(Date.parse(result.generatedAt)));
  check(hash(result.inputHash) && result.inputHash === fingerprint && result.datasetHash === manifest.dataset.hash && result.configHash === manifest.dataset.configHash && hash(result.modelHash) && hash(result.pairedSamplesHash));
  const matrix = result.matrix, expectedMatrix = manifest.matrix;
  check(validMatrix(matrix) && validMatrix(expectedMatrix) && matrixKeys.every(key => matrix[key] === expectedMatrix[key]) && Date.parse(matrix.expiresAt) > now);
  try { check(capacityCanonicalJson(result.input) === capacityInputKey(submitted)); } catch { invalid(); }
  check(Array.isArray(result.assumptions) && result.assumptions.length > 0 && result.assumptions.length <= 40 && result.assumptions.every(value => typeof value === 'string' && value.length <= 2_000));
  const replays: CapacityReplay[] = [];
  const aggregates: CapacityAggregateMetrics[] = [];
  for (const name of ['baseline', 'candidate'] as const) {
    const policy = object(result[name]);
    const aggregate = validateAggregate(policy.aggregate, submitted.replications);
    check(near(aggregate.totalArrivals!.mean, submitted.jobCount) && aggregate.totalArrivals!.min === submitted.jobCount && aggregate.totalArrivals!.max === submitted.jobCount);
    check(submitted.jobCount === 0 ? aggregate.onTimePct === null : aggregate.onTimePct?.n === submitted.replications
      && near(aggregate.onTimePct.mean, aggregate.onTime!.mean / submitted.jobCount * 100));
    aggregates.push(aggregate);
    replays.push(validateReplay(policy.replay, submitted, submitted[name]));
  }
  const sampleKeys = ['id', 'type', 'zoneId', 'arrivalMinutes', 'serviceQuantile'] as const;
  check(replays[0]!.jobs.every((job, index) => sampleKeys.every(key => job[key] === replays[1]!.jobs[index]![key])));
  const delta = validateAggregate(result.delta, submitted.replications, true);
  check(submitted.jobCount === 0 ? delta.onTimePct === null : delta.onTimePct?.n === submitted.replications);
  for (const key of metricKeys) if (!nullableMetrics.has(key)) check(near(delta[key]!.mean, aggregates[1]![key]!.mean - aggregates[0]![key]!.mean));
  return result as unknown as CapacityComparisonResult;
}
