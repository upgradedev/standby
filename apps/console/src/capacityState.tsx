import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {createDefaultCapacityInput, type CapacityComparisonResult, type CapacityInput} from '../../../packages/contracts/src/capacity';
import {ApiError, request} from './lib/api';
import {capacityInputFingerprint, capacityInputKey, capacityUnavailableReason, normalizedCapacityInput, validateCapacityResult} from './lib/capacity';
import {useStandby} from './state';

interface CapacityState {
  input: CapacityInput | null;
  setInput: (input: CapacityInput) => void;
  result: CapacityComparisonResult | null;
  running: boolean;
  error: ApiError | null;
  stale: boolean;
  unavailableReason: string | null;
  run: () => Promise<boolean>;
}
interface Snapshot {
  scope: string;
  input: CapacityInput | null;
  result: CapacityComparisonResult | null;
  running: boolean;
  error: ApiError | null;
}
const Context = createContext<CapacityState | null>(null);
const empty = (scope: string, input: CapacityInput | null = null): Snapshot => ({scope, input, result: null, running: false, error: null});

/** In-memory drafts and results live above routes, scoped to one workspace/dataset. */
export function CapacityProvider({children}: {children: ReactNode}) {
  const {config, manifest, scopeKey, loading, error: sourceError, toast} = useStandby();
  const scope = JSON.stringify([scopeKey, manifest?.dataset.hash ?? null]);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(''));
  const [clock, tick] = useState(0);
  const current = useRef(snapshot);
  const latest = useRef({scope, config, manifest, loading, sourceError});
  // This render-time guard prevents old-scope responses being exposed before effects run.
  latest.current = {scope, config, manifest, loading, sourceError};
  const sequence = useRef(0), busy = useRef(false), controller = useRef<AbortController | null>(null);
  const publish = useCallback((next: Snapshot) => { current.current = next; setSnapshot(next); }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    busy.current = false;
  }, []);

  useEffect(() => {
    cancel();
    const sites = latest.current.manifest?.dataset.sites.map(site => site.id) ?? [];
    publish(empty(scope, sites.length ? createDefaultCapacityInput(sites) : null));
    return cancel;
  }, [scope, cancel, publish]);

  const active = snapshot.scope === scope;
  const input = active ? snapshot.input : null;
  const result = active ? snapshot.result : null;
  const error = active ? snapshot.error : null;
  const running = active && snapshot.running;
  const unavailableReason = loading ? 'Dataset and route metadata are loading.'
    : sourceError ? 'Dataset metadata could not be refreshed. Retry loading the API before running.'
    : !config ? 'Application configuration is not ready.'
    : capacityUnavailableReason(manifest);
  let stale = false;
  if (result) {
    stale = !!error || running || !!unavailableReason || result.datasetHash !== manifest?.dataset.hash
      || result.configHash !== manifest?.dataset.configHash || result.matrix.hash !== manifest?.matrix?.hash
      || result.matrix.expiresAt !== manifest?.matrix?.expiresAt || result.matrix.id !== manifest?.matrix?.id
      || result.matrix.generatedAt !== manifest?.matrix?.generatedAt;
    try { stale ||= !input || capacityInputKey(result.input) !== capacityInputKey(input); }
    catch { stale = true; }
  }

  useEffect(() => {
    if (!active) return;
    const expiries = [manifest?.matrix?.expiresAt, result?.matrix.expiresAt]
      .map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
    if (!expiries.length) return;
    const expiresAt = Math.min(...expiries);
    // Already-expired metadata disables a run without fabricating an API failure.
    if (expiresAt <= Date.now() && !result) return;
    const timer = setTimeout(() => {
      if (latest.current.scope !== scope || current.current.scope !== scope) return;
      const now = Date.now(), state = current.current;
      const matrixExpired = !!latest.current.manifest?.matrix && Date.parse(latest.current.manifest.matrix.expiresAt) <= now;
      const resultExpired = !!state.result && Date.parse(state.result.matrix.expiresAt) <= now;
      if (matrixExpired) cancel();
      if (matrixExpired || resultExpired) publish({...state, result: null,
        running: matrixExpired ? false : state.running,
        error: new ApiError('The route snapshot expired. Your draft is preserved; reload after a fresh snapshot is published and retry.', 'MATRIX_EXPIRED')});
      tick(value => value + 1);
    }, Math.min(Math.max(0, expiresAt - Date.now() + 1), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [scope, active, manifest?.matrix?.expiresAt, result, clock, cancel, publish]);

  const setInput = useCallback((value: CapacityInput) => {
    if (latest.current.scope !== scope || current.current.scope !== scope) return;
    cancel();
    publish({...current.current, input: structuredClone(value), running: false, error: null});
  }, [scope, cancel, publish]);

  const run = useCallback(async (): Promise<boolean> => {
    const source = latest.current, state = current.current;
    if (busy.current || source.scope !== scope || state.scope !== scope || !state.input || !source.config || !source.manifest) return false;
    const reason = source.loading ? 'Wait for dataset metadata to finish loading.'
      : source.sourceError ? 'Reload dataset metadata before running.' : capacityUnavailableReason(source.manifest);
    if (reason) { toast(reason, 'info'); return false; }
    busy.current = true;
    const call = ++sequence.current, abort = new AbortController();
    controller.current = abort;
    publish({...state, running: true, error: null});
    const stillCurrent = () => call === sequence.current && latest.current.scope === scope && current.current.scope === scope && !abort.signal.aborted;
    let requested = false;
    try {
      // This private clone cannot change while hashing or awaiting the public endpoint.
      const submitted = normalizedCapacityInput(state.input);
      const fingerprint = await capacityInputFingerprint(submitted);
      if (!stillCurrent()) return false;
      requested = true;
      const response = await request<unknown>(source.config.apiBase, '/public/capacity-evaluations', {
        method: 'POST', body: JSON.stringify(submitted), signal: abort.signal,
      });
      if (!stillCurrent()) return false;
      const activeManifest = latest.current.manifest;
      if (!activeManifest || capacityUnavailableReason(activeManifest)
        || activeManifest.dataset.configHash !== source.manifest.dataset.configHash
        || activeManifest.matrix?.hash !== source.manifest.matrix?.hash
        || activeManifest.matrix?.expiresAt !== source.manifest.matrix?.expiresAt) {
        throw new ApiError('Dataset or route metadata changed during the run. Your draft is preserved; retry against the active snapshot.', 'INVALID_RESULT', '', 502);
      }
      const accepted = validateCapacityResult(response, submitted, fingerprint, activeManifest);
      publish({...current.current, result: accepted, running: false, error: null});
      toast('Capacity comparison ready. Review its assumptions and recorded replay.');
      return true;
    } catch (cause) {
      if (!stillCurrent()) return false;
      const failure = cause instanceof ApiError ? cause : requested
        ? new ApiError('Capacity evaluation is unavailable. Your draft is preserved; retry the run.')
        : new ApiError('The scenario could not be submitted. Check its values and retry; your draft is preserved.', 'INVALID_INPUT', '', 400);
      publish({...current.current, running: false, error: failure});
      toast(failure.message, 'error');
      return false;
    } finally {
      if (stillCurrent()) {
        busy.current = false;
        controller.current = null;
        if (current.current.running) publish({...current.current, running: false});
      }
    }
  }, [scope, publish, toast]);

  return <Context.Provider value={{input, setInput, result, running, error, stale, unavailableReason, run}}>{children}</Context.Provider>;
}

export function useCapacity(): CapacityState {
  const value = useContext(Context);
  if (!value) throw new Error('CapacityProvider is required.');
  return value;
}
