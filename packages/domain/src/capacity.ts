import type {Dataset, MatrixSnapshot} from '../../contracts/src/index.js';
import {
  CAPACITY_JOB_TYPES, CAPACITY_LIMITS, CAPACITY_MODEL_VERSION,
  type CapacityAggregateMetrics, type CapacityComparisonResult, type CapacityInput,
  type CapacityJobType, type CapacityMetrics, type CapacityPolicy, type CapacityRange,
  type CapacityReplay, type CapacityReplayJob, type CapacityTimelineEvent, type CapacityTriangle,
  type CapacityTypeProfile, type CapacityUnit, type CapacityUnitKind, type CapacityUnitMetrics,
  type CapacityUnservedReason,
} from '../../contracts/src/capacity.js';
import {DomainError, hashValue, validateModel} from './index.js';

function invalid(message: string): never {throw new DomainError('INVALID_INPUT', message);}
function object(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object.`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(row, key))) {
    invalid(`${name} must contain exactly: ${keys.join(', ')}.`);
  }
  return row;
}
function number(value: unknown, min: number, max: number, name: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(`${name} must be ${integer ? 'an integer' : 'finite'} between ${min} and ${max}.`);
  }
  return value;
}
function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(value)) invalid(`${name} must be a 1-40 character identifier.`);
  return value;
}
function triangle(raw: unknown, name: string): CapacityTriangle {
  const value = object(raw, ['min', 'mode', 'max'], name);
  const min = number(value.min, 0, 480, `${name}.min`), mode = number(value.mode, 0, 480, `${name}.mode`);
  const max = number(value.max, 0, 480, `${name}.max`);
  if (min > mode || mode > max) invalid(`${name} requires min <= mode <= max.`);
  return {min, mode, max};
}
function policy(raw: unknown, horizon: number, name: string): CapacityPolicy {
  const value = object(raw, ['units'], name);
  if (!Array.isArray(value.units) || value.units.length < 1 || value.units.length > CAPACITY_LIMITS.maxUnits) invalid(`${name} requires 1-12 units.`);
  const units = value.units.map((rawUnit, index): CapacityUnit => {
    const label = `${name}.units[${index}]`, row = object(rawUnit,
      ['id', 'kind', 'siteId', 'capabilities', 'available', 'shiftStartMinutes', 'shiftEndMinutes'], label);
    const id = identifier(row.id, `${label}.id`), siteId = identifier(row.siteId, `${label}.siteId`);
    if (!['motorcycle', 'service_van', 'flatbed'].includes(row.kind as string)) invalid(`${label}.kind is unsupported.`);
    if (!Array.isArray(row.capabilities) || row.capabilities.length > CAPACITY_JOB_TYPES.length ||
      row.capabilities.some(type => !CAPACITY_JOB_TYPES.includes(type as CapacityJobType)) ||
      new Set(row.capabilities).size !== row.capabilities.length) invalid(`${label}.capabilities must be unique supported job types.`);
    if (typeof row.available !== 'boolean') invalid(`${label}.available must be boolean.`);
    const start = number(row.shiftStartMinutes, 0, horizon, `${label}.shiftStartMinutes`);
    const end = number(row.shiftEndMinutes, 0, horizon, `${label}.shiftEndMinutes`);
    if (start >= end) invalid(`${label} requires shiftStartMinutes < shiftEndMinutes.`);
    return {id, kind: row.kind as CapacityUnitKind, siteId,
      capabilities: CAPACITY_JOB_TYPES.filter(type => (row.capabilities as unknown[]).includes(type)),
      available: row.available, shiftStartMinutes: start, shiftEndMinutes: end};
  });
  if (new Set(units.map(unit => unit.id)).size !== units.length) invalid(`${name} unit IDs must be unique.`);
  return {units: units.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)};
}

/** No dataset, SDK, random draw or expensive work precedes bounded allowlist validation. */
export function validateCapacityInput(raw: unknown): CapacityInput {
  const value = object(raw, ['schemaVersion', 'seed', 'horizonMinutes', 'replications', 'jobCount', 'responseTargetMinutes',
    'arrivalWeights', 'dispatchPrepMinutes', 'recoveryMinutes', 'travelMultiplier', 'typeProfiles', 'baseline', 'candidate'], 'Capacity input');
  if (value.schemaVersion !== '1') invalid('Capacity schemaVersion must be the string "1".');
  const seed = number(value.seed, 0, 0xffffffff, 'seed', true);
  const horizonMinutes = number(value.horizonMinutes, 1, CAPACITY_LIMITS.maxHorizonMinutes, 'horizonMinutes', true);
  const replications = number(value.replications, 1, CAPACITY_LIMITS.maxReplications, 'replications', true);
  const jobCount = number(value.jobCount, 0, CAPACITY_LIMITS.maxJobs, 'jobCount', true);
  const responseTargetMinutes = number(value.responseTargetMinutes, 1, 240, 'responseTargetMinutes');
  if (!Array.isArray(value.arrivalWeights) || value.arrivalWeights.length !== Math.ceil(horizonMinutes / 60)) {
    invalid('arrivalWeights must contain one relative intensity for each hour or final partial hour.');
  }
  const arrivalWeights = value.arrivalWeights.map((weight, i) => number(weight, 0, 1000, `arrivalWeights[${i}]`));
  if (!arrivalWeights.some(weight => weight > 0)) invalid('At least one arrival weight must be positive.');
  const dispatchPrepMinutes = number(value.dispatchPrepMinutes, 0, 60, 'dispatchPrepMinutes');
  const recoveryMinutes = number(value.recoveryMinutes, 0, 240, 'recoveryMinutes');
  const travelMultiplier = number(value.travelMultiplier, .25, 3, 'travelMultiplier');
  const rawProfiles = object(value.typeProfiles, CAPACITY_JOB_TYPES, 'typeProfiles');
  const typeProfiles = {} as Record<CapacityJobType, CapacityTypeProfile>;
  for (const type of CAPACITY_JOB_TYPES) {
    const name = `typeProfiles.${type}`, row = object(rawProfiles[type],
      ['share', 'onSiteMinutes', 'flatbedTransportMinutes', 'flatbedDropoffMinutes'], name);
    typeProfiles[type] = {share: number(row.share, 0, 1, `${name}.share`), onSiteMinutes: triangle(row.onSiteMinutes, `${name}.onSiteMinutes`),
      flatbedTransportMinutes: number(row.flatbedTransportMinutes, 0, 240, `${name}.flatbedTransportMinutes`),
      flatbedDropoffMinutes: number(row.flatbedDropoffMinutes, 0, 240, `${name}.flatbedDropoffMinutes`)};
  }
  if (Math.abs(CAPACITY_JOB_TYPES.reduce((sum, type) => sum + typeProfiles[type].share, 0) - 1) > 1e-9) {
    invalid('Assumed incident type shares must sum to one.');
  }
  return {schemaVersion: '1', seed, horizonMinutes, replications, jobCount, responseTargetMinutes, arrivalWeights,
    dispatchPrepMinutes, recoveryMinutes, travelMultiplier, typeProfiles,
    baseline: policy(value.baseline, horizonMinutes, 'baseline'), candidate: policy(value.candidate, horizonMinutes, 'candidate')};
}

export interface CapacitySyntheticJob {id: string; type: CapacityJobType; zoneId: string; arrivalMinutes: number; serviceQuantile: number}
type Sample = CapacitySyntheticJob;
/** Mulberry32; only generation uses this stream. Dispatch never consumes random values. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), state | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
function weightedIndex(weights: number[], quantile: number): number {
  const target = quantile * weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {cumulative += weights[i]!; if (target < cumulative) return i;}
  // Floating point rounding can reach the final boundary; never select zero mass.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return i;
  throw new DomainError('INVALID_DATASET', 'A sampled distribution has no positive weight.');
}
function samples(dataset: Dataset, input: CapacityInput, replication: number): Sample[] {
  const draw = random((input.seed ^ Math.imul(replication + 1, 0x9e3779b9)) >>> 0);
  const zones = [...dataset.zones].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const zoneWeights = zones.map(zone => zone.trainCount);
  const hourMass = input.arrivalWeights.map((weight, hour) => weight * Math.min(60, input.horizonMinutes - hour * 60));
  const typeWeights = CAPACITY_JOB_TYPES.map(type => input.typeProfiles[type].share);
  return Array.from({length: input.jobCount}, (_, index) => {
    const hour = weightedIndex(hourMass, draw());
    const arrivalMinutes = Math.min(hour * 60 + draw() * Math.min(60, input.horizonMinutes - hour * 60), input.horizonMinutes - 1e-9);
    const zoneId = zones[weightedIndex(zoneWeights, draw())]!.id;
    const type = CAPACITY_JOB_TYPES[weightedIndex(typeWeights, draw())]!;
    return {id: `job-${String(index + 1).padStart(3, '0')}`, type, zoneId, arrivalMinutes, serviceQuantile: draw()};
  }).sort((a, b) => a.arrivalMinutes - b.arrivalMinutes || (a.id < b.id ? -1 : 1));
}
function triangular(profile: CapacityTriangle, quantile: number): number {
  const {min, mode, max} = profile;
  if (max === min) return min;
  return quantile < (mode - min) / (max - min)
    ? min + Math.sqrt(quantile * (max - min) * (mode - min))
    : max - Math.sqrt((1 - quantile) * (max - min) * (max - mode));
}

type InternalType = 'arrival' | 'shift_start' | 'shift_end' | 'depart' | 'onsite' | 'complete' | 'release' | 'horizon';
interface Event {at: number; order: number; serial: number; type: InternalType; job?: number; unit?: number}
const PRIORITY: Record<InternalType, number> = {depart: 0, onsite: 1, complete: 2, release: 3, shift_start: 4, shift_end: 5, arrival: 6, horizon: 7};
function earlier(a: Event, b: Event): boolean {return a.at < b.at || (a.at === b.at && (a.order < b.order || (a.order === b.order && a.serial < b.serial)));}
class EventQueue {
  private items: Event[] = [];
  peek(): Event | undefined {return this.items[0];}
  push(event: Event): void {
    const items = this.items; items.push(event); let i = items.length - 1;
    while (i > 0) {const parent = (i - 1) >>> 1; if (!earlier(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!]; i = parent;}
  }
  pop(): Event {
    const first = this.items[0]!, last = this.items.pop()!;
    if (this.items.length) {this.items[0] = last; let i = 0;
      while (true) {let child = i * 2 + 1; if (child >= this.items.length) break;
        if (child + 1 < this.items.length && earlier(this.items[child + 1]!, this.items[child]!)) child++;
        if (!earlier(this.items[child]!, this.items[i]!)) break;
        [this.items[i], this.items[child]] = [this.items[child]!, this.items[i]!]; i = child;}
    }
    return first;
  }
}
interface UnitState {unit: CapacityUnit; job: number | null; metrics: CapacityUnitMetrics}
function mean(values: number[]): number | null {return values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null;}
function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1]!;
}

function simulate(matrix: MatrixSnapshot, input: CapacityInput, config: CapacityPolicy, generated: Sample[]): CapacityReplay {
  const h = input.horizonMinutes, queue = new EventQueue(); let serial = 0, maxQueue = 0;
  const events: CapacityTimelineEvent[] = [], pending: number[] = [];
  const emit = (atMinutes: number, type: CapacityTimelineEvent['type'], jobId?: string, unitId?: string, reason?: CapacityTimelineEvent['reason']) => {
    events.push({atMinutes, sequence: events.length, type, ...(jobId === undefined ? {} : {jobId}),
      ...(unitId === undefined ? {} : {unitId}), ...(reason === undefined ? {} : {reason})});
  };
  const schedule = (at: number, type: InternalType, job?: number, unit?: number) => {
    if (!Number.isFinite(at) || at < 0) throw new DomainError('INVALID_MATRIX', 'Travel durations exceed supported finite simulation arithmetic.');
    queue.push({at, order: PRIORITY[type], serial: serial++, type, job, unit});
  };
  const states: UnitState[] = config.units.map(unit => ({unit, job: null,
    metrics: {unitId: unit.id, assignedJobs: 0, busyMinutes: 0, busyWithinHorizonMinutes: 0, overtimeMinutes: 0,
      shiftMinutes: unit.shiftEndMinutes - unit.shiftStartMinutes, utilization: 0}}));
  const siteIndex = new Map(matrix.siteIds.map((id, i) => [id, i])), zoneIndex = new Map(matrix.zoneIds.map((id, i) => [id, i]));
  const route = (unit: CapacityUnit, job: Sample): number | null => matrix.durationsSeconds[siteIndex.get(unit.siteId)!]![zoneIndex.get(job.zoneId)!]!;
  const jobs: CapacityReplayJob[] = generated.map(sample => ({...sample, status: 'unserved', reason: null, unitId: null,
    assignedAtMinutes: null, departAtMinutes: null, arrivedAtMinutes: null, completedAtMinutes: null, availableAgainMinutes: null,
    queueMinutes: null, prepMinutes: null, travelMinutes: null, onSiteMinutes: null, transportMinutes: null,
    dropoffMinutes: null, recoveryMinutes: null, onTime: null, censoredAtHorizon: false}));
  function impossible(job: Sample): CapacityUnservedReason | null {
    const compatible = states.filter(state => state.unit.capabilities.includes(job.type));
    if (!compatible.length) return 'no_compatible_unit';
    const reachable = compatible.filter(state => route(state.unit, job) !== null);
    if (!reachable.length) return 'no_route';
    const enabled = reachable.filter(state => state.unit.available);
    if (!enabled.length) return 'units_unavailable';
    return enabled.some(state => Math.max(job.arrivalMinutes, state.unit.shiftStartMinutes) < state.unit.shiftEndMinutes) ? null : 'no_shift_capacity';
  }
  states.forEach((state, index) => {
    if (state.unit.available) {
      if (state.unit.shiftStartMinutes > 0) emit(0, 'off_shift', undefined, state.unit.id);
      schedule(state.unit.shiftStartMinutes, 'shift_start', undefined, index); schedule(state.unit.shiftEndMinutes, 'shift_end', undefined, index);
    }
    else emit(0, 'off_shift', undefined, state.unit.id, 'scenario_unavailable');
  });
  generated.forEach((job, index) => schedule(job.arrivalMinutes, 'arrival', index)); schedule(h, 'horizon');
  function assign(at: number): void {
    if (at >= h) return;
    // FCFS within eligible pools: unrelated work can use an otherwise idle incompatible unit.
    for (let i = 0; i < pending.length;) {
      const jobIndex = pending[i]!, job = jobs[jobIndex]!;
      const eligible = states.map((state, index) => ({state, index})).filter(({state}) => state.job === null && state.unit.available &&
        state.unit.shiftStartMinutes <= at && at < state.unit.shiftEndMinutes && state.unit.capabilities.includes(job.type) && route(state.unit, job) !== null)
        .sort((a, b) => route(a.state.unit, job)! - route(b.state.unit, job)! || (a.state.unit.id < b.state.unit.id ? -1 : 1));
      const selected = eligible[0]; if (!selected) {i++; continue;}
      pending.splice(i, 1); const {state, index} = selected, profile = input.typeProfiles[job.type];
      const travel = route(state.unit, job)! / 60 * input.travelMultiplier, onsite = triangular(profile.onSiteMinutes, job.serviceQuantile);
      const transport = state.unit.kind === 'flatbed' ? profile.flatbedTransportMinutes : 0;
      const dropoff = state.unit.kind === 'flatbed' ? profile.flatbedDropoffMinutes : 0;
      const depart = at + input.dispatchPrepMinutes, arrive = depart + travel, completed = arrive + onsite + transport + dropoff;
      const release = completed + input.recoveryMinutes;
      Object.assign(job, {unitId: state.unit.id, assignedAtMinutes: at, departAtMinutes: depart, arrivedAtMinutes: arrive,
        completedAtMinutes: completed, availableAgainMinutes: release, queueMinutes: at - job.arrivalMinutes,
        prepMinutes: input.dispatchPrepMinutes, travelMinutes: travel, onSiteMinutes: onsite, transportMinutes: transport,
        dropoffMinutes: dropoff, recoveryMinutes: input.recoveryMinutes, reason: null});
      state.job = jobIndex; state.metrics.assignedJobs++;
      state.metrics.busyMinutes += release - at;
      state.metrics.busyWithinHorizonMinutes += Math.max(0, Math.min(h, release) - at);
      state.metrics.overtimeMinutes += Math.max(0, release - Math.max(at, state.unit.shiftEndMinutes));
      emit(at, 'assigned', job.id, state.unit.id); schedule(depart, 'depart', jobIndex, index);
      schedule(arrive, 'onsite', jobIndex, index); schedule(completed, 'complete', jobIndex, index); schedule(release, 'release', jobIndex, index);
    }
  }
  while (queue.peek()) {
    const at = queue.peek()!.at;
    do {
      while (queue.peek()?.at === at) {
        const event = queue.pop(), job = event.job === undefined ? undefined : jobs[event.job]!, state = event.unit === undefined ? undefined : states[event.unit]!;
        switch (event.type) {
          case 'arrival': {
            const reason = impossible(job!);
            if (reason) {job!.reason = reason; emit(at, 'unserved', job!.id, undefined, reason);}
            else {pending.push(event.job!); emit(at, 'queued', job!.id);}
            break;
          }
          case 'shift_start': emit(at, 'available', undefined, state!.unit.id); break;
          case 'shift_end': emit(at, state!.job === null ? 'off_shift' : 'shift_ended', undefined, state!.unit.id); break;
          case 'depart': emit(at, 'travel_started', job!.id, state!.unit.id); break;
          case 'onsite': emit(at, 'arrived', job!.id, state!.unit.id); break;
          case 'complete': emit(at, 'service_completed', job!.id, state!.unit.id); break;
          case 'release': state!.job = null; emit(at, at < state!.unit.shiftEndMinutes ? 'available' : 'off_shift', job!.id, state!.unit.id); break;
          case 'horizon':
            for (const index of pending) {jobs[index]!.reason = 'horizon_queue'; jobs[index]!.censoredAtHorizon = true; emit(at, 'unserved', jobs[index]!.id, undefined, 'horizon_queue');}
            pending.length = 0; emit(at, 'horizon'); break;
        }
      }
      assign(at);
    } while (queue.peek()?.at === at);
    // Sustained queue after dispatch: excludes instantaneous waits and permanently rejected jobs.
    maxQueue = Math.max(maxQueue, pending.length);
  }
  const responded = jobs.filter(job => job.arrivedAtMinutes !== null && job.arrivedAtMinutes <= h);
  for (const job of jobs) {
    if (job.assignedAtMinutes !== null) {
      job.status = job.completedAtMinutes! <= h ? 'completed' : 'in_progress';
      job.censoredAtHorizon = job.completedAtMinutes! > h;
      job.onTime = job.arrivedAtMinutes! <= h ? job.arrivedAtMinutes! - job.arrivalMinutes <= input.responseTargetMinutes : null;
    }
  }
  const response = responded.map(job => job.arrivedAtMinutes! - job.arrivalMinutes);
  const assigned = jobs.filter(job => job.assignedAtMinutes !== null), observedQueue = assigned.map(job => job.queueMinutes!);
  const started = assigned.length, completed = jobs.filter(job => job.status === 'completed').length;
  const onTime = responded.filter(job => job.onTime).length;
  const unitMetrics = states.map(state => {
    // Exact in-shift overlap avoids counting post-horizon overtime against earlier work.
    const overlap = jobs.filter(job => job.unitId === state.unit.id).reduce((sum, job) => sum +
      Math.max(0, Math.min(state.unit.shiftEndMinutes, job.availableAgainMinutes!) - job.assignedAtMinutes!), 0);
    return {...state.metrics, utilization: state.unit.available ? Math.min(1, overlap / state.metrics.shiftMinutes) : 0};
  });
  const metrics: CapacityMetrics = {totalArrivals: jobs.length, started, arrived: responded.length, completed, inProgress: started - completed,
    unserved: jobs.length - started, onTime, onTimePct: jobs.length ? onTime / jobs.length * 100 : null,
    responseSampleSize: responded.length, queueSampleSize: assigned.length,
    p50ResponseMinutes: quantile(response, .5), p90ResponseMinutes: quantile(response, .9), meanResponseMinutes: mean(response),
    p50QueueMinutes: quantile(observedQueue, .5), p90QueueMinutes: quantile(observedQueue, .9),
    meanQueueMinutes: mean(observedQueue), meanPrepMinutes: mean(responded.map(job => job.prepMinutes!)),
    meanTravelMinutes: mean(responded.map(job => job.travelMinutes!)), maxQueue,
    totalBusyMinutes: unitMetrics.reduce((sum, unit) => sum + unit.busyMinutes, 0),
    busyWithinHorizonMinutes: unitMetrics.reduce((sum, unit) => sum + unit.busyWithinHorizonMinutes, 0),
    totalOvertimeMinutes: unitMetrics.reduce((sum, unit) => sum + unit.overtimeMinutes, 0)};
  if (Object.values(metrics).some(value => value !== null && !Number.isFinite(value))) throw new DomainError('INVALID_MATRIX', 'Simulation metrics exceed finite arithmetic.');
  return {replication: 0, metrics, jobs, events, units: unitMetrics};
}
function range(values: Array<number | null>): CapacityRange | null {
  const observed = values.filter((value): value is number => value !== null);
  if (!observed.length) return null;
  const result = {mean: mean(observed)!, min: Math.min(...observed), max: Math.max(...observed), n: observed.length};
  if (Object.values(result).some(value => !Number.isFinite(value))) throw new DomainError('INVALID_MATRIX', 'Replication metrics exceed finite arithmetic.');
  return result;
}
function aggregate(metrics: CapacityMetrics[]): CapacityAggregateMetrics {
  const result = {} as CapacityAggregateMetrics;
  for (const key of Object.keys(metrics[0]!) as Array<keyof CapacityMetrics>) result[key] = range(metrics.map(row => row[key]));
  return result;
}

function validateCapacityModel(dataset: Dataset, matrix: MatrixSnapshot, input: CapacityInput, now: Date): void {
  validateModel(dataset, matrix, now);
  const siteIds = new Set(dataset.sites.map(site => site.id));
  if ([...input.baseline.units, ...input.candidate.units].some(unit => !siteIds.has(unit.siteId))) invalid('Every unit must use an existing frozen candidate site.');
  const trainingWeight = dataset.zones.reduce((sum, zone) => sum + zone.trainCount, 0);
  if (!Number.isFinite(trainingWeight) || trainingWeight <= 0) throw new DomainError('INVALID_DATASET', 'Finite positive training geography weights are required.');
}

/** Verification seam for bounded, explicitly synthetic traces; not an HTTP input mode. */
export function simulateCapacityTrace(dataset: Dataset, matrix: MatrixSnapshot, rawInput: unknown, policyName: 'baseline' | 'candidate',
  rawJobs: readonly CapacitySyntheticJob[], now: Date = new Date()): CapacityReplay {
  const input = validateCapacityInput(rawInput);
  if (policyName !== 'baseline' && policyName !== 'candidate') invalid('Unknown synthetic trace policy.');
  if (!Array.isArray(rawJobs) || rawJobs.length !== input.jobCount) invalid('Synthetic trace must match the bounded job count.');
  const generated = rawJobs.map((rawJob, index): Sample => {
    const row = object(rawJob, ['id', 'type', 'zoneId', 'arrivalMinutes', 'serviceQuantile'], `Synthetic job ${index}`);
    const id = identifier(row.id, 'Synthetic job ID'), zoneId = identifier(row.zoneId, 'Synthetic zone ID');
    if (!CAPACITY_JOB_TYPES.includes(row.type as CapacityJobType)) invalid('Synthetic job type is unsupported.');
    const arrivalMinutes = number(row.arrivalMinutes, 0, input.horizonMinutes, 'Synthetic arrival');
    if (arrivalMinutes === input.horizonMinutes) invalid('Synthetic arrivals must precede the horizon.');
    return {id, zoneId, type: row.type as CapacityJobType, arrivalMinutes, serviceQuantile: number(row.serviceQuantile, 0, 1, 'Synthetic service quantile')};
  }).sort((a, b) => a.arrivalMinutes - b.arrivalMinutes || (a.id < b.id ? -1 : 1));
  if (new Set(generated.map(job => job.id)).size !== generated.length) invalid('Synthetic job IDs must be unique.');
  validateCapacityModel(dataset, matrix, input, now);
  if (generated.some(job => !dataset.zones.some(zone => zone.id === job.zoneId))) invalid('Synthetic jobs must use existing zone IDs.');
  return simulate(matrix, input, input[policyName], generated);
}

export function evaluateCapacityComparison(dataset: Dataset, matrix: MatrixSnapshot, rawInput: unknown, now: Date = new Date()): CapacityComparisonResult {
  const input = validateCapacityInput(rawInput);
  validateCapacityModel(dataset, matrix, input, now);
  const allSamples = Array.from({length: input.replications}, (_, i) => samples(dataset, input, i));
  const baseline = allSamples.map(sample => simulate(matrix, input, input.baseline, sample));
  const candidate = allSamples.map(sample => simulate(matrix, input, input.candidate, sample));
  const delta = {} as CapacityAggregateMetrics;
  for (const key of Object.keys(baseline[0]!.metrics) as Array<keyof CapacityMetrics>) {
    delta[key] = range(baseline.map((run, i) => {const before = run.metrics[key], after = candidate[i]!.metrics[key]; return before === null || after === null ? null : after - before;}));
  }
  return {schemaVersion: '1', modelVersion: CAPACITY_MODEL_VERSION, generatedAt: now.toISOString(), input, inputHash: hashValue(input),
    datasetHash: dataset.hash, configHash: dataset.configHash,
    matrix: {id: matrix.id, hash: matrix.hash, provider: matrix.provider, profile: matrix.profile, generatedAt: matrix.generatedAt, expiresAt: matrix.expiresAt},
    modelHash: hashValue({version: CAPACITY_MODEL_VERSION, dispatch: 'fcfs-eligible-pool/nearest-free/id', arrivals: 'fixed-count-hourly-intensity',
      geography: 'train-count-only', service: 'triangular-common-job-quantile', routing: 'site-to-zone-car', renewal: 'assumed-fixed-home', metrics: 'horizon-snapshot-with-postroll'}),
    pairedSamplesHash: hashValue(allSamples), replications: input.replications,
    assumptions: [
      'Assumed synthetic arrivals, incident mix, service durations, fleet capabilities and shifts; not observed dispatch records or a forecast.',
      'The run starts with an empty queue. Enabled units are idle when their assumed shift starts; no inherited work is represented.',
      'Austin training counts weight zone geography only. Report publication times are not incident arrival times.',
      'A fixed job count is sampled using assumed relative hourly intensities; this is not a fitted Poisson arrival model.',
      'All unit kinds use the same directional site-to-zone Car snapshot. The global multiplier is an assumed proxy, not measured motorcycle/flatbed speed or truck feasibility.',
      'Recovery is assumed turnaround, not calculated reverse travel. No moving dispatch, relocation or routed towing legs are modelled.',
      'Flatbed transport and drop-off allowances apply only to flatbeds and are explicit assumed additional occupancy.',
      'FCFS within eligible pools can skip an older blocked job for a free incompatible unit. Choose the nearest eligible idle unit, then stable unit ID.',
      'maxQueue measures sustained waiting after dispatch opportunities; permanently rejected incompatible/NoRoute jobs are excluded and reported as unserved.',
      'Assignments require time before both shift end and horizon. Accepted jobs may finish later, including overtime.',
      'Counts are at the horizon; future completion/release events remain in replay. Response statistics use arrived jobs only with sample size.',
      'Queue statistics use all assigned jobs with queueSampleSize, including jobs whose scene arrival is beyond the horizon.',
      'All arrivals remain the on-time denominator, including unserved and horizon-censored jobs. Replication ranges are not confidence intervals or staffing guarantees.',
    ], baseline: {aggregate: aggregate(baseline.map(run => run.metrics)), replay: baseline[0]!},
    candidate: {aggregate: aggregate(candidate.map(run => run.metrics)), replay: candidate[0]!}, delta};
}
