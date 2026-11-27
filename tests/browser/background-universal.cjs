// Real Chromium module Service Worker, IndexedDB, WebCrypto and Web Locks.
// The HTTP capability/RPC/gateway server is synthetic and loopback-only. CDP
// dispatches the actual sync event after all PWA windows have closed; this does
// not claim that an OS will schedule or keep a force-stopped browser alive.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.env.BACKGROUND_BROWSER_ARTIFACTS || path.join(os.tmpdir(), 'ganaderov-background-' + process.pid));
const userId = '10000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
const deviceId = '30000000-0000-4000-8000-000000000001';
const sessionId = '40000000-0000-4000-8000-000000000001';
const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=', 'base64');
const calls = [], ledger = new Map(), grants = new Set(), results = [];
let origin, context, server, browser, holdResponse, releaseResponse, deny = false;
const appWindows = () => context.pages().filter(page => page.url().startsWith(origin)).length;
const html = '<!doctype html><meta charset="utf-8"><title>Background queue regression</title><h1>Local background regression</h1><script>navigator.serviceWorker.addEventListener("message",e=>e.ports[0]?.postMessage({status:"drained"}));</script>';
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); }
function json(res, value, status = 200) { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)); }
async function serve(req, res) {
  try {
    const url = new URL(req.url, origin || 'http://127.0.0.1');
    if (req.method === 'POST') {
      let token, operation, uploaded;
      if (url.pathname === '/functions/v1/sync-background-photo') {
        const form = await new Request(url, {method: 'POST', headers: req.headers, body: await body(req), duplex: 'half'}).formData();
        token = form.get('capability'); operation = JSON.parse(form.get('operation'));
        uploaded = Buffer.from(await form.get('file').arrayBuffer());
      } else {
        const data = JSON.parse((await body(req)).toString()); token = data.p_capability; operation = data.p_operation;
      }
      calls.push({path: url.pathname, operationId: operation?.operationId, pwaWindows: appWindows(),
        authorization: Object.hasOwn(req.headers, 'authorization'), sha256: uploaded && crypto.createHash('sha256').update(uploaded).digest('hex')});
      if (url.pathname.endsWith('/sync_revoke_background_token')) { grants.delete(token); json(res, {revoked: true}); return; }
      if (deny || !grants.has(token)) { json(res, {code: 'BACKGROUND_REVOKED'}, 401); return; }
      assert.equal(operation.ownerId, ownerId); assert.equal(operation.deviceId, deviceId);
      if (uploaded) assert.deepEqual(uploaded, original);
      const previous = ledger.get(operation.operationId);
      if (previous) assert.deepEqual(previous.operation, operation);
      const receipt = previous ? {...previous.receipt, status: 'duplicate'} : {
        protocolVersion: 1, operationId: operation.operationId, status: 'applied',
        revision: operation.action === 'animal.update' ? 2 : 1,
        serverReceivedAt: new Date().toISOString(), code: 'OK'};
      if (!previous) ledger.set(operation.operationId, {operation, receipt});
      if (holdResponse) { const wait = holdResponse; holdResponse = null; await wait; }
      json(res, receipt); return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/harness.html') {
      res.setHeader('Content-Type', 'text/html'); res.end(html); return;
    }
    if (url.pathname === '/config.js' || url.pathname === '/supabase-stub.js') {
      res.setHeader('Content-Type', 'application/javascript'); res.end('// No Auth credentials in this synthetic worker test'); return;
    }
    const target = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    let data = await fs.readFile(target);
    if (url.pathname === '/service-worker.js') data = Buffer.from(data.toString().replace(
      /const SUPABASE_SCRIPT = [^;]+;/, 'const SUPABASE_SCRIPT = new URL("./supabase-stub.js",self.location.href).href;'));
    const type = {'.mjs': 'application/javascript', '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml'}[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}); res.end(data);
  } catch (error) { res.writeHead(500); res.end('Synthetic test failure: ' + error.message); }
}
async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error('Timed out: ' + label);
}
async function test(name, fn) {
  const start = Date.now();
  try { const detail = await fn(); results.push({name, status: 'passed', milliseconds: Date.now() - start, detail}); console.log('PASS', name); }
  catch (error) { results.push({name, status: 'failed', error: error.stack}); throw error; }
}
function newGrant() {
  const value = {protocolVersion: 1, capabilityId: crypto.randomUUID(), capability: crypto.randomBytes(32).toString('hex'),
    actorId: userId, ownerId, deviceId, sessionId, issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), allowedActions: ['animal.create', 'animal.update', 'photo.create']};
  grants.add(value.capability); return value;
}
async function openPage() {
  const page = await context.newPage(); await page.goto(origin + '/harness.html');
  await page.evaluate(async scope => {
    window.bg = await import('/sync/background-universal.mjs');
    window.universal = await import('/sync/universal-outbox.mjs');
    window.protected = await import('/sync/protected-store.mjs');
    window.scope = scope;
    window.database = await new Promise((resolve, reject) => {
      const name = `ganadero-local-account-${encodeURIComponent(location.origin)}-${scope.userId}-ranch-${scope.ownerId}`;
      const request = indexedDB.open(name, 8);
      request.onupgradeneeded = () => { for (const name of ['syncMeta', 'operationOutbox', 'photoUploads']) request.result.createObjectStore(name, {keyPath: 'id'}); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }, {userId, ownerId, deviceId, sessionId});
  return page;
}
async function publish(page, cap) {
  return page.evaluate(capability => bg.publishBackgroundCapability({database, ...scope,
    projectUrl: location.origin, publishableKey: 'sb_publishable_synthetic', issueCapability: async () => capability}), cap);
}
async function queue(page, items) {
  return page.evaluate(async items => {
    await universal.enqueueUniversalBatch(database, scope, items.map(item => ({...item,
      ...(item.bytes ? {blob: new Blob([new Uint8Array(item.bytes)], {type: 'image/png'})} : {})})));
  }, items);
}
function op(action, entityId, changes, baseRevision = null) {
  return {protocolVersion: 1, operationId: crypto.randomUUID(), ownerId, deviceId, action,
    entityId, changes, baseRevision, capturedAt: new Date().toISOString()};
}
async function queueState(page) { return page.evaluate(() => universal.readQueue(database, scope)); }

(async () => {
  await fs.mkdir(OUT, {recursive: true});
  server = http.createServer((req, res) => { void serve(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']});
  context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient'));
  const controller = await context.newPage();
  const cdp = await context.newCDPSession(controller);
  const registrations = new Map();
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => {
    for (const entry of event.registrations) registrations.set(entry.registrationId, entry);
  });
  await cdp.send('ServiceWorker.enable');
  let page = await openPage();
  await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js', {type: 'module'}); await navigator.serviceWorker.ready; });
  await until(() => [...registrations.values()].some(entry => entry.scopeURL === origin + '/' && !entry.isDeleted), 'service worker registration');
  const registration = [...registrations.values()].find(entry => entry.scopeURL === origin + '/' && !entry.isDeleted);
  const dispatch = () => cdp.send('ServiceWorker.dispatchSyncEvent', {origin, registrationId: registration.registrationId,
    tag: 'ganaderov-event-outbox-v1', lastChance: false});
  const cap = newGrant();
  await publish(page, cap);
  const create = op('animal.create', 'new-animal', {fields: {name: 'New'}});
  const edit = op('animal.update', 'new-animal', {fields: {name: 'Adjusted'}});
  const photo = op('photo.create', 'new-photo', {animalId: 'new-animal', mime: 'image/png', name: 'original.png', primary: true});
  await queue(page, [{operation: create}, {operation: edit, baseOperationId: create.operationId},
    {operation: photo, dependsOn: [create.operationId], bytes: [...original]}]);

  await test('Real sync event delivers dependencies and original with no PWA windows', async () => {
    await page.close(); assert.equal(appWindows(), 0);
    await dispatch();
    await until(() => ledger.size === 3, 'three committed operations');
    assert(calls.filter(call => call.operationId).every(call => call.pwaWindows === 0));
    assert(calls.every(call => call.authorization === false));
    assert.equal(ledger.get(edit.operationId).operation.baseRevision, 1);
    assert.equal(calls.find(call => call.path.startsWith('/functions/')).sha256,
      crypto.createHash('sha256').update(original).digest('hex'));
    page = await openPage();
    await until(async () => (await queueState(page)).every(entry => entry.state === 'confirmed'), 'durable receipts');
    return {pwaWindowsDuringRequests: 0, operations: 3, realServiceWorker: true, originalSha256: crypto.createHash('sha256').update(original).digest('hex')};
  });

  await test('Capability registry and queue are encrypted; keys are nonextractable', async () => {
    const evidence = await page.evaluate(async token => {
      const db = await new Promise(resolve => { const request = indexedDB.open('ganaderov-background-v1'); request.onsuccess = () => resolve(request.result); });
      const rows = await new Promise(resolve => { const tx = db.transaction('syncMeta'); const request = tx.objectStore('syncMeta').getAll(); request.onsuccess = () => resolve(request.result); });
      const grants = rows.filter(row => row.id.startsWith('grant:'));
      const result = {encrypted: grants.every(row => !!row.encryptedRecord), tokenInPlainRows: JSON.stringify(rows).includes(token),
        keysNonextractable: rows.filter(row => row.key).every(row => row.key.extractable === false)};
      db.close(); return result;
    }, cap.capability);
    assert.deepEqual(evidence, {encrypted: true, tokenInPlainRows: false, keysNonextractable: true}); return evidence;
  });

  await test('Logout during a committed response retains the pending envelope for idempotent retry', async () => {
    const pending = op('animal.update', 'new-animal', {fields: {name: 'Late'}}, 2);
    await queue(page, [{operation: pending}]);
    holdResponse = new Promise(resolve => { releaseResponse = resolve; });
    await page.close(); await dispatch();
    await until(() => ledger.has(pending.operationId), 'held response');
    page = await openPage(); await page.evaluate(() => bg.disableBackgroundDelivery());
    releaseResponse();
    await new Promise(resolve => setTimeout(resolve, 200));
    const entry = (await queueState(page)).find(row => row.id === pending.operationId);
    assert.equal(entry.state, 'pending'); assert.equal(entry.attempts, 0); assert.deepEqual(entry.operation, pending);
    await publish(page, newGrant()); await page.close(); await dispatch();
    await until(() => calls.filter(call => call.operationId === pending.operationId).length === 2, 'same UUID retried');
    page = await openPage();
    await until(async () => (await queueState(page)).find(row => row.id === pending.operationId).state === 'confirmed', 'duplicate receipt');
    assert.equal((await queueState(page)).find(row => row.id === pending.operationId).receipt.status, 'duplicate');
  });

  await test('Server revocation pauses without a false rejection or changing the operation', async () => {
    const pending = op('animal.create', 'after-revocation', {fields: {name: 'Retained'}});
    await queue(page, [{operation: pending}]); deny = true;
    const before = calls.length; await page.close(); await dispatch();
    await until(() => calls.length > before, 'revoked request');
    await new Promise(resolve => setTimeout(resolve, 150));
    page = await openPage();
    const entry = (await queueState(page)).find(row => row.id === pending.operationId);
    assert.equal(entry.state, 'pending'); assert.equal(entry.attempts, 0); assert.deepEqual(entry.operation, pending);
    deny = false;
    const renewed = newGrant();
    assert.equal((await publish(page, renewed)).capabilityId, renewed.capabilityId);
  });

  await test('Late capability issuance cannot reactivate a logged-out session', async () => {
    await page.evaluate(() => bg.disableBackgroundDelivery());
    const late = newGrant();
    await page.evaluate(capability => {
      window.releaseGrant = null;
      window.latePublication = bg.publishBackgroundCapability({database, ...scope, projectUrl: location.origin,
        publishableKey: 'sb_publishable_synthetic', issueCapability: () => new Promise(resolve => { window.releaseGrant = () => resolve(capability); })})
        .then(() => 'unexpected-activation', error => error.code);
    }, late);
    await page.waitForFunction(() => typeof releaseGrant === 'function');
    await page.evaluate(() => bg.disableBackgroundDelivery());
    assert.equal(await page.evaluate(async () => { releaseGrant(); return latePublication; }), 'BACKGROUND_SESSION_CHANGED');
    const before = calls.filter(call => call.operationId).length;
    await page.close(); await dispatch();
    await until(() => !grants.has(late.capability), 'deferred revocation');
    assert.equal(calls.filter(call => call.operationId).length, before);
  });
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await fs.mkdir(OUT, {recursive: true});
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({status: process.exitCode ? 'failed' : 'passed',
    scope: {realServiceWorker: true, realIndexedDB: true, realWebCrypto: true, actualSyncEvent: true,
      syntheticAuthAndServer: true, physicalAndroid: false, osSchedulingGuaranteed: false}, results}, null, 2));
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
});
