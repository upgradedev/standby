import {CAPACITY_LIMITS, type CapacityReplayJob, type CapacityUnit, type CapacityUnitKind} from '../../../../packages/contracts/src/capacity';
import {jobPhase, type JobPhase} from './capacityReplay';

export type CapacityCyclePhase = 'queued' | 'preparing' | 'approaching' | 'on_site' | 'handling_loading' | 'transporting' | 'unloading' | 'recovering';
export type CapacityUnitPhase = Exclude<CapacityCyclePhase, 'queued'> | 'not_assigned' | 'available' | 'off_shift' | 'unavailable' | 'unknown';
export const CAPACITY_UNIT_PHASE_LABELS: Record<CapacityCyclePhase | CapacityUnitPhase, string> = {
  queued: 'Queued', preparing: 'Preparing', approaching: 'Approaching incident', on_site: 'On-site service',
  handling_loading: 'On-site handling / loading allowance', transporting: 'Transport allowance',
  unloading: 'Drop-off / unloading allowance', recovering: 'Recovery / turnaround',
  not_assigned: 'Unassigned at cursor', available: 'Available', off_shift: 'Off shift', unavailable: 'Scenario unavailable', unknown: 'Unknown',
};
export interface CapacityJobStage {
  phase: CapacityCyclePhase;
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** Modeled carried vehicles. Loading's exact physical load instant is unknown. */
  payloadCount: 0 | 1 | null;
}
export interface CapacityUnitSnapshot {
  phase: CapacityUnitPhase;
  label: string;
  activeJobId: string | null;
  servingSelectedJob: boolean;
  busy: boolean | null;
  payloadCount: 0 | 1 | null;
  /** Assumed one-car flatbed occupancy, never measured equipment specifications. */
  payloadCapacity: 1 | null;
  selectedJobPhase: JobPhase | 'unknown';
  actualGps: 'unknown';
  workshopDestination: 'unknown';
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const kinds: readonly CapacityUnitKind[] = ['motorcycle', 'service_van', 'flatbed'];

/** Recorded, half-open intervals for one job; durations are allowances, not routed towing legs. */
export function capacityJobStages(job: CapacityReplayJob, unitKind: CapacityUnitKind | null): CapacityJobStage[] | null {
  if (!finite(job.arrivalMinutes)) return null;
  if (job.assignedAtMinutes === null) return job.unitId === null ? [] : null;
  if (!unitKind || !kinds.includes(unitKind) || !job.unitId) return null;
  const values = [job.assignedAtMinutes, job.departAtMinutes, job.arrivedAtMinutes, job.completedAtMinutes,
    job.availableAgainMinutes, job.onSiteMinutes, job.transportMinutes, job.dropoffMinutes, job.recoveryMinutes];
  if (!values.every(finite)) return null;
  const [assigned, departed, arrived, completed, released, onSite, transport, dropoff, recovery] = values as number[];
  const onSiteEnd = arrived! + onSite!, transportEnd = onSiteEnd + transport!;
  if (![onSiteEnd, transportEnd, transportEnd + dropoff!, completed! + recovery!].every(finite)
    || assigned! < job.arrivalMinutes || departed! < assigned! || arrived! < departed!
    || completed !== transportEnd + dropoff! || released !== completed! + recovery!
    || unitKind !== 'flatbed' && (transport !== 0 || dropoff !== 0)) return null;
  const flatbed = unitKind === 'flatbed', stages: CapacityJobStage[] = [];
  const add = (phase: CapacityCyclePhase, startMinutes: number, endMinutes: number, payloadCount: 0 | 1 | null) => {
    if (endMinutes > startMinutes) stages.push({phase, label: CAPACITY_UNIT_PHASE_LABELS[phase], startMinutes, endMinutes, payloadCount});
  };
  add('queued', job.arrivalMinutes, assigned!, null);
  add('preparing', assigned!, departed!, flatbed ? 0 : null);
  add('approaching', departed!, arrived!, flatbed ? 0 : null);
  add(flatbed ? 'handling_loading' : 'on_site', arrived!, onSiteEnd, null);
  add('transporting', onSiteEnd, transportEnd, flatbed ? 1 : null);
  add('unloading', transportEnd, completed!, flatbed ? 1 : null);
  add('recovering', completed!, released!, flatbed ? 0 : null);
  return stages;
}

/**
 * `jobs` must be the same policy and recorded replication as selectedJob, never a pooled fleet trace.
 * A completed selected job cannot describe a unit that has already accepted a later job.
 * Pass no unit before the selected assignment; this function also enforces that boundary.
 */
export function capacityUnitPhase(selectedJob: CapacityReplayJob, unit: CapacityUnit | undefined,
  jobs: readonly CapacityReplayJob[], minute: number, horizon: number): CapacityUnitSnapshot {
  const snapshot: CapacityUnitSnapshot = {phase: 'unknown', label: CAPACITY_UNIT_PHASE_LABELS.unknown,
    activeJobId: null, servingSelectedJob: false, busy: null, payloadCount: null, payloadCapacity: null,
    selectedJobPhase: 'unknown', actualGps: 'unknown', workshopDestination: 'unknown'};
  const phase = (value: CapacityUnitPhase): CapacityUnitSnapshot => ({...snapshot, phase: value, label: CAPACITY_UNIT_PHASE_LABELS[value]});
  if (!finite(minute) || !finite(horizon) || horizon === 0 || !finite(selectedJob.arrivalMinutes)) return snapshot;
  snapshot.selectedJobPhase = jobPhase(selectedJob, minute, horizon);
  if (selectedJob.assignedAtMinutes === null || minute < selectedJob.assignedAtMinutes) return phase('not_assigned');
  if (!unit || unit.id !== selectedJob.unitId || !kinds.includes(unit.kind)
    || !finite(unit.shiftStartMinutes) || !finite(unit.shiftEndMinutes) || unit.shiftEndMinutes <= unit.shiftStartMinutes) return snapshot;
  snapshot.payloadCapacity = unit.kind === 'flatbed' ? 1 : null;
  if (!capacityJobStages(selectedJob, unit.kind)) {snapshot.selectedJobPhase = 'unknown'; return snapshot;}
  if (jobs.length > CAPACITY_LIMITS.maxJobs) return snapshot;
  const selectedRows = jobs.filter(job => job.id === selectedJob.id);
  const identityFields = ['unitId', 'arrivalMinutes', 'assignedAtMinutes', 'departAtMinutes', 'arrivedAtMinutes',
    'completedAtMinutes', 'availableAgainMinutes', 'onSiteMinutes', 'transportMinutes', 'dropoffMinutes', 'recoveryMinutes'] as const;
  if (selectedRows.length !== 1 || identityFields.some(key => selectedRows[0]![key] !== selectedJob[key])) return snapshot;
  // The current unit is scoped to its active recorded assignment, not the selected old job.
  const active: CapacityReplayJob[] = [];
  for (const job of jobs) {
    if (job.unitId !== unit.id) continue;
    if (!finite(job.assignedAtMinutes) || !finite(job.availableAgainMinutes)) return snapshot;
    if (job.assignedAtMinutes <= minute && minute < job.availableAgainMinutes) active.push(job);
  }
  if (active.length > 1) return snapshot;
  if (active.length === 1) {
    const current = active[0]!, stages = capacityJobStages(current, unit.kind);
    const stage = stages?.find(value => value.startMinutes <= minute && minute < value.endMinutes && value.phase !== 'queued');
    if (!stage || stage.phase === 'queued') return snapshot;
    return {...snapshot, phase: stage.phase, label: stage.label, activeJobId: current.id,
      servingSelectedJob: current.id === selectedJob.id, busy: true, payloadCount: stage.payloadCount};
  }
  // Missing the selected row would otherwise falsely label its still-occupied unit idle.
  if (selectedJob.availableAgainMinutes === null || minute < selectedJob.availableAgainMinutes) return snapshot;
  snapshot.busy = false;snapshot.payloadCount = unit.kind === 'flatbed' ? 0 : null;
  if (!unit.available) return phase('unavailable');
  return phase(minute < unit.shiftStartMinutes || minute >= unit.shiftEndMinutes ? 'off_shift' : 'available');
}
