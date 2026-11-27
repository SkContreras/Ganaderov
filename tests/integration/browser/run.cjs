// Ganaderov UI -> real local Supabase Auth, PostgREST/RPC and Storage.
// No response mocks, cloud substitutes, direct IDB writes or business-method hooks.
// The caller must create disposable fixtures with ../http_e2e.py --keep-fixtures.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const BASE = __dirname;
const ROOT = path.resolve(process.env.GANADEROV_WEB_ROOT || path.join(BASE, '../../..'));
const FIXTURES = path.resolve(process.env.GANADEROV_FIXTURES || path.join(BASE, '../runtime/fixtures.private.json'));
const OUT = path.resolve(process.env.GANADEROV_BROWSER_ARTIFACTS || path.join(BASE, '../runtime/browser-artifacts'));
const VENDOR = path.resolve(process.env.SUPABASE_JS_UMD || path.join(BASE, 'vendor/supabase-2.49.8.js'));
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js';
const SDK_SHA256 = 'cf78f9ba72300e729e517e0f6b974a3bd282b600ba57fd59de448d50b1aab46f';
const SDK_PATH = '/vendor/supabase-2.49.8.js';
const PRODUCTION_HOST = 'vptsuhlnhtqxadztgdxn.supabase.co';
const EXE = process.env.CHROMIUM_EXECUTABLE_PATH;
const tests = [], network = [], blocked = [], pageErrors = [];
const pendingResponses = new Set();
let fixture, server, browser, origin, apiOrigin, sourceSha256, sdkSha256, offline = false;
let page, context, secrets = [], phase = 'startup';
let cropOperation, primaryOperation, forecastOperation, journeyId, firstPhoto, secondPhoto;

function safe(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]');
}

function validateFixture(value) {
  assert.equal(process.env.GANADEROV_DISPOSABLE_HTTP, 'YES', 'Set GANADEROV_DISPOSABLE_HTTP=YES for a disposable local stack');
  assert.equal(value.disposable, true, 'Fixture must explicitly declare disposable:true');
  const url = new URL(value.apiUrl);
  assert.notEqual(url.hostname, PRODUCTION_HOST, 'Production is forbidden');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only literal loopback backend origins are accepted');
  assert(['http:', 'https:'].includes(url.protocol), 'Backend must use HTTP(S)');
  assert(!url.username && !url.password && !url.search && !url.hash && ['','/'].includes(url.pathname), 'Expected a clean local API origin');
  assert(typeof value.clientKey === 'string' && value.clientKey.length > 20, 'Missing client key');
  assert(!value.clientKey.startsWith('sb_secret_'), 'A secret key must never enter the browser');
  if (value.clientKey.startsWith('eyJ')) {
    const claims = JSON.parse(Buffer.from(value.clientKey.split('.')[1], 'base64url').toString());
    assert.equal(claims.role, 'anon', 'Only an anon JWT is accepted as a legacy client key');
  } else assert(value.clientKey.startsWith('sb_publishable_'), 'Expected publishable key or legacy anon JWT');
  const account = value.accounts?.ownerA;
  assert(account?.id && account.email && account.password, 'Missing ownerA login fixture');
  const entities = value.entities?.ownerA;
  assert(entities?.ownerId && entities.animals?.browser, 'Missing isolated browser animal');
  assert(entities.browserPhotos?.length >= 2, 'Browser fixture needs at least two photographs');
  for (const photo of entities.browserPhotos) {
    assert.equal(photo.animalId, entities.animals.browser, 'Photo must belong to isolated browser animal');
    assert(/^[a-f0-9]{64}$/.test(photo.sha256), 'Fixture needs original-byte SHA-256');
  }
  return url.origin;
}

