import assert from 'node:assert/strict';
import test from 'node:test';
import type {CapacityReplayJob, CapacityUnit} from '../../../../packages/contracts/src/capacity';
import {capacityJobStages, capacityUnitPhase} from './capacityUnitPhase';

function job(changes: Partial<CapacityReplayJob> = {}): CapacityReplayJob {
  return {id: 'tow-a', type: 'collision', zoneId: 'zone-a', arrivalMinutes: 0, serviceQuantile: .5,
    status: 'completed', reason: null, unitId: 'flatbed-1', assignedAtMinutes: 2, departAtMinutes: 5,
    arrivedAtMinutes: 9, completedAtMinutes: 41, availableAgainMinutes: 47,
    queueMinutes: 2, prepMinutes: 3, travelMinutes: 4, onSiteMinutes: 11, transportMinutes: 17,
    dropoffMinutes: 4, recoveryMinutes: 6, onTime: true, censoredAtHorizon: false, ...changes};
}
function unit(changes: Partial<CapacityUnit> = {}): CapacityUnit {
  return {id: 'flatbed-1', kind: 'flatbed', siteId: 'site-a', capabilities: ['collision'], available: true,
    shiftStartMinutes: 0, shiftEndMinutes: 100, ...changes};
}

test('one tow exposes exact half-open allowance intervals and no invented loading instant', () => {
  const selected = job(), vehicle = unit(), stages = capacityJobStages(selected, vehicle.kind)!;
  assert.deepEqual(stages.map(stage => [stage.phase, stage.startMinutes, stage.endMinutes, stage.payloadCount]), [
    ['queued', 0, 2, null], ['preparing', 2, 5, 0], ['approaching', 5, 9, 0], ['handling_loading', 9, 20, null],
    ['transporting', 20, 37, 1], ['unloading', 37, 41, 1], ['recovering', 41, 47, 0],
  ]);
  assert.deepEqual([2, 5, 9, 20, 37, 41, 47].map(at => capacityUnitPhase(selected, vehicle, [selected], at, 100).phase),
    ['preparing', 'approaching', 'handling_loading', 'transporting', 'unloading', 'recovering', 'available']);
  assert.equal(capacityUnitPhase(selected, vehicle, [selected], 40.999, 100).payloadCount, 1);
  const recovery = capacityUnitPhase(selected, vehicle, [selected], 41, 100);
  assert.equal(recovery.selectedJobPhase, 'completed'); assert.equal(recovery.busy, true); assert.equal(recovery.payloadCount, 0);
  assert.equal(recovery.actualGps, 'unknown'); assert.equal(recovery.workshopDestination, 'unknown');
});

test('the future assigned unit stays undisclosed before the assignment cursor', () => {
  const selected = job();
  for (const vehicle of [undefined, unit()]) {
    const before = capacityUnitPhase(selected, vehicle, [selected], 1, 100);
    assert.equal(before.phase, 'not_assigned'); assert.equal(before.selectedJobPhase, 'queued');
    assert.equal(before.activeJobId, null); assert.equal(before.busy, null); assert.equal(before.payloadCapacity, null);
  }
});

test('a completed selected job does not mislabel its unit while that unit serves a later job', () => {
  const selected = job(), next = job({id: 'tow-b', arrivalMinutes: 10, assignedAtMinutes: 47, departAtMinutes: 50,
    arrivedAtMinutes: 54, completedAtMinutes: 86, availableAgainMinutes: 92, queueMinutes: 37});
  const current = capacityUnitPhase(selected, unit(), [selected, next], 65, 100);
  assert.equal(current.phase, 'transporting'); assert.equal(current.payloadCount, 1); assert.equal(current.busy, true);
  assert.equal(current.activeJobId, 'tow-b'); assert.equal(current.servingSelectedJob, false); assert.equal(current.selectedJobPhase, 'completed');
  const handoff = capacityUnitPhase(selected, unit(), [selected, next], 47, 100);
  assert.equal(handoff.phase, 'preparing'); assert.equal(handoff.activeJobId, 'tow-b'); assert.equal(handoff.payloadCount, 0);
});

