import { createHash } from 'node:crypto';
import type {
  Cohort, Dataset, EvaluationInput, EvaluationResult, FleetUnit, MatrixSnapshot,
  PlanResult, StandbySite, TravelQuantile, ZoneCoverage,
} from '../../contracts/src/index.js';

export const SOLVER_VERSION = 'exact-weighted-coverage-v1';
const MINUTE = 60;
const DAY = 86_400_000;
export class DomainError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DomainError'; }
}
function fail(code: string, message: string): never { throw new DomainError(code, message); }
function record(raw: unknown): raw is Record<string, unknown> { return typeof raw === 'object' && raw !== null && !Array.isArray(raw); }
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && a.every((id) => b.includes(id));
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) fail('INVALID_INPUT', 'Cannot fingerprint a non-JSON value.');
  return encoded;
}
export function hashValue(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

export function validateEvaluationInput(raw: unknown): EvaluationInput {
  if (!record(raw)) fail('INVALID_INPUT', 'An evaluation requires a JSON object.');
  const allowed = new Set(['fleetSize', 'thresholdMinutes', 'cohort', 'unavailableUnitId']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) fail('INVALID_INPUT', 'Only fleetSize, thresholdMinutes, cohort and unavailableUnitId are accepted.');
  if (typeof raw.fleetSize !== 'number' || !Number.isInteger(raw.fleetSize) || raw.fleetSize < 1 || raw.fleetSize > 4) fail('INVALID_INPUT', 'Fleet size must be an integer from 1 to 4.');
  if (typeof raw.thresholdMinutes !== 'number' || !Number.isInteger(raw.thresholdMinutes) || raw.thresholdMinutes < 5 || raw.thresholdMinutes > 30) fail('INVALID_INPUT', 'Threshold must be an integer from 5 to 30 minutes.');
  if (raw.cohort !== undefined && raw.cohort !== 'train' && raw.cohort !== 'holdout') fail('INVALID_INPUT', 'Cohort must be train or holdout.');
  if (raw.unavailableUnitId !== undefined && (typeof raw.unavailableUnitId !== 'string' || !Array.from({length: raw.fleetSize}, (_, i) => `unit-${i + 1}`).includes(raw.unavailableUnitId))) fail('INVALID_INPUT', 'Unavailable unit must belong to this fleet.');
  return {
    fleetSize: raw.fleetSize, thresholdMinutes: raw.thresholdMinutes, cohort: raw.cohort ?? 'holdout',
    ...(raw.unavailableUnitId === undefined ? {} : {unavailableUnitId: raw.unavailableUnitId}),
  };
}

export function validateModel(dataset: Dataset, matrix: MatrixSnapshot, now: Date): void {
  if (!dataset || dataset.schemaVersion !== '1' || !Array.isArray(dataset.zones) || dataset.zones.length < 1 || dataset.zones.length > 240 || !Array.isArray(dataset.sites) || dataset.sites.length < 1 || dataset.sites.length > 12) fail('INVALID_DATASET', 'Dataset exceeds the finite model bounds or is empty.');
  if (new Set(dataset.zones.map((z) => z.id)).size !== dataset.zones.length || new Set(dataset.sites.map((s) => s.id)).size !== dataset.sites.length) fail('INVALID_DATASET', 'Dataset IDs must be unique.');
  if (dataset.zones.some((zone) => !Number.isInteger(zone.trainCount) || zone.trainCount < 0 || !Number.isInteger(zone.holdoutCount) || zone.holdoutCount < 0)) fail('INVALID_DATASET', 'Demand must be non-negative report counts.');
  if (!dataset.zones.some((z) => z.trainCount > 0) || !dataset.zones.some((z) => z.holdoutCount > 0)) fail('INVALID_DATASET', 'Both reporting cohorts require eligible demand.');
  if (!matrix || matrix.schemaVersion !== '1' || matrix.datasetHash !== dataset.hash || matrix.provider !== 'HERE' || matrix.profile !== 'Car') fail('INVALID_MATRIX', 'Matrix provenance or profile does not match this dataset.');
  const generatedAt = Date.parse(matrix.generatedAt), expiresAt = Date.parse(matrix.expiresAt);
  if (![generatedAt, expiresAt, now.getTime()].every(Number.isFinite) || expiresAt <= generatedAt || generatedAt > now.getTime() + MINUTE * 1000 || expiresAt - generatedAt > 28 * DAY) fail('INVALID_MATRIX', 'Matrix timestamps violate the bounded snapshot lifetime.');
  if (now.getTime() >= expiresAt) fail('MATRIX_EXPIRED', 'The road-time snapshot has expired. A new owner-controlled matrix is required.');
  if (!Array.isArray(matrix.siteIds) || !Array.isArray(matrix.zoneIds) || !sameIds(matrix.siteIds, dataset.sites.map((s) => s.id)) || !sameIds(matrix.zoneIds, dataset.zones.map((z) => z.id))) fail('INVALID_MATRIX', 'Matrix origin and destination IDs must exactly cover the frozen model.');
  if (!Array.isArray(matrix.durationsSeconds) || matrix.durationsSeconds.length !== matrix.siteIds.length || matrix.durationsSeconds.some((row) => !Array.isArray(row) || row.length !== matrix.zoneIds.length || row.some((duration) => duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)))) fail('INVALID_MATRIX', 'Each directional matrix cell must contain seconds or an explicit NoRoute null.');
}

