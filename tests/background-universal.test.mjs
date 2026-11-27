import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundDeliveryStopped, backgroundProject, capabilityTransport,
  isPublicBackgroundKey, validateBackgroundCapability} from '../sync/background-universal.mjs';

const userId = '10000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
const deviceId = '30000000-0000-4000-8000-000000000001';
const sessionId = '40000000-0000-4000-8000-000000000001';
const scope = {userId, ownerId, deviceId, sessionId};
const capability = (now = Date.now()) => ({protocolVersion: 1,
  capabilityId: '50000000-0000-4000-8000-000000000001', capability: 'a'.repeat(64),
  actorId: userId, ownerId, deviceId, sessionId,
  issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
  allowedActions: ['animal.update', 'photo.create']});
const grant = () => ({...scope, projectUrl: 'https://background-test.supabase.co',
  publishableKey: 'sb_publishable_synthetic', capability: capability()});
const operation = (action = 'animal.update') => ({protocolVersion: 1,
  operationId: '60000000-0000-4000-8000-000000000001', ownerId, deviceId,
  action, entityId: 'animal-1', baseRevision: action.endsWith('.create') ? null : 7,
  capturedAt: new Date().toISOString(), changes: action === 'photo.create'
    ? {animalId: 'animal-1', mime: 'image/png', name: 'original.png'} : {fields: {name: 'Luna'}}});
const receipt = op => ({protocolVersion: 1, operationId: op.operationId, status: 'applied',
  revision: 8, code: 'OK', serverReceivedAt: new Date().toISOString()});
const response = (value, status = 200) => new Response(JSON.stringify(value),
  {status, headers: {'Content-Type': 'application/json'}});

test('capability binds user, ranch, device and auth session without persisting Auth tokens', () => {
  const value = capability();
  const validated = validateBackgroundCapability({...value, accessToken: 'must-not-persist', refreshToken: 'never'}, scope);
  assert.deepEqual(validated, value);
  for (const key of ['userId', 'ownerId', 'deviceId', 'sessionId']) {
    assert.throws(() => validateBackgroundCapability(value, {...scope,
      [key]: '70000000-0000-4000-8000-000000000001'}), BackgroundDeliveryStopped);
  }
  assert.throws(() => validateBackgroundCapability({...value, allowedActions: ['admin.delete_all']}, scope));
});

test('expired, future, overlong and malformed grants fail closed', () => {
  const now = Date.now(), value = capability(now);
  for (const change of [
    {expiresAt: new Date(now).toISOString()},
    {issuedAt: new Date(now + 60000).toISOString()},
    {expiresAt: new Date(now + 7 * 3600000).toISOString()},
    {capability: 'not-a-capability'}, {sessionId: ''},
    {allowedActions: ['photo.create', 'photo.create']}, {allowedActions: []},
  ]) assert.throws(() => validateBackgroundCapability({...value, ...change}, scope, now));
});

test('only public keys and HTTPS or loopback projects are accepted', () => {
  const jwt = role => ['header', Buffer.from(JSON.stringify({role})).toString('base64url'), 'signature'].join('.');
  assert.equal(isPublicBackgroundKey('sb_publishable_synthetic'), true);
  assert.equal(isPublicBackgroundKey(jwt('anon')), true);
  for (const key of ['sb_secret_never', jwt('service_role'), jwt('authenticated'), 'opaque']) {
    assert.equal(isPublicBackgroundKey(key), false);
  }
  assert.equal(backgroundProject('http://127.0.0.1:54321/'), 'http://127.0.0.1:54321');
  for (const url of ['http://external.example', 'https://user:password@example.com',
    'https://example.com/other', 'https://example.com/?credential=secret']) {
    assert.throws(() => backgroundProject(url));
  }
});