test('accepted towing remains busy after horizon or shift end until the recorded release', () => {
  const selected = job({assignedAtMinutes: 0, departAtMinutes: 2, arrivedAtMinutes: 3,
    onSiteMinutes: 10, transportMinutes: 20, dropoffMinutes: 7, completedAtMinutes: 40,
    recoveryMinutes: 5, availableAgainMinutes: 45, queueMinutes: 0, prepMinutes: 2, travelMinutes: 1,
    status: 'in_progress', censoredAtHorizon: true});
  const vehicle = unit({shiftEndMinutes: 30});
  assert.equal(capacityUnitPhase(selected, vehicle, [selected], 30, 30).phase, 'transporting');
  const afterDropoff = capacityUnitPhase(selected, vehicle, [selected], 40, 30);
  assert.equal(afterDropoff.phase, 'recovering'); assert.equal(afterDropoff.busy, true); assert.equal(afterDropoff.payloadCount, 0);
  assert.equal(capacityUnitPhase(selected, vehicle, [selected], 45, 30).phase, 'off_shift');
});

test('zero-duration flatbed service creates no phantom loaded interval at a same-time handoff', () => {
  const selected = job({type: 'battery', assignedAtMinutes: 0, departAtMinutes: 0, arrivedAtMinutes: 0,
    completedAtMinutes: 0, availableAgainMinutes: 0, queueMinutes: 0, prepMinutes: 0, travelMinutes: 0,
    onSiteMinutes: 0, transportMinutes: 0, dropoffMinutes: 0, recoveryMinutes: 0});
  const next = job({id: 'battery-b', type: 'battery', assignedAtMinutes: 0, departAtMinutes: 2, arrivedAtMinutes: 3,
    completedAtMinutes: 4, availableAgainMinutes: 5, queueMinutes: 0, prepMinutes: 2, travelMinutes: 1,
    onSiteMinutes: 1, transportMinutes: 0, dropoffMinutes: 0, recoveryMinutes: 1});
  assert.deepEqual(capacityJobStages(selected, 'flatbed'), []);
  const nextStages = capacityJobStages(next, 'flatbed')!;
  assert.ok(nextStages.every(stage => stage.endMinutes > stage.startMinutes && stage.payloadCount !== 1));
  const atHandoff = capacityUnitPhase(selected, unit(), [selected, next], 0, 100);
  assert.equal(atHandoff.selectedJobPhase, 'completed'); assert.equal(atHandoff.phase, 'preparing');
  assert.equal(atHandoff.activeJobId, next.id); assert.equal(atHandoff.payloadCount, 0); assert.equal(atHandoff.busy, true);
});

test('non-flatbed on-site work has no modeled carried-car payload', () => {
  const selected = job({transportMinutes: 0, dropoffMinutes: 0, completedAtMinutes: 20, availableAgainMinutes: 26});
  const current = capacityUnitPhase(selected, unit({kind: 'service_van'}), [selected], 9, 100);
  assert.equal(current.phase, 'on_site'); assert.equal(current.payloadCount, null); assert.equal(current.payloadCapacity, null);
});

test('missing, contradictory or pooled timing facts fail closed instead of reporting idle availability', () => {
  const selected = job(), broken = job({completedAtMinutes: null});
  assert.equal(capacityJobStages(broken, 'flatbed'), null);
  assert.equal(capacityUnitPhase(broken, unit(), [broken], 21, 100).phase, 'unknown');
  assert.equal(capacityUnitPhase(selected, undefined, [selected], 21, 100).phase, 'unknown');
  assert.equal(capacityUnitPhase(selected, unit(), [], 50, 100).phase, 'unknown');
  assert.equal(capacityUnitPhase(selected, unit(), [selected, {...selected}], 21, 100).phase, 'unknown');
  const overlap = job({id: 'overlap', assignedAtMinutes: 3});
  assert.equal(capacityUnitPhase(selected, unit(), [selected, overlap], 21, 100).busy, null);
  assert.equal(capacityUnitPhase(selected, unit(), [selected], NaN, 100).phase, 'unknown');
});
