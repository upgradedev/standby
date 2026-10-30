import type { Dataset, DemandZone, EvaluationInput, EvaluationResult, MatrixMetadata, PlanResult, TravelQuantile } from '../../../../packages/contracts/src/index';
import type {CapacityCapability} from '../../../../packages/contracts/src/capacity';
export type { Dataset, DemandZone, EvaluationInput, EvaluationResult, MatrixMetadata, PlanResult, TravelQuantile };
export interface Config { apiBase: string; mapStyleUrl?: string; mapApiKey?: string; release?: string; auth?: {domain: string; clientId: string; issuer?: string; redirectUri?: string} }
export interface Manifest { dataset: Omit<Dataset, 'zones'>; matrix: MatrixMetadata | null; release: string; capabilities?:{capacity?:CapacityCapability}; limits: {maxFleetSize: number; minThresholdMinutes: number; maxThresholdMinutes: number} }
export type PlanKey = 'depot' | 'spread' | 'proposal';
export interface Preferences { version: 1; collapsed: boolean; shortcuts: boolean; pageSize: number; timezone: 'America/Chicago' | 'UTC'; distanceUnit: 'km' | 'mi'; layer: 'coverage' | 'demand' | 'difference' }
export interface LocalScenario { id: string; name: string; input: EvaluationInput; updatedAt: string; evaluationStatus: 'NOT_RUN'|'SUCCEEDED'|'FAILED'; reviewStatus: 'NOT_READY'|'NEEDS_REVIEW'|'REVIEWED'; inputHash?: string; error?: string }
export interface Membership { id: string; name: string; role: 'Analyst'|'Planner'|'Admin' }
export interface SavedPlan { id: string; workspaceId: string; name: string; input: EvaluationInput; version: number; evaluationStatus: LocalScenario['evaluationStatus']; reviewStatus: LocalScenario['reviewStatus']; inputHash?: string; resultHash?: string; updatedAt?: string; result?: EvaluationResult; failure?: {code:string;message:string;requestId:string}; error?: string }
export interface WorkspaceSettings { version: number; defaultThresholdMinutes: number; maxFleetSize: number; enabledSiteIds: string[] }