async function check(name, fn) {
  phase = name;
  const start = Date.now();
  try {
    const detail = await fn();
    tests.push({name, status: 'passed', milliseconds: Date.now() - start, detail});
    console.log('PASS', name);
  } catch (error) {
    tests.push({name, status: 'failed', milliseconds: Date.now() - start, error: safe(error.stack || error.message)});
    throw error;
  }
}

function securityHeaders(res) {
  const wsOrigin = apiOrigin.replace(/^http/, 'ws');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${apiOrigin}; connect-src 'self' ${apiOrigin} ${wsOrigin}; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'`);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function serve(req, res) {
  try {
    securityHeaders(res);
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') {res.writeHead(405); res.end(); return;}
    if (url.pathname === '/config.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end('window.GANADERO_CONFIG=' + JSON.stringify({
        supabaseUrl: apiOrigin, supabaseAnonKey: fixture.clientKey,
        syncEventRpcV1: true, syncJourneyUniversalV1: true,
        syncRpcOnlyV1: false, syncIncrementalV1: false, syncBackgroundV1: false
      }) + ';');
      return;
    }
    if (url.pathname === SDK_PATH) {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(await fs.readFile(VENDOR));
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    assert(!rel.split('/').some(part => part.startsWith('.') || !part), 'Invalid local path');
    assert(!rel.includes('/') || /^sync\/[a-z0-9-]+\.mjs$/.test(rel), 'Only application assets are served');
    assert(/\.(html|css|js|mjs|svg|png|ico|webmanifest)$/.test(rel), 'Unsupported local asset');
    const target = path.resolve(ROOT, rel);
    assert(target.startsWith(ROOT + path.sep), 'Invalid local asset');
    let body = await fs.readFile(target);
    if (rel === 'index.html') {
      assert(body.toString().includes(SDK_URL), 'Pinned SDK URL changed');
      body = Buffer.from(body.toString().replace(SDK_URL, SDK_PATH));
    }
    if (rel === 'app.js') {
      const source = body.toString();
      sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
      const finalInitialize = /\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/;
      assert(finalInitialize.test(source), 'Final production initialize() not found');
      const hooks = await fs.readFile(path.join(BASE, 'inspect.js'), 'utf8');
      body = Buffer.from(source.replace(finalInitialize, '\n' + hooks + '\n  initialize();'));
    }
    if (rel === 'service-worker.js') {
      assert(body.toString().includes(SDK_URL), 'Pinned service-worker SDK URL changed');
      body = Buffer.from(body.toString().replace('"' + SDK_URL + '"', 'new URL("' + SDK_PATH + '",self.location.href).href'));
    }
    const type = {'.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png'}[path.extname(target)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(body);
  } catch (_) {res.writeHead(404); res.end('Local application asset unavailable');}
}

function observe(ctx) {
  const entries = new WeakMap();
  ctx.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== apiOrigin) return;
    const entry = {phase, offline, method: request.method(), path: url.pathname};
    // Do not record query strings, headers, Auth request bodies or session tokens.
    if (url.pathname.endsWith('/rpc/sync_apply_operation')) {
      try {
        const op = request.postDataJSON().p_operation;
        entry.operation = {id: op.operationId, action: op.action, entityId: op.entityId, baseRevision: op.baseRevision};
      } catch (_) {}
    }
    entries.set(request, entry); network.push(entry);
  });
  ctx.on('response', response => {
    const entry = entries.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    if (entry.operation) {
      const work = response.json().then(data => {
        entry.receipt = {status: data.status, revision: data.revision, code: data.code, operationId: data.operationId};
      }).catch(() => {}).finally(() => pendingResponses.delete(work));
      pendingResponses.add(work);
    }
  });
  ctx.on('requestfailed', request => {
    const entry = entries.get(request);
    if (entry) entry.failure = request.failure()?.errorText || 'request failed';
  });
  ctx.on('page', p => {
    p.on('pageerror', error => pageErrors.push({phase, error: safe(error.message)}));
    p.on('dialog', async dialog => {
      // Only the user-facing confirmation for our own incomplete test journey.
      if (dialog.type() === 'confirm' && /animal.*pendiente|animales pendientes/.test(dialog.message())) await dialog.accept();
      else await dialog.dismiss();
    });
  });
}

