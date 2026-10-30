import type { TravelQuantile } from './types';
export const integer = (value: number) => new Intl.NumberFormat('en-US').format(value);
export const percent = (value: number) => `${value.toFixed(1)}%`;
export const minutes = (value: number | null | undefined) => value == null ? 'Unreachable' : `${(value / 60).toFixed(1)} min`;
export const quantile = (value: TravelQuantile | undefined) => value ? value.status === 'reachable' ? minutes(value.seconds) : 'Unreachable' : 'Not evaluated';
export const shortHash = (value?: string) => value ? value.slice(0, 12) : 'Unavailable';
export const timestamp = (value: string, timeZone = 'America/Chicago') => new Intl.DateTimeFormat('en-US', {dateStyle:'medium', timeStyle:'short', timeZone}).format(new Date(value));
export const inputKey = (input: {fleetSize:number; thresholdMinutes:number; cohort?:string; unavailableUnitId?:string}) => JSON.stringify([input.fleetSize,input.thresholdMinutes,input.cohort ?? 'holdout',input.unavailableUnitId ?? '']);