function weightedQuantile(zones: ZoneCoverage[], q: number): TravelQuantile {
  const total = zones.reduce((sum, zone) => sum + zone.demand, 0);
  if (total === 0) return {status: 'unreachable'};
  let cumulative = 0;
  const ordered = [...zones].filter((zone) => zone.demand > 0).sort((a, b) => (a.travelSeconds ?? Infinity) - (b.travelSeconds ?? Infinity) || a.zoneId.localeCompare(b.zoneId));
  for (const zone of ordered) {
    cumulative += zone.demand;
    if (cumulative >= total * q) return zone.travelSeconds === null ? {status: 'unreachable'} : {status: 'reachable', seconds: zone.travelSeconds};
  }
  return {status: 'unreachable'};
}

/** Evaluate explicit units. Duplicate unit identities are rejected; colocation is permitted. */
export function evaluatePlacement(dataset: Dataset, matrix: MatrixSnapshot, units: FleetUnit[], thresholdMinutes: number, cohort: Cohort, id: PlanResult['id'] = 'proposal'): PlanResult {
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) fail('INVALID_INPUT', 'A positive threshold is required.');
  if (new Set(units.map((unit) => unit.id)).size !== units.length || units.some((unit) => !matrix.siteIds.includes(unit.siteId) || !Array.isArray(unit.capabilities) || typeof unit.available !== 'boolean')) fail('INVALID_INPUT', 'Units need unique identities, valid sites, capabilities and availability.');
  const siteIndexes = new Map(matrix.siteIds.map((siteId, i) => [siteId, i]));
  const zoneIndexes = new Map(matrix.zoneIds.map((zoneId, i) => [zoneId, i]));
  const available = units.filter((unit) => unit.available);
  const compatible = available.filter((unit) => unit.capabilities.includes('generic_assistance'));
  const zones: ZoneCoverage[] = dataset.zones.map((zone) => {
    const candidates = compatible.map((unit) => ({unit, seconds: matrix.durationsSeconds[siteIndexes.get(unit.siteId)!]![zoneIndexes.get(zone.id)!]!}))
      .filter((candidate): candidate is {unit: FleetUnit; seconds: number} => candidate.seconds !== null)
      .sort((a, b) => a.seconds - b.seconds || a.unit.id.localeCompare(b.unit.id));
    const nearest = candidates[0];
    const covered = nearest !== undefined && nearest.seconds <= thresholdMinutes * MINUTE;
    const backupCovered = candidates[1] !== undefined && candidates[1].seconds <= thresholdMinutes * MINUTE;
    return {
      zoneId: zone.id, demand: cohort === 'train' ? zone.trainCount : zone.holdoutCount,
      travelSeconds: nearest?.seconds ?? null, covered, backupCovered,
      reason: covered ? 'covered' : available.length === 0 ? 'no_available_unit' : compatible.length === 0 ? 'incompatible_unit' : nearest === undefined ? 'no_route' : 'over_threshold',
      nearestSiteId: nearest?.unit.siteId ?? null,
    };
  });
  const totalDemand = zones.reduce((sum, zone) => sum + zone.demand, 0);
  const coveredDemand = zones.reduce((sum, zone) => sum + (zone.covered ? zone.demand : 0), 0);
  const backupCoveredDemand = zones.reduce((sum, zone) => sum + (zone.backupCovered ? zone.demand : 0), 0);
  return {
    id, name: id === 'depot' ? 'Single depot' : id === 'spread' ? 'Geographic spread' : 'Optimized standby', cohort,
    siteIds: units.map((unit) => unit.siteId), units,
    coveragePct: totalDemand ? coveredDemand / totalDemand * 100 : 0,
    backupCoveragePct: totalDemand ? backupCoveredDemand / totalDemand * 100 : 0,
    coveredDemand, backupCoveredDemand, totalDemand, uncoveredDemand: totalDemand - coveredDemand,
    unreachableDemand: zones.reduce((sum, zone) => sum + (zone.travelSeconds === null ? zone.demand : 0), 0),
    p50: weightedQuantile(zones, .5), p90: weightedQuantile(zones, .9), zones,
  };
}

