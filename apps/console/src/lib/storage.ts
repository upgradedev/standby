import type { LocalScenario, Preferences } from './types';
export const defaults: Preferences = {version:1, collapsed:false, pageSize:10, timezone:'America/Chicago', distanceUnit:'mi', layer:'coverage'};
const PREFS = 'standby.preferences.v1';
const SCENARIOS = 'standby.scenarios.v1';
export function readPreferences(): Preferences {
  try { const value = JSON.parse(localStorage.getItem(PREFS) ?? 'null');
    if (!value || value.version !== 1) return defaults;
    return {version:1, collapsed: value.collapsed === true, pageSize:[10,20,50].includes(value.pageSize) ? value.pageSize : 10, timezone:value.timezone === 'UTC' ? 'UTC' : 'America/Chicago', distanceUnit:value.distanceUnit === 'km' ? 'km' : 'mi', layer:['coverage','demand','difference'].includes(value.layer) ? value.layer : 'coverage'};
  } catch { return defaults; }
}
export function savePreferences(value: Preferences) { localStorage.setItem(PREFS, JSON.stringify(value)); }
export function readScenarios(): LocalScenario[] {
  try { const data = JSON.parse(localStorage.getItem(SCENARIOS) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(s => typeof s.id === 'string' && typeof s.name === 'string' && s.input && Number.isInteger(s.input.fleetSize) && s.input.fleetSize >= 1 && s.input.fleetSize <= 4 && Number.isInteger(s.input.thresholdMinutes) && s.input.thresholdMinutes >= 5 && s.input.thresholdMinutes <= 30).slice(0,50).map(s => ({id:s.id,name:s.name.slice(0,100),input:{fleetSize:s.input.fleetSize,thresholdMinutes:s.input.thresholdMinutes,cohort:s.input.cohort === 'train' ? 'train' : 'holdout',...(typeof s.input.unavailableUnitId === 'string' ? {unavailableUnitId:s.input.unavailableUnitId} : {})},updatedAt:s.updatedAt,evaluationStatus:'NOT_RUN',reviewStatus:'NOT_READY'}));
  } catch { return []; }
}
export function saveScenarios(value: LocalScenario[]) {
  // Only our inputs and references persist. Provider travel times/results stay in memory.
  localStorage.setItem(SCENARIOS,JSON.stringify(value.map(s => ({id:s.id,name:s.name,input:s.input,updatedAt:s.updatedAt,inputHash:s.inputHash}))));
}