test('metadata uses the limited RPC, preserves the envelope, omits Auth cookies and JWT', async () => {
  const op = operation(), before = structuredClone(op), calls = [], accepted = receipt(op);
  let checks = 0;
  const sender = capabilityTransport({grant: grant(), assertActive: async () => { checks++; },
    fetchImpl: async (url, options) => { calls.push({url, options}); return response(accepted); }});
  assert.deepEqual(await sender.sendOperation(op), accepted);
  assert.deepEqual(op, before);
  assert.equal(checks, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://background-test.supabase.co/rest/v1/rpc/sync_apply_background_operation');
  const options = calls[0].options;
  assert.deepEqual(JSON.parse(options.body), {p_capability: 'a'.repeat(64), p_operation: before});
  assert.equal(options.headers.apikey, 'sb_publishable_synthetic');
  assert.equal(Object.keys(options.headers).some(key => key.toLowerCase() === 'authorization'), false);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.ok(options.signal instanceof AbortSignal);
});

test('photo gateway receives exact original bytes and returns its server receipt', async () => {
  const op = operation('photo.create'), accepted = receipt(op);
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 29, 0, 255]);
  let calls = 0;
  const sender = capabilityTransport({grant: grant(), assertActive: async () => {},
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://background-test.supabase.co/functions/v1/sync-background-photo');
      assert.ok(options.body instanceof FormData);
      assert.deepEqual([...options.body.keys()], ['capability', 'operation', 'file']);
      assert.equal(options.body.get('capability'), 'a'.repeat(64));
      assert.deepEqual(JSON.parse(options.body.get('operation')), op);
      assert.equal(options.body.get('file').type, 'image/png');
      assert.deepEqual(new Uint8Array(await options.body.get('file').arrayBuffer()), original);
      assert.equal(options.headers.Authorization, undefined);
      return response(accepted);
    }});
  assert.deepEqual(await sender.uploadPhoto({operation: op, blob: new Blob([original], {type: 'image/png'})}), accepted);
  assert.equal(calls, 1);
});

test('foreign operations, forbidden actions and invalid originals never reach transport', async () => {
  let calls = 0;
  const sender = capabilityTransport({grant: grant(), assertActive: async () => {},
    fetchImpl: async () => { calls++; throw Error('Unexpected request'); }});
  for (const op of [
    {...operation(), ownerId: 'foreign'}, {...operation(), deviceId: 'foreign'}, operation('config.update'),
  ]) await assert.rejects(sender.sendOperation(op), error => error.stopDelivery === true);
  for (const blob of [new Blob(), new Blob(['data'], {type: 'text/plain'}),
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {type: 'image/png'})]) {
    await assert.rejects(sender.uploadPhoto({operation: operation('photo.create'), blob}), error => error.stopDelivery === true);
  }
  assert.equal(calls, 0);
});

test('revocation before and during an HTTP response prevents accepting a receipt', async () => {
  let active = false, calls = 0;
  const op = operation();
  const sender = capabilityTransport({grant: grant(), assertActive: async () => {
    if (!active) throw new BackgroundDeliveryStopped('BACKGROUND_SESSION_CHANGED');
  }, fetchImpl: async () => { calls++; active = false; return response(receipt(op)); }});
  await assert.rejects(sender.sendOperation(op), error => error.stopDelivery === true);
  assert.equal(calls, 0);
  active = true;
  await assert.rejects(sender.sendOperation(op), error => error.stopDelivery === true);
  assert.equal(calls, 1);
});

test('401, 403 and quota pause without fabricating a terminal operation receipt', async () => {
  for (const status of [401, 403, 429]) {
    const sender = capabilityTransport({grant: grant(), assertActive: async () => {},
      fetchImpl: async () => response({code: 'BACKGROUND_UNAVAILABLE'}, status)});
    await assert.rejects(sender.sendOperation(operation()), error => error.stopDelivery === true);
  }
  const retryable = capabilityTransport({grant: grant(), assertActive: async () => {},
    fetchImpl: async () => response({code: 'STORAGE_UNAVAILABLE'}, 502)});
  await assert.rejects(retryable.sendOperation(operation()), error => !error.stopDelivery);
});

test('a server byte conflict is preserved as an explicit conflict, never an applied receipt', async () => {
  const op = operation('photo.create'), conflict = {...receipt(op), status: 'conflict', revision: null, code: 'PHOTO_BYTES_CONFLICT'};
  const sender = capabilityTransport({grant: grant(), assertActive: async () => {}, fetchImpl: async () => response(conflict)});
  assert.deepEqual(await sender.uploadPhoto({operation: op, blob: new Blob(['original'], {type: 'image/png'})}), conflict);
});