function distance(a: StandbySite['position'], b: StandbySite['position']): number {
  return ((a[0] - b[0]) * Math.cos(30.32 * Math.PI / 180)) ** 2 + (a[1] - b[1]) ** 2;
}
function baselineSites(dataset: Dataset, fleetSize: number): {depot: string[]; spread: string[]} {
  const total = dataset.zones.reduce((sum, zone) => sum + zone.trainCount, 0);
  const center: [number, number] = [dataset.zones.reduce((sum, z) => sum + z.position[0] * z.trainCount, 0) / total,
    dataset.zones.reduce((sum, z) => sum + z.position[1] * z.trainCount, 0) / total];
  const sites = [...dataset.sites].sort((a, b) => a.id.localeCompare(b.id));
  const depot = [...sites].sort((a, b) => distance(a.position, center) - distance(b.position, center) || a.id.localeCompare(b.id))[0]!;
  const spread = [depot];
  while (spread.length < Math.min(fleetSize, sites.length)) {
    spread.push(sites.filter((site) => !spread.includes(site)).sort((a, b) =>
      Math.min(...spread.map((s) => distance(b.position, s.position))) - Math.min(...spread.map((s) => distance(a.position, s.position))) || a.id.localeCompare(b.id))[0]!);
  }
  while (spread.length < fleetSize) spread.push(depot);
  return {depot: Array.from({length: fleetSize}, () => depot.id), spread: spread.map((site) => site.id)};
}
function combinations(ids: string[], size: number): string[][] {
  const result: string[][] = [];
  function visit(start: number, chosen: string[]): void {
    if (chosen.length === size) { result.push(chosen); return; }
    for (let i = start; i <= ids.length - (size - chosen.length); i++) visit(i + 1, [...chosen, ids[i]!]);
  }
  visit(0, []);
  return result;
}
function makeUnits(sites: string[], input: EvaluationInput): FleetUnit[] {
  return sites.map((siteId, i) => ({id: `unit-${i + 1}`, siteId, available: input.unavailableUnitId !== `unit-${i + 1}`,
    type: 'service_vehicle', capabilities: ['generic_assistance']}));
}
function objective(plan: PlanResult): [number, number, number] {
  // Infinity is ordered explicitly through unreachable weight, never serialized.
  return [-plan.coveredDemand, plan.unreachableDemand, plan.zones.reduce((sum, z) => sum + (z.travelSeconds ?? 0) * z.demand, 0)];
}
function lexicographicallyLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) { if (a[i]! !== b[i]!) return a[i]! < b[i]!; }
  return false;
}

export function evaluateScenario(dataset: Dataset, matrix: MatrixSnapshot, rawInput: unknown, now: Date = new Date()): EvaluationResult {
  const input = validateEvaluationInput(rawInput);
  validateModel(dataset, matrix, now);
  if (dataset.sites.length < input.fleetSize) fail('INVALID_INPUT', 'The frozen model has fewer sites than this fleet size.');
  const baselines = baselineSites(dataset, input.fleetSize);
  const availableCount = input.fleetSize - (input.unavailableUnitId ? 1 : 0);
  const candidates = combinations([...matrix.siteIds].sort(), availableCount);
  let bestSites: string[] | undefined, bestObjective: number[] | undefined;
  for (const candidate of candidates) {
    let next = 0;
    const siteIds = Array.from({length: input.fleetSize}, (_, i) => input.unavailableUnitId === `unit-${i + 1}` ? baselines.depot[i]! : candidate[next++]!);
    const plan = evaluatePlacement(dataset, matrix, makeUnits(siteIds, input), input.thresholdMinutes, 'train');
    const score = objective(plan);
    // Candidate enumeration already has fixed lexicographic ID order.
    if (bestObjective === undefined || lexicographicallyLess(score, bestObjective)) { bestSites = siteIds; bestObjective = score; }
  }
  if (!bestSites) fail('INVALID_INPUT', 'No feasible finite candidate placement exists.');
  const cohort = input.cohort ?? 'holdout';
  return {
    input, inputHash: hashValue(input), datasetHash: dataset.hash, configHash: dataset.configHash,
    matrix: {id: matrix.id, hash: matrix.hash, provider: matrix.provider, profile: matrix.profile, generatedAt: matrix.generatedAt, expiresAt: matrix.expiresAt},
    generatedAt: now.toISOString(), solver: {version: SOLVER_VERSION, method: 'exhaustive-enumeration', combinations: candidates.length, selectionCohort: 'train'},
    plans: {
      depot: evaluatePlacement(dataset, matrix, makeUnits(baselines.depot, input), input.thresholdMinutes, cohort, 'depot'),
      spread: evaluatePlacement(dataset, matrix, makeUnits(baselines.spread, input), input.thresholdMinutes, cohort, 'spread'),
      proposal: evaluatePlacement(dataset, matrix, makeUnits(bestSites, input), input.thresholdMinutes, cohort, 'proposal'),
    },
    assumptions: [
      'Historical stalled-vehicle report publication counts are demand weights, not a forecast of future breakdowns.',
      'The proposal is best within the frozen candidate sites and primary training objective; the selected evaluation cohort never selects sites.',
      'Units, standby access and generic assistance compatibility are hypothetical. Actual service requirements are absent from the source.',
      'Road times approach each zone representative using one Car snapshot; they are not actual customer waits or achieved SLAs.',
      'Availability is static. Dispatch preparation, job concurrency, queues and service duration are not modelled.',
      'An unavailable unit is excluded and the remaining units are repositioned by a new training-only solve.',
    ],
  };
}
