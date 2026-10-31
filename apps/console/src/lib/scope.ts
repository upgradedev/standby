export interface ScopeGuard {
  readonly key: string;
  isCurrent: (key: string) => boolean;
  change: (workspace: string) => string;
  track: (key: string, controller: AbortController) => () => void;
}

/** One synchronous boundary for requests and callbacks; keys contain no credentials. */
export function createScopeGuard(): ScopeGuard {
  let generation = 0, key = '0:public';
  const pending = new Set<AbortController>();
  return {
    get key() { return key; },
    isCurrent: captured => captured === key,
    change(workspace) {
      key = `${++generation}:${workspace}`;
      for (const controller of pending) controller.abort();
      pending.clear();
      return key;
    },
    track(captured, controller) {
      if (captured !== key) controller.abort();
      else pending.add(controller);
      return () => pending.delete(controller);
    },
  };
}

export function workspaceRequest(search: string): {workspace: string | null; invalid: boolean} {
  const values = new URLSearchParams(search).getAll('workspace');
  if (!values.length) return {workspace: null, invalid: false};
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(values[0]!)) return {workspace: null, invalid: true};
  return {workspace: values[0]!, invalid: false};
}

/** Missing workspace on an internal navigation inherits scope; Back/fresh load is public. */
export function workspaceIntent(search: string, navigation: string, current: string, pending: string): {workspace: string; invalid: boolean} {
  const request = workspaceRequest(search);
  return {workspace: request.invalid ? 'public' : request.workspace ?? (navigation === 'POP' ? 'public' : current !== 'public' ? current : navigation === 'REPLACE' ? pending : 'public'), invalid: request.invalid};
}

export function workspaceSearch(search: string, workspace: string): string {
  const params = new URLSearchParams(search);
  params.delete('workspace');
  if (workspace !== 'public') params.set('workspace', workspace);
  const query = params.toString();
  return query ? `?${query}` : '';
}
