import type { Config } from './types';
const AUTH = 'standby.auth.v1';
const PKCE = 'standby.pkce.v1';
export interface Session { accessToken: string; expiresAt: number; email: string }
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function readSession(): Session | null {
  try { const value = JSON.parse(sessionStorage.getItem(AUTH) ?? 'null') as Session | null; return value && value.expiresAt > Date.now() && typeof value.accessToken === 'string' ? value : null; } catch { return null; }
}
export async function signIn(config:Config) {
  if (!config.auth?.domain || !config.auth.clientId) throw new Error('Operator sign-in has not been configured.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const redirectUri = config.auth.redirectUri ?? `${location.origin}/auth/callback`;
  sessionStorage.setItem(PKCE,JSON.stringify({verifier,state,redirectUri}));
  const url = new URL('/oauth2/authorize',config.auth.domain.startsWith('https://') ? config.auth.domain : `https://${config.auth.domain}`);
  url.search = new URLSearchParams({response_type:'code',client_id:config.auth.clientId,redirect_uri:redirectUri,scope:'openid profile standby/access',state,code_challenge_method:'S256',code_challenge:challenge}).toString();
  location.assign(url);
}
export async function finishSignIn(config:Config): Promise<Session> {
  const params = new URLSearchParams(location.search);
  const pkce = JSON.parse(sessionStorage.getItem(PKCE) ?? 'null') as {verifier:string;state:string;redirectUri:string}|null;
  if (params.has('error')) throw new Error(params.get('error_description') ?? 'Sign-in was declined.');
  if (!config.auth || !pkce || params.get('state') !== pkce.state || !params.get('code')) throw new Error('Sign-in state could not be verified. Start sign-in again.');
  sessionStorage.removeItem(PKCE);
  const domain = config.auth.domain.startsWith('https://') ? config.auth.domain : `https://${config.auth.domain}`;
  const response = await fetch(`${domain}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.auth.clientId,code:params.get('code')!,redirect_uri:pkce.redirectUri,code_verifier:pkce.verifier})});
  if (!response.ok) throw new Error('The operator session could not be established.');
  const token = await response.json() as {access_token:string;id_token?:string;expires_in:number};
  if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in)) throw new Error('The identity service returned an invalid session.');
  let email = 'Operator';
  try {
    const encoded = token.id_token?.split('.')[1];
    if (encoded) {
      const claims = JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/'))) as Record<string, unknown>;
      email = [claims.email, claims['cognito:username'], claims.name].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? 'Operator';
    }
  } catch { /* Display only; authority comes from server memberships. */ }
  const session = {accessToken:token.access_token,expiresAt:Date.now()+token.expires_in*1000,email};
  sessionStorage.setItem(AUTH,JSON.stringify(session));
  return session;
}
export function signOut(config:Config) {
  sessionStorage.removeItem(AUTH);
  if (config.auth?.domain && config.auth.clientId) {
    const domain = config.auth.domain.startsWith('https://') ? config.auth.domain : `https://${config.auth.domain}`;
    location.assign(`${domain}/logout?${new URLSearchParams({client_id:config.auth.clientId,logout_uri:`${location.origin}/overview`})}`);
  } else location.assign('/overview');
}
