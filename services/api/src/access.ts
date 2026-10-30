import {HttpError} from './common';

export type Role = 'Analyst' | 'Planner' | 'Admin';
export interface Identity {subject:string; groups:Role[]; username:string}
export interface Membership {workspaceId:string; name:string; role:Role}
const ranks:Record<Role,number> = {Analyst:1,Planner:2,Admin:3};
const roles:Role[] = ['Analyst','Planner','Admin'];

/** Claims arrive only from API Gateway's verified JWT authorizer, never from request bodies. */
export function identityFromClaims(claims:Record<string,unknown>|undefined):Identity {
  if(!claims || claims.token_use!=='access' || typeof claims.sub!=='string' || !claims.sub) {
    throw new HttpError(401,'UNAUTHENTICATED','Sign in with an access token to use a workspace.');
  }
  const scope=typeof claims.scope==='string'?claims.scope.split(/\s+/):[];
  if(!scope.includes('standby/access')) throw new HttpError(403,'FORBIDDEN','The required workspace scope is missing.');
  const raw=claims['cognito:groups'];
  let groups:unknown[]=[];
  if(Array.isArray(raw)) groups=raw;
  else if(typeof raw==='string') {
    try {const parsed:unknown=JSON.parse(raw); if(Array.isArray(parsed)) groups=parsed;}
    catch {/* API Gateway also renders Cognito groups as bracketed, comma-separated strings. */}
    if(!groups.length) {
      const rendered=raw.startsWith('[')&&raw.endsWith(']')?raw.slice(1,-1):raw;
      groups=rendered.split(',').map(x=>x.trim());
    }
  }
  const trusted=roles.filter(role=>groups.includes(role));
  if(!trusted.length) throw new HttpError(403,'FORBIDDEN','No operator role has been assigned to this account.');
  return {subject:claims.sub,groups:trusted,username:typeof claims.username==='string'?claims.username:claims.sub};
}

/** Both the identity group and this workspace's owner-managed membership cap permissions. */
export function authorizeMembership(identity:Identity,membership:unknown,workspaceId:string,minimum:Role='Analyst'):Membership {
  const m=membership as Partial<Membership>|null|undefined;
  if(!m || m.workspaceId!==workspaceId || !roles.includes(m.role as Role) || typeof m.name!=='string') {
    throw new HttpError(403,'FORBIDDEN','This account does not have access to the requested workspace.');
  }
  const groupRank=Math.max(0,...identity.groups.map(role=>ranks[role]));
  const effectiveRank=Math.min(ranks[m.role as Role],groupRank);
  if(effectiveRank<ranks[minimum]) throw new HttpError(403,'FORBIDDEN',`This action requires the ${minimum} role in this workspace.`);
  return {workspaceId:m.workspaceId,name:m.name,role:roles[effectiveRank-1]};
}

export function identifier(value:string|undefined,kind='identifier'):string {
  if(!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new HttpError(400,'INVALID_INPUT',`The ${kind} is invalid.`);
  return value;
}

export function objectInput(value:unknown,allowed:string[]):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new HttpError(400,'INVALID_INPUT','Provide a JSON object.');
  const record=value as Record<string,unknown>;
  if(Object.keys(record).some(key=>!allowed.includes(key))) throw new HttpError(400,'INVALID_INPUT','The request contains unsupported fields.');
  return record;
}

export function expectedVersion(value:unknown):number {
  if(!Number.isSafeInteger(value) || (value as number)<1) throw new HttpError(400,'INVALID_INPUT','A positive expectedVersion is required.');
  return value as number;
}

export function planName(value:unknown):string {
  if(typeof value!=='string' || value.trim().length<1 || value.trim().length>100 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400,'INVALID_INPUT','Plan name must contain 1 to 100 readable characters.');
  }
  return value.trim();
}

export interface WorkspaceSettings {version:number; defaultThresholdMinutes:number; maxFleetSize:number; enabledSiteIds:string[]}
export function validateSettings(raw:unknown,siteIds:string[]):Omit<WorkspaceSettings,'version'> & {expectedVersion:number} {
  const value=objectInput(raw,['expectedVersion','defaultThresholdMinutes','maxFleetSize','enabledSiteIds']);
  const version=expectedVersion(value.expectedVersion);
  if(!Number.isInteger(value.defaultThresholdMinutes) || (value.defaultThresholdMinutes as number)<5 || (value.defaultThresholdMinutes as number)>30) {
    throw new HttpError(400,'INVALID_INPUT','Default time threshold must be an integer between 5 and 30 minutes.');
  }
  if(!Number.isInteger(value.maxFleetSize) || (value.maxFleetSize as number)<1 || (value.maxFleetSize as number)>4) {
    throw new HttpError(400,'INVALID_INPUT','Maximum fleet size must be between 1 and 4.');
  }
  if(!Array.isArray(value.enabledSiteIds) || !value.enabledSiteIds.length || value.enabledSiteIds.length>siteIds.length ||
    value.enabledSiteIds.some(x=>typeof x!=='string'||!siteIds.includes(x)) || new Set(value.enabledSiteIds).size!==value.enabledSiteIds.length) {
    throw new HttpError(400,'INVALID_INPUT','Choose a nonempty set of existing candidate sites without duplicates.');
  }
  if((value.maxFleetSize as number)>value.enabledSiteIds.length) throw new HttpError(400,'INVALID_INPUT','Maximum fleet size cannot exceed the number of enabled sites.');
  return {expectedVersion:version,defaultThresholdMinutes:value.defaultThresholdMinutes as number,maxFleetSize:value.maxFleetSize as number,
    enabledSiteIds:[...value.enabledSiteIds as string[]].sort()};
}
