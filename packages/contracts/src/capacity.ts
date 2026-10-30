import type {MatrixMetadata} from './index.js';

export const CAPACITY_MODEL_VERSION = 'fixed-home-capacity-v1';
export const CAPACITY_LIMITS = {maxUnits: 12, maxJobs: 200, maxHorizonMinutes: 1440, maxReplications: 20} as const;
export const CAPACITY_JOB_TYPES = ['battery', 'tyre', 'breakdown', 'collision'] as const;
export type CapacityJobType = typeof CAPACITY_JOB_TYPES[number];
export type CapacityUnitKind = 'motorcycle' | 'service_van' | 'flatbed';
export interface CapacityTriangle {min: number; mode: number; max: number}
export interface CapacityTypeProfile {
  share: number;
  onSiteMinutes: CapacityTriangle;
  /** Assumed additional occupancy, applied only when a flatbed serves this type. */
  flatbedTransportMinutes: number;
  flatbedDropoffMinutes: number;
}
export interface CapacityUnit {
  id: string;
  kind: CapacityUnitKind;
  siteId: string;
  capabilities: CapacityJobType[];
  available: boolean;
  shiftStartMinutes: number;
  shiftEndMinutes: number;
}
export interface CapacityPolicy {units: CapacityUnit[]}
export interface CapacityInput {
  schemaVersion: '1';
  seed: number;
  horizonMinutes: number;
  replications: number;
  jobCount: number;
  responseTargetMinutes: number;
  /** Relative assumed hourly intensity. Last partial hour is weighted by its length. */
  arrivalWeights: number[];
  dispatchPrepMinutes: number;
  recoveryMinutes: number;
  travelMultiplier: number;
  typeProfiles: Record<CapacityJobType, CapacityTypeProfile>;
  baseline: CapacityPolicy;
  candidate: CapacityPolicy;
}
export type CapacityUnservedReason = 'no_compatible_unit' | 'no_route' | 'units_unavailable' | 'no_shift_capacity' | 'horizon_queue';
export type CapacityEventType = 'queued' | 'assigned' | 'travel_started' | 'arrived' | 'service_completed' | 'available' | 'off_shift' | 'shift_ended' | 'unserved' | 'horizon';
export interface CapacityTimelineEvent {
  atMinutes: number;
  sequence: number;
  type: CapacityEventType;
  jobId?: string;
  unitId?: string;
  reason?: CapacityUnservedReason | 'scenario_unavailable';
}
export interface CapacityReplayJob {
  id: string;
  type: CapacityJobType;
  zoneId: string;
  arrivalMinutes: number;
  serviceQuantile: number;
  /** Status at the planning horizon; accepted work is allowed to finish afterwards. */
  status: 'completed' | 'in_progress' | 'unserved';
  reason: CapacityUnservedReason | null;
  unitId: string | null;
  assignedAtMinutes: number | null;
  departAtMinutes: number | null;
  arrivedAtMinutes: number | null;
  completedAtMinutes: number | null;
  availableAgainMinutes: number | null;
  queueMinutes: number | null;
  prepMinutes: number | null;
  travelMinutes: number | null;
  onSiteMinutes: number | null;
  transportMinutes: number | null;
  dropoffMinutes: number | null;
  recoveryMinutes: number | null;
  /** Null means no observed response by the planning horizon. */
  onTime: boolean | null;
  censoredAtHorizon: boolean;
}
export interface CapacityUnitMetrics {
  unitId: string;
  assignedJobs: number;
  busyMinutes: number;
  busyWithinHorizonMinutes: number;
  overtimeMinutes: number;
  shiftMinutes: number;
  utilization: number;
}
export interface CapacityMetrics {
  totalArrivals: number;
  started: number;
  arrived: number;
  completed: number;
  inProgress: number;
  unserved: number;
  onTime: number;
  /** All arrivals, including unserved and horizon-censored jobs, are the denominator. */
  onTimePct: number | null;
  responseSampleSize: number;
  /** Queue is observed for every assigned job, including responses after the horizon. */
  queueSampleSize: number;
  p50ResponseMinutes: number | null;
  p90ResponseMinutes: number | null;
  p50QueueMinutes: number | null;
  p90QueueMinutes: number | null;
  meanResponseMinutes: number | null;
  meanQueueMinutes: number | null;
  meanPrepMinutes: number | null;
  meanTravelMinutes: number | null;
  maxQueue: number;
  totalBusyMinutes: number;
  busyWithinHorizonMinutes: number;
  totalOvertimeMinutes: number;
}
export interface CapacityRange {mean: number; min: number; max: number; n: number}
/** Observed replication range, never a confidence interval. Null metrics have no observations. */
export type CapacityAggregateMetrics = {[K in keyof CapacityMetrics]: CapacityRange | null};
export interface CapacityReplay {
  replication: 0;
  metrics: CapacityMetrics;
  jobs: CapacityReplayJob[];
  events: CapacityTimelineEvent[];
  units: CapacityUnitMetrics[];
}
export interface CapacityPolicyResult {
  aggregate: CapacityAggregateMetrics;
  replay: CapacityReplay;
}
export interface CapacityComparisonResult {
  schemaVersion: '1';
  modelVersion: typeof CAPACITY_MODEL_VERSION;
  generatedAt: string;
  input: CapacityInput;
  inputHash: string;
  datasetHash: string;
  configHash: string;
  matrix: MatrixMetadata;
  modelHash: string;
  pairedSamplesHash: string;
  replications: number;
  assumptions: string[];
  baseline: CapacityPolicyResult;
  candidate: CapacityPolicyResult;
  /** Paired candidate minus baseline per replication; smaller waits/unserved is better. */
  delta: CapacityAggregateMetrics;
}

