import {CAPACITY_JOB_TYPES, type CapacityInput, type CapacityJobType, type CapacityPolicy, type CapacityReplay, type CapacityReplayJob} from '../../../../packages/contracts/src/capacity';

export type JobPhase = 'not_arrived' | 'queued' | 'preparing' | 'traveling' | 'on_site' | 'transport' | 'dropoff' | 'completed' | 'unserved';
export const JOB_PHASE_LABELS: Record<JobPhase, string> = {
  not_arrived: 'Not arrived', queued: 'Queued', preparing: 'Preparing', traveling: 'Traveling',
  on_site: 'On site', transport: 'Transport', dropoff: 'Drop-off', completed: 'Completed', unserved: 'Unserved',
};
export const REPLAY_JOB_PHASES: readonly JobPhase[] = ['not_arrived', 'queued', 'preparing', 'traveling', 'on_site', 'transport', 'dropoff', 'completed', 'unserved'];
const TYPES = CAPACITY_JOB_TYPES;
const clock = (minute: number) => Number.isFinite(minute) ? Math.max(0, minute) : 0;

/** Read the recorded cycle; never sample or simulate another dispatch in the browser. */
export function jobPhase(job: CapacityReplayJob, minute: number, horizon: number): JobPhase {
  const at = clock(minute);
  if (at < job.arrivalMinutes) return 'not_arrived';
  if (job.assignedAtMinutes === null) {
    const impossible = job.reason !== null && job.reason !== 'horizon_queue';
    return impossible || at >= horizon ? 'unserved' : 'queued';
  }
  if (at < job.assignedAtMinutes) return 'queued';
  // Job completion and unit availability are deliberately different events.
  if (job.completedAtMinutes !== null && at >= job.completedAtMinutes) return 'completed';
  if (job.departAtMinutes === null || at < job.departAtMinutes) return 'preparing';
  if (job.arrivedAtMinutes === null || at < job.arrivedAtMinutes) return 'traveling';
  const onsiteEnd = job.arrivedAtMinutes + (job.onSiteMinutes ?? 0);
  if (at < onsiteEnd) return 'on_site';
  if (at < onsiteEnd + (job.transportMinutes ?? 0)) return 'transport';
  return 'dropoff';
}

export interface ReplaySnapshot {
  phases: Record<JobPhase, number>;
  availableUnits: number;
  busyUnits: number;
  offShiftUnits: number;
  unavailableUnits: number;
  /** One unit can contribute to several types; these counts must not be added. */
  availableByType: Record<CapacityJobType, number>;
}

export function replaySnapshot(replay: CapacityReplay, input: CapacityInput, policy: CapacityPolicy, minute: number): ReplaySnapshot {
  const at = Math.min(input.horizonMinutes, clock(minute));
  const phases = Object.fromEntries(REPLAY_JOB_PHASES.map(phase => [phase, 0])) as Record<JobPhase, number>;
  for (const job of replay.jobs) phases[jobPhase(job, at, input.horizonMinutes)]++;
  const snapshot: ReplaySnapshot = {phases, availableUnits: 0, busyUnits: 0, offShiftUnits: 0, unavailableUnits: 0,
    availableByType: {battery: 0, tyre: 0, breakdown: 0, collision: 0}};
  for (const unit of policy.units) {
    const busy = replay.jobs.some(job => job.unitId === unit.id && job.assignedAtMinutes !== null && job.availableAgainMinutes !== null &&
      job.assignedAtMinutes <= at && at < job.availableAgainMinutes);
    if (busy) snapshot.busyUnits++;
    else if (!unit.available) snapshot.unavailableUnits++;
    else if (at < unit.shiftStartMinutes || at >= unit.shiftEndMinutes) snapshot.offShiftUnits++;
    else {
      snapshot.availableUnits++;
      for (const type of TYPES) if (unit.capabilities.includes(type)) snapshot.availableByType[type]++;
    }
  }
  return snapshot;
}

export interface ReplayTimeBin {
  startMinutes: number;
  endMinutes: number;
  peakQueue: number;
  peakAtMinutes: number;
  minimumIdle: Record<CapacityJobType, number>;
}

/** Exact event/boundary observations within each half-open interval, not an arrival forecast. */
export function replayTimeBins(replay: CapacityReplay, input: CapacityInput, policy: CapacityPolicy): ReplayTimeBin[] {
  const events = [...new Set(replay.events.map(event => event.atMinutes))].filter(at => at >= 0 && at < input.horizonMinutes).sort((a,b) => a-b);
  return Array.from({length: Math.ceil(input.horizonMinutes / 60)}, (_, index) => {
    const startMinutes = index * 60, endMinutes = Math.min(input.horizonMinutes, startMinutes + 60);
    const times = [startMinutes, ...events.filter(at => at > startMinutes && at < endMinutes)];
    let peakQueue = -1, peakAtMinutes = startMinutes;
    const minimumIdle = {battery: Infinity, tyre: Infinity, breakdown: Infinity, collision: Infinity};
    for (const at of times) {
      const snapshot = replaySnapshot(replay, input, policy, at);
      if (snapshot.phases.queued > peakQueue) {peakQueue = snapshot.phases.queued; peakAtMinutes = at;}
      for (const type of TYPES) minimumIdle[type] = Math.min(minimumIdle[type], snapshot.availableByType[type]);
    }
    return {startMinutes, endMinutes, peakQueue, peakAtMinutes, minimumIdle};
  });
}