async function makeContext() {
  const ctx = await browser.newContext({viewport: {width: 1320, height: 1020}, serviceWorkers: 'allow'});
  observe(ctx);
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([origin, apiOrigin].includes(url.origin)) return route.continue();
    blocked.push({phase, origin: url.origin, path: url.pathname});
    return route.abort('blockedbyclient');
  });
  return ctx;
}

const animalId = () => fixture.entities.ownerA.animals.browser;
const snap = p => p.evaluate(id => window.__ganaderovIntegration.snapshot(id), animalId());
async function until(p, predicate, timeout = 30000) {
  // Evaluate the fixed test assertion in Node, never relaxing the page's CSP.
  const matches = Function('state', 'return (' + predicate + ')');
  const deadline = Date.now() + timeout;
  let state;
  while (Date.now() < deadline) {
    if (await p.evaluate(() => Boolean(window.__ganaderovIntegration))) {
      state = await snap(p);
      if (matches(state)) return state;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('Timed out waiting for local state: ' + predicate + '; current queue: ' + JSON.stringify(state?.outbox));
}

async function login(p) {
  await p.goto(origin, {waitUntil: 'domcontentloaded'});
  await p.waitForFunction(() => Boolean(window.__ganaderovIntegration));
  await p.locator('#account-button').click();
  await p.locator('#account-email').fill(fixture.accounts.ownerA.email);
  await p.locator('#account-password').fill(fixture.accounts.ownerA.password);
  await p.locator('#sign-in-form button[type="submit"]').click();
  await until(p, `state.ready && state.userId === ${JSON.stringify(fixture.accounts.ownerA.id)} && state.animal && !state.syncing && state.canonicalPhotos.length >= 2 && state.canonicalPhotos.every(photo => state.revisions.some(rev => rev.id === 'photo-revision:'+photo.id))`, 45000);
  await p.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {}, {timeout:30000});
}

async function showAnimal(p) {
  if (await p.locator('#detail-dialog[open]').count()) await p.locator('#detail-dialog [data-close="detail-dialog"]').click();
  if (await p.locator('#journey-dialog[open]').count()) await p.locator('#journey-dialog [data-close="journey-dialog"]').click();
  await p.locator('#inventory-nav').click();
  await p.locator(`[data-open-animal="${animalId()}"]`).first().click();
  await p.locator('[data-toggle-detail-view]').click();
}

async function setSlider(p, axis, value) {
  const locator = p.locator(`[data-photo-crop="${axis}"]`);
  const range = await locator.evaluate(el => ({min: Number(el.min), max: Number(el.max), step: Number(el.step) || 1}));
  const fromStart = Math.round((value - range.min) / range.step);
  const fromEnd = Math.round((range.max - value) / range.step);
  await locator.focus();
  await p.keyboard.press(fromStart <= fromEnd ? 'Home' : 'End');
  for (let i = 0; i < Math.min(fromStart, fromEnd); i++) await p.keyboard.press(fromStart <= fromEnd ? 'ArrowRight' : 'ArrowLeft');
  assert(Math.abs(Number(await locator.inputValue()) - value) < 0.001, 'Real keyboard input did not set slider');
}

async function assertOriginals(p) {
  const actual = await p.evaluate(id => window.__ganaderovIntegration.originals(id), animalId());
  for (const expected of fixture.entities.ownerA.browserPhotos) {
    assert.equal(actual.originals.find(item => item.id === expected.id)?.sha256, expected.sha256, 'Original bytes changed or missing');
  }
  assert(actual.raw.every(row => row.encrypted && !row.plaintextBlob && !row.plaintextCrop), 'Photographs must be encrypted in IndexedDB');
  return actual;
}

async function screenshot(name) {
  const dialog = page.locator('#detail-dialog[open]');
  if (await dialog.count()) await dialog.evaluate(el => {el.scrollTop = 0;});
  await page.screenshot({path: path.join(OUT, name + '.png')});
}

async function confirmed(p, id, photo = false) {
  const s = await until(p, `state.outbox.some(op => op.id === ${JSON.stringify(id)} && op.state === 'confirmed' ${photo ? '&& op.photoSettled === true' : ''}) && !state.syncing`, 45000);
  return s.outbox.find(op => op.id === id);
}

async function main() {
  fixture = JSON.parse(await fs.readFile(FIXTURES, 'utf8'));
  secrets = [fixture.clientKey, ...Object.values(fixture.accounts || {}).flatMap(account => [account.email, account.password])].filter(Boolean);
  apiOrigin = validateFixture(fixture);
  await fs.mkdir(OUT, {recursive:true, mode:0o700});
  const vendorBytes = await fs.readFile(VENDOR);
  sdkSha256 = crypto.createHash('sha256').update(vendorBytes).digest('hex');
  assert.equal(sdkSha256, SDK_SHA256, 'Official pinned Supabase SDK bytes differ');
  await check('Local disposable backend and safety guard', async () => {
    const response = await fetch(apiOrigin + '/auth/v1/health', {headers:{apikey:fixture.clientKey}, redirect:'error', signal:AbortSignal.timeout(10000)});
    assert(response.ok, 'Local Auth health check failed: ' + response.status);
    return {apiOrigin, disposable:true, cloudMocks:false, remoteOriginsAllowed:false};
  });
  server = http.createServer((req, res) => void serve(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({headless:true, ...(EXE ? {executablePath:EXE} : {}), args:['--no-sandbox','--disable-dev-shm-usage']});
  context = await makeContext(); page = await context.newPage();
  await check('UI password login, real REST pull and real Storage originals', async () => {
    await login(page);
    const s = await snap(page);
    assert.equal(s.ownerId, fixture.entities.ownerA.ownerId); assert.equal(s.role, 'owner');
    assert(network.some(request => request.path === '/auth/v1/token' && request.status === 200), 'No successful real Auth password request observed');
    assert(network.some(request => request.path === '/rest/v1/animal_sync_records' && request.status === 200), 'No successful real inventory REST pull observed');
    assert(network.some(request => request.path.startsWith('/storage/v1/object/') && request.status === 200), 'No successful real Storage download observed');
    firstPhoto = s.displayPhotos.find(photo => photo.primary)?.id || s.displayPhotos[0].id;
    secondPhoto = s.displayPhotos.find(photo => photo.id !== firstPhoto).id;
    return {userId:s.userId, ownerId:s.ownerId, photoCount:s.canonicalPhotos.length, originals:await assertOriginals(page)};
  });
  await showAnimal(page);
  await check('D4 offline crop through actual sliders and Save', async () => {
    const before = await snap(page);
    const previous = before.canonicalPhotos.find(photo => photo.id === firstPhoto);
    await context.setOffline(true); offline = true;
    const mutations = network.filter(request => request.operation).length;
    await page.locator('.detail-crop summary').click();
    await setSlider(page, 'zoom', 2.2); await setSlider(page, 'x', 17); await setSlider(page, 'y', 81);
    assert.equal((await snap(page)).outbox.filter(op => op.action === 'photo.crop').length, 0, 'Preview must not enqueue');
    await page.locator('[data-save-photo-crop]').click();
    const s = await until(page, `state.outbox.some(op => op.action === 'photo.crop' && op.state === 'pending') && state.displayPhotos.some(photo => photo.id === ${JSON.stringify(firstPhoto)} && photo.cropX === 17 && photo.cropY === 81 && photo.cropZoom === 2.2)`);
    cropOperation = s.outbox.find(op => op.action === 'photo.crop' && op.state === 'pending');
    assert.equal(network.filter(request => request.operation).length, mutations, 'Offline save attempted a mutation RPC');
    assert.deepEqual(s.canonicalPhotos.find(photo => photo.id === firstPhoto), previous, 'Pending overlay changed canonical metadata');
    assert.equal(await page.locator(`[data-primary-photo="${secondPhoto}"]`).isDisabled(), true, 'Pending crop must block the next photo mutation');
    await screenshot('01-crop-pending-offline');
    return {operationId:cropOperation.id, baseRevision:cropOperation.baseRevision, originals:await assertOriginals(page)};
  });
  await check('D4 literal offline reload restores Auth, encrypted photos and the same queued UUID', async () => {
    await page.reload({waitUntil:'domcontentloaded'});
    const s = await until(page, `state.ready && state.ranchContextOffline && state.serviceWorker && state.displayPhotos.some(photo => photo.id === ${JSON.stringify(firstPhoto)} && photo.cropX === 17 && photo.cropZoom === 2.2)`);
    assert.equal(s.outbox.find(op => op.action === 'photo.crop' && op.state === 'pending')?.id, cropOperation.id);
    if (s.online) assert(network.some(entry => entry.phase === phase && entry.failure === 'net::ERR_INTERNET_DISCONNECTED'), 'A misleading online indicator needs evidence of interrupted transport');
    await showAnimal(page); await screenshot('02-crop-restored-offline');
    return {operationId:cropOperation.id, scope:s.scope, browserReportedOnline:s.online, verifiedCachedAccess:true, originals:await assertOriginals(page)};
  });
  await check('D4 reconnect and the Sync button apply real RPC and retire the confirmed overlay', async () => {
    offline = false; await context.setOffline(false);
    await page.locator('#detail-dialog [data-close="detail-dialog"]').click();
    await page.locator('#sync-button').click();
    const op = await confirmed(page, cropOperation.id, true);
    await showAnimal(page);
    const s = await snap(page);
    assert.equal(s.canonicalPhotos.find(photo => photo.id === firstPhoto).cropX, 17);
    assert.equal(s.canonicalPhotos.find(photo => photo.id === firstPhoto).cropY, 81);
    assert.equal(s.canonicalPhotos.find(photo => photo.id === firstPhoto).cropZoom, 2.2);
    assert(op.receipt.revision > cropOperation.baseRevision);
    assert.equal(await page.locator(`[data-primary-photo="${secondPhoto}"]`).isDisabled(), false);
    assert.equal(await page.locator('.photo-sync-status').count(), 0, 'Overlay banner remained after confirmed snapshot');
    await screenshot('03-crop-confirmed');
    return {operationId:op.id, receipt:op.receipt, originals:await assertOriginals(page)};
  });
  await check('D4 choosing the primary image uses a fresh revision and real RPC', async () => {
    await page.locator(`[data-primary-photo="${secondPhoto}"]`).click();
    const s = await until(page, `state.outbox.some(op => op.action === 'photo.primary')`);
    primaryOperation = s.outbox.find(op => op.action === 'photo.primary');
    const op = await confirmed(page, primaryOperation.id, true);
    const after = await snap(page);
    assert.deepEqual(after.canonicalPhotos.filter(photo => photo.primary).map(photo => photo.id), [secondPhoto]);
    assert.equal(after.canonicalPhotos.find(photo => photo.id === firstPhoto).cropX, 17);
    assert.equal(await page.locator(`.detail-hero img[data-view-photo="${secondPhoto}"]`).count(), 1);
    await screenshot('04-primary-confirmed');
    return {operationId:op.id, receipt:op.receipt, primaryId:secondPhoto, originals:await assertOriginals(page)};
  });

  // D2/D3 UI is optional; the HTTP suite already covers both protocols.
  if (process.env.GANADEROV_BROWSER_EXTENDED === '1') {
    await page.locator('#detail-dialog [data-close="detail-dialog"]').click();
    await check('D2 UI forecast queues offline and confirms through real RPC', async () => {
      await page.locator('#calculator-nav').click();
      await page.locator('#calculator-animal').selectOption(animalId());
      await page.locator('#calculator-weight').fill('250');
      await page.locator('#calculator-baseline-date').fill(new Date().toISOString().slice(0,10));
      await page.locator('#calculator-gain').fill('0.75');
      await page.locator('#calculator-days').fill('30');
      await context.setOffline(true); offline = true;
      await page.locator('#calculator-save-forecast').click();
      const s = await until(page, `state.outbox.some(op => op.action === 'forecast.create' && op.state === 'pending')`);
      forecastOperation = s.outbox.find(op => op.action === 'forecast.create' && op.state === 'pending');
      offline = false; await context.setOffline(false);
      const op = await confirmed(page, forecastOperation.id);
      const after = await until(page, `state.forecasts.some(forecast => forecast.id === ${JSON.stringify(forecastOperation.entityId)})`);
      const forecast = after.forecasts.find(item => item.id === forecastOperation.entityId);
      assert.equal(forecast.predictedWeight, 272.5);
      return {operationId:op.id, forecastId:forecast.id, predictedWeight:forecast.predictedWeight, receipt:op.receipt};
    });
    await check('D3 UI creates a real universal journey', async () => {
      await page.locator('#journeys-nav').click();
      await page.locator('#new-journey-button').click();
      await page.locator('#journey-type').selectOption('bath');
      await page.locator('#journey-notes').fill('Browser integration ' + fixture.runId);
      await page.locator('#start-journey-button').click();
      const s = await until(page, `state.outbox.some(op => op.action === 'journey.create')`);
      const pending = s.outbox.find(op => op.action === 'journey.create'); journeyId = pending.entityId;
      const op = await confirmed(page, pending.id);
      await until(page, `state.journeys.some(journey => journey.id === ${JSON.stringify(journeyId)})`);
      return {journeyId, operationId:op.id, receipt:op.receipt};
    });
    await check('D3 UI attendance and finish create exactly one history event', async () => {
      await page.locator(`[data-open-journey="${journeyId}"]`).first().click();
      await page.locator(`[data-toggle-attendance="${animalId()}"]`).click();
      const s = await until(page, `state.outbox.some(op => op.action === 'journey.attend' && op.entityId === ${JSON.stringify(journeyId)})`);
      const attend = s.outbox.find(op => op.action === 'journey.attend' && op.entityId === journeyId);
      await confirmed(page, attend.id);
      await until(page, `state.journeys.find(journey => journey.id === ${JSON.stringify(journeyId)})?.roster.some(animal => animal.id === ${JSON.stringify(animalId())} && animal.attended)`);
      await page.locator('[data-finish-journey]').click();
      const finishing = await until(page, `state.outbox.some(op => op.action === 'journey.finish' && op.entityId === ${JSON.stringify(journeyId)})`);
      const finish = finishing.outbox.find(op => op.action === 'journey.finish' && op.entityId === journeyId);
      const op = await confirmed(page, finish.id);
      const after = await until(page, `state.events.filter(event => event.journeyId === ${JSON.stringify(journeyId)}).length === 1`);
      assert(['completed','incomplete'].includes(after.journeys.find(journey => journey.id === journeyId).status));
      await screenshot('05-journey-finished');
      return {journeyId, attendOperationId:attend.id, finishOperationId:op.id, receipt:op.receipt, historyEvents:after.events.filter(event => event.journeyId === journeyId)};
    });
  }

  await check('Independent clean browser login sees the committed remote state', async () => {
    const freshContext = await makeContext();
    try {
      const freshPage = await freshContext.newPage(); await login(freshPage);
      const s = await snap(freshPage);
      assert.equal(s.outbox.length, 0, 'Clean browser unexpectedly inherited another browser queue');
      assert.deepEqual(s.canonicalPhotos.filter(photo => photo.primary).map(photo => photo.id), [secondPhoto]);
      const crop = s.canonicalPhotos.find(photo => photo.id === firstPhoto);
      assert.equal(crop.cropX,17); assert.equal(crop.cropY,81); assert.equal(crop.cropZoom,2.2);
      if (forecastOperation) assert.equal(s.forecasts.find(item => item.id === forecastOperation.entityId)?.predictedWeight,272.5);
      if (journeyId) assert.equal(s.events.filter(event => event.journeyId === journeyId).length,1);
      return {cleanIndexedDB:true, photoCrop:{x:crop.cropX,y:crop.cropY,zoom:crop.cropZoom}, primaryId:secondPhoto, originals:await assertOriginals(freshPage)};
    } finally {await freshContext.close();}
  });
  await check('Network evidence contains only local real services and confirmed RPCs', async () => {
    await Promise.all([...pendingResponses]);
    assert.equal(blocked.length,0, 'Application attempted an external request');
    assert.equal(pageErrors.length,0, 'Unhandled page errors occurred');
    const operations = network.filter(entry => entry.operation);
    assert(operations.length >= 2);
    assert(operations.every(entry => !entry.offline), 'Mutation attempted while browser was offline');
    assert(!network.some(entry => entry.offline && ['PATCH','PUT','DELETE'].includes(entry.method)), 'A legacy mutation was attempted while the backend was unreachable');
    assert(operations.every(entry => entry.status === 200 && ['applied','duplicate'].includes(entry.receipt?.status)), 'Real RPC did not confirm every UI operation');
    return {authRequests:network.filter(item => item.path.startsWith('/auth/')).length,
      restRequests:network.filter(item => item.path.startsWith('/rest/')).length,
      storageRequests:network.filter(item => item.path.startsWith('/storage/')).length,
      operations, pageErrors:0, externalRequests:0};
  });
}

(async () => {
  let failure;
  try {await main();} catch (error) {
    failure = safe(error.stack || error.message); console.error('FAIL', safe(error.message));
    if (page && fixture) {
      try {
        await fs.mkdir(OUT,{recursive:true,mode:0o700});
        await fs.writeFile(path.join(OUT,'failure-state.json'), safe(await snap(page)), {mode:0o600});
        // Never capture a partially filled authentication dialog.
        if (!(await page.locator('#account-dialog[open]').count())) await screenshot('failure');
      } catch (_) {}
    }
    process.exitCode = 1;
  } finally {
    await Promise.all([...pendingResponses]);
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    let commit;
    try {commit=execFileSync('git',['-C',ROOT,'rev-parse','HEAD'],{encoding:'utf8'}).trim();} catch (_) {}
    await fs.mkdir(OUT,{recursive:true,mode:0o700});
    const report={runId:fixture?.runId, generatedAt:new Date().toISOString(), status:failure?'failed':'passed',
      source:{repository:ROOT,commit,appSha256:sourceSha256,sdkVersion:'2.49.8',sdkSha256},
      target:{apiOrigin,disposable:fixture?.disposable,productionAccess:false},
      scope:{realUI:tests.some(item => item.name.startsWith('UI password login') && item.status === 'passed'),
        realAuth:network.some(item => item.path === '/auth/v1/token' && item.status === 200),
        realPostgREST:network.some(item => item.path.startsWith('/rest/v1/') && item.status === 200),
        realStorage:network.some(item => item.path.startsWith('/storage/v1/') && item.status === 200),cloudMocks:false,
        injectedHooks:'read-only local state and hashes',androidPhysicalDevice:false},
      tests,network,blocked,pageErrors,failure};
    await fs.writeFile(path.join(OUT,'report.json'),safe(report),{mode:0o600});
    console.log('REPORT',path.join(OUT,'report.json'));
  }
})();