/** Browser-safe editable illustration defaults, not measured roadside parameters. */
export function createDefaultCapacityInput(siteIds: readonly string[]): CapacityInput {
  if (!siteIds.length) throw new Error('At least one existing candidate site is required.');
  const units: CapacityUnit[] = [
    {id: 'unit-1', kind: 'motorcycle', siteId: siteIds[0]!, capabilities: ['battery', 'tyre'], available: true, shiftStartMinutes: 0, shiftEndMinutes: 480},
    {id: 'unit-2', kind: 'service_van', siteId: siteIds[1] ?? siteIds[0]!, capabilities: ['battery', 'tyre', 'breakdown'], available: true, shiftStartMinutes: 0, shiftEndMinutes: 480},
    {id: 'unit-3', kind: 'flatbed', siteId: siteIds[2] ?? siteIds[0]!, capabilities: ['breakdown', 'collision'], available: true, shiftStartMinutes: 0, shiftEndMinutes: 480},
  ];
  return {
    schemaVersion: '1', seed: 42, horizonMinutes: 480, replications: 10, jobCount: 24,
    responseTargetMinutes: 30, arrivalWeights: Array<number>(8).fill(1),
    dispatchPrepMinutes: 3, recoveryMinutes: 15, travelMultiplier: 1,
    typeProfiles: {
      battery: {share: .35, onSiteMinutes: {min: 10, mode: 20, max: 40}, flatbedTransportMinutes: 0, flatbedDropoffMinutes: 0},
      tyre: {share: .25, onSiteMinutes: {min: 15, mode: 30, max: 60}, flatbedTransportMinutes: 0, flatbedDropoffMinutes: 0},
      breakdown: {share: .30, onSiteMinutes: {min: 20, mode: 45, max: 90}, flatbedTransportMinutes: 20, flatbedDropoffMinutes: 10},
      collision: {share: .10, onSiteMinutes: {min: 30, mode: 60, max: 120}, flatbedTransportMinutes: 30, flatbedDropoffMinutes: 15},
    },
    baseline: {units}, candidate: {units: units.map(unit => ({...unit, capabilities: [...unit.capabilities]}))},
  };
}
