import assert from 'node:assert/strict';
import test from 'node:test';
import {createScopeGuard, workspaceIntent, workspaceRequest, workspaceSearch} from './scope';

test('a scope change synchronously aborts requests and invalidates retained callbacks', () => {
  const guard = createScopeGuard(), before = guard.key;
  const controller = new AbortController();
  guard.track(before, controller);
  const canPublish = () => guard.isCurrent(before);
  const next = guard.change('austin');
  assert.equal(controller.signal.aborted, true);
  assert.equal(canPublish(), false);
  assert.equal(guard.isCurrent(next), true);
  const late = new AbortController(); guard.track(before, late);
  assert.equal(late.signal.aborted, true);
  assert.notEqual(guard.change('austin'), next, 'A replaced session in the same workspace is a new scope.');
});

test('completed requests unregister without affecting a later scope', () => {
  const guard = createScopeGuard(), completed = new AbortController();
  guard.track(guard.key, completed)();
  guard.change('public');
  assert.equal(completed.signal.aborted, false);
});

test('workspace requests never accept malformed or ambiguous identifiers or a role', () => {
  assert.deepEqual(workspaceRequest('?workspace=austin&role=Admin'), {workspace: 'austin', invalid: false});
  for (const query of ['?workspace=../other', '?workspace=', '?workspace=a&workspace=b']) assert.equal(workspaceRequest(query).invalid, true);
  assert.deepEqual(workspaceRequest('?role=Admin'), {workspace: null, invalid: false});
});

test('internal links inherit scope, while Back and fresh loads without a query select public', () => {
  assert.equal(workspaceIntent('', 'PUSH', 'austin', 'public').workspace, 'austin');
  assert.equal(workspaceIntent('', 'REPLACE', 'public', 'requested').workspace, 'requested');
  assert.equal(workspaceIntent('', 'PUSH', 'public', 'requested').workspace, 'public');
  assert.equal(workspaceIntent('', 'POP', 'austin', 'requested').workspace, 'public');
  assert.deepEqual(workspaceIntent('?workspace=bad/path', 'PUSH', 'austin', 'public'), {workspace: 'public', invalid: true});
});

test('workspace query updates preserve page filters and remove scope when public is selected', () => {
  assert.equal(workspaceSearch('?zone=zone-1&workspace=old', 'austin'), '?zone=zone-1&workspace=austin');
  assert.equal(workspaceSearch('?workspace=austin&zone=zone-1', 'public'), '?zone=zone-1');
});
