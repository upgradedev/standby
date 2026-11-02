import assert from 'node:assert/strict';
import test from 'node:test';
import {createDefaultCapacityInput, type CapacityMetrics, type CapacityPolicy, type CapacityReplay, type CapacityReplayJob} from '../../../../packages/contracts/src/capacity';
import {jobPhase, replaySnapshot, replayTimeBins} from './capacityReplay';

function job(changes: Partial<CapacityReplayJob> = {}): CapacityReplayJob {
  return {id: 'job-001', type: 'battery', zoneId: 'zone-a', arrivalMinutes: 5, serviceQuantile: .5,
    status: 'completed', reason: null, unitId: 'unit-1', assignedAtMinutes: 10, departAtMinutes: 12, arrivedAtMinutes: 16,
    completedAtMinutes: 31, availableAgainMinutes: 40, queueMinutes: 5, prepMinutes: 2, travelMinutes: 4,
    onSiteMinutes: 10, transportMinutes: 3, dropoffMinutes: 2, recoveryMinutes: 9, onTime: true, censoredAtHorizon: false, ...changes};
}
function scenario(jobs: CapacityReplayJob[] = []) {
  const input = createDefaultCapacityInput(['site-a']);input.horizonMinutes = 60;input.arrivalWeights = [1];input.jobCount = jobs.length;
  const policy: CapacityPolicy = {units: [{id: 'unit-1', kind: 'service_van', siteId: 'site-a', capabilities: ['battery', 'tyre'], available: true, shiftStartMinutes: 0, shiftEndMinutes: 60}]};
  input.baseline = policy;input.candidate = structuredClone(policy);
  // These tests read the replay's timestamps, not its already-computed metric summaries.
  const replay: CapacityReplay = {replication: 0, jobs, events: [], units: [], metrics: {} as CapacityMetrics};
  return {input, policy, replay};
}

test('job stages follow recorded timestamps, with recovery separate from job completion', () => {
  const row = job();
  assert.deepEqual([4,5,10,12,16,26,29,31,39].map(at => jobPhase(row, at, 60)),
    ['not_arrived','queued','preparing','traveling','on_site','transport','dropoff','completed','completed']);
  const {input, policy, replay} = scenario([row]);
  const recovering = replaySnapshot(replay, input, policy, 35);
  assert.equal(recovering.phases.completed, 1);assert.equal(recovering.busyUnits, 1);assert.equal(recovering.availableUnits, 0);
  const released = replaySnapshot(replay, input, policy, 40);
  assert.equal(released.phases.completed, 1);assert.equal(released.busyUnits, 0);assert.equal(released.availableUnits, 1);
});

test('impossible jobs are unserved on arrival while horizon-censored queue remains waiting until H', () => {
  const censored = job({unitId: null, assignedAtMinutes: null, reason: 'horizon_queue', status: 'unserved', censoredAtHorizon: true});
  const impossible = {...censored, reason: 'no_route' as const};
  assert.equal(jobPhase(impossible, 4, 60), 'not_arrived');assert.equal(jobPhase(impossible, 5, 60), 'unserved');
  assert.equal(jobPhase(censored, 5, 60), 'queued');assert.equal(jobPhase(censored, 59.99, 60), 'queued');assert.equal(jobPhase(censored, 60, 60), 'unserved');
});

test('snapshot preserves job and unit counts across the horizon and overlapping capability labels', () => {
  const waiting = job({id: 'job-002', arrivalMinutes: 20, unitId: null, assignedAtMinutes: null, reason: 'horizon_queue', status: 'unserved', censoredAtHorizon: true});
  const {input, policy, replay} = scenario([job(), waiting]);
  policy.units.push({...policy.units[0], id: 'unit-2', capabilities: ['collision'], shiftStartMinutes: 10, shiftEndMinutes: 20});
  policy.units.push({...policy.units[0], id: 'unit-3', available: false});
  for (const at of [0,5,10,19,20,35,40,59.99,60]) {
    const state = replaySnapshot(replay, input, policy, at);
    assert.equal(Object.values(state.phases).reduce((sum,n) => sum+n, 0), 2);
    assert.equal(state.availableUnits+state.busyUnits+state.offShiftUnits+state.unavailableUnits, 3);
  }
  const afterRecovery = replaySnapshot(replay, input, policy, 45);
  assert.equal(afterRecovery.availableUnits, 1);assert.deepEqual(afterRecovery.availableByType, {battery:1,tyre:1,breakdown:0,collision:0});
  const end = replaySnapshot(replay, input, policy, 60);
  assert.equal(end.phases.completed, 1);assert.equal(end.phases.unserved, 1);assert.equal(end.offShiftUnits, 2);assert.equal(end.unavailableUnits, 1);
});

test('zero-duration records are completed and released at the same instant without a phantom queue', () => {
  const {input, policy, replay} = scenario([job({arrivalMinutes:0,assignedAtMinutes:0,departAtMinutes:0,arrivedAtMinutes:0,completedAtMinutes:0,availableAgainMinutes:0,onSiteMinutes:0,transportMinutes:0,dropoffMinutes:0})]);
  const atZero = replaySnapshot(replay, input, policy, 0);
  assert.equal(atZero.phases.completed, 1);assert.equal(atZero.phases.queued, 0);assert.equal(atZero.busyUnits, 0);assert.equal(atZero.availableUnits, 1);
});

test('interval extrema inspect exact recorded events and exclude the final H boundary', () => {
  const queued = job({arrivalMinutes:1,assignedAtMinutes:5,departAtMinutes:5,arrivedAtMinutes:5,completedAtMinutes:5,availableAgainMinutes:5,onSiteMinutes:0,transportMinutes:0,dropoffMinutes:0});
  const {input, policy, replay} = scenario([queued]);
  replay.events = [{atMinutes:1,sequence:0,type:'queued',jobId:queued.id},{atMinutes:5,sequence:1,type:'assigned',jobId:queued.id},{atMinutes:60,sequence:2,type:'horizon'}];
  const bin = replayTimeBins(replay,input,policy)[0];assert.equal(bin.peakQueue,1);assert.equal(bin.peakAtMinutes,1);
  const empty = scenario();empty.replay.events = [{atMinutes:0,sequence:0,type:'available',unitId:'unit-1'},{atMinutes:60,sequence:1,type:'off_shift',unitId:'unit-1'}];
  assert.equal(replayTimeBins(empty.replay,empty.input,empty.policy)[0].minimumIdle.battery,1);
  assert.equal(replaySnapshot(empty.replay,empty.input,empty.policy,60).availableByType.battery,0);
});
