import type {CapacityCapability} from './capacity.js';
export type Position = [number, number];
export type Cohort = 'train' | 'holdout';
export interface ReportingPeriod { start: string; end: string }
export interface Distribution { hours: number[]; days: number[] }
export interface DemandZone {
  id: string;
  name: string;
  position: Position;
  polygon: Position[];
  trainCount: number;
  holdoutCount: number;
  trainHours: number[];
  holdoutHours: number[];
  trainDays: number[];
  holdoutDays: number[];
  qualityFlags: string[];
}
export interface StandbySite { id: string; name: string; position: Position; assumed: true }
export interface SourceQuality {
  inputRows: Record<Cohort, number>;
  accepted: Record<Cohort, number>;
  excluded: Record<Cohort, Record<string, number>>;
  monthlyReports: Record<string, number>;
  approximationMeters: Record<Cohort, {p50: number; p90: number; max: number}>;
  warnings: string[];
}
export interface Dataset {
  schemaVersion: '1';
  id: string;
  hash: string;
  configHash: string;
  generatedAt: string;
  bounds: [number, number, number, number];
  periods: Record<Cohort, ReportingPeriod>;
  zones: DemandZone[];
  sites: StandbySite[];
  distribution: Record<Cohort, Distribution>;
  quality: SourceQuality;
  source: {url: string; attribution: string; semantics: string; policyUrl: string};
}
export interface MatrixMetadata {
  id: string;
  hash: string;
  provider: 'HERE';
  profile: 'Car';
  generatedAt: string;
  expiresAt: string;
}
/** Private: origin rows, destination columns; null means an explicit NoRoute result. */
export interface MatrixSnapshot extends MatrixMetadata {
  schemaVersion: '1';
  datasetHash: string;
  siteIds: string[];
  zoneIds: string[];
  durationsSeconds: Array<Array<number | null>>;
}
export interface EvaluationInput {
  fleetSize: number;
  thresholdMinutes: number;
  cohort?: Cohort;
  unavailableUnitId?: string;
}
export type TravelQuantile = {status: 'reachable'; seconds: number} | {status: 'unreachable'};
export type UncoveredReason = 'covered' | 'over_threshold' | 'no_route' | 'no_available_unit' | 'incompatible_unit';
export interface ZoneCoverage {
  zoneId: string;
  demand: number;
  travelSeconds: number | null;
  covered: boolean;
  backupCovered: boolean;
  reason: UncoveredReason;
  nearestSiteId: string | null;
}
export interface FleetUnit {
  id: string;
  siteId: string;
  available: boolean;
  type: 'service_vehicle' | 'motorcycle' | 'tow_platform';
  capabilities: string[];
}
export interface PlanResult {
  id: 'depot' | 'spread' | 'proposal';
  name: string;
  cohort: Cohort;
  siteIds: string[];
  units: FleetUnit[];
  coveragePct: number;
  backupCoveragePct: number;
  coveredDemand: number;
  backupCoveredDemand: number;
  totalDemand: number;
  uncoveredDemand: number;
  unreachableDemand: number;
  p50: TravelQuantile;
  p90: TravelQuantile;
  zones: ZoneCoverage[];
}
export interface EvaluationResult {
  input: EvaluationInput;
  inputHash: string;
  datasetHash: string;
  configHash: string;
  matrix: MatrixMetadata;
  generatedAt: string;
  solver: {version: string; method: 'exhaustive-enumeration'; combinations: number; selectionCohort: 'train'};
  plans: {depot: PlanResult; spread: PlanResult; proposal: PlanResult};
  assumptions: string[];
}
export interface PublicManifest {
  dataset: Omit<Dataset, 'zones'>;
  matrix: MatrixMetadata | null;
  release: string;
  capabilities?: {capacity?: CapacityCapability};
  limits: {maxFleetSize: number; minThresholdMinutes: number; maxThresholdMinutes: number; zoneCount: number; siteCount: number};
}
export interface ApiFailure { code: string; message: string; requestId: string; retryable: boolean }
