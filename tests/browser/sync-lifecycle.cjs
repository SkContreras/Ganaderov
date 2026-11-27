// Chromium + the real initialize(), auth callbacks, IndexedDB and sync modules.
// Only Auth/RPC transport is synthetic and loopback-only. No production service
// or credential is used. The injected observer never replaces lifecycle logic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.env.SYNC_LIFECYCLE_ARTIFACTS || path.join(os.tmpdir(), 'ganaderov-sync-lifecycle-' + process.pid));
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '11111111-1111-4111-8111-222222222222';
const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER_OWNER = '22222222-2222-4222-8222-333333333333';
const LEAK_ID = '33333333-3333-4333-8333-333333333333';
const FALSE_ABORT = /La sesión o el rancho cambió durante la sincronización/;
const results = [];
let browser, server, origin, sourceHash, appSource;

const hooks = String.raw`
  const lifecycleNotices=[], lifecycleStatuses=[], lifecycleRuns=new Map(), lifecycleGuestSwitches=[];
  const originalLifecycleToast=showToast, originalLifecycleStatus=setSyncStatus;
  showToast=(message,...args)=>{lifecycleNotices.push(String(message));return originalLifecycleToast(message,...args);};
  setSyncStatus=(message)=>{lifecycleStatuses.push(String(message));return originalLifecycleStatus(message);};
  const originalLifecycleGuest=switchGuestDatabase;
  switchGuestDatabase=(...args)=>{lifecycleGuestSwitches.push({userId:currentUser?.id??null,generation:sessionGeneration});return originalLifecycleGuest(...args);};
  window.__syncLifecycle={
    initialized:false,
    start(label,kind='sync') {
      const run={done:false,error:null};
      lifecycleRuns.set(label,run);
      const action=kind==='context'?loadRanchContext:kind==='refresh'?refreshRanchContext:syncData;
      run.promise=Promise.resolve(action()).then(()=>{run.done=true;},error=>{run.done=true;run.error=error.message;});
    },
    wait(label){return lifecycleRuns.get(label).promise;},
    clearObservations(){lifecycleNotices.length=0;lifecycleStatuses.length=0;},
    snapshot(){return {
      userId:currentUser?.id,ownerId:state.ranchOwnerId,ready:state.ranchReady,
      offline:state.ranchContextOffline,syncing:state.syncing,requested:state.syncRequested,
      database:db?.name,generation:sessionGeneration,
      notices:[...lifecycleNotices],statuses:[...lifecycleStatuses],guestSwitches:[...lifecycleGuestSwitches],
      runs:Object.fromEntries([...lifecycleRuns].map(([id,run])=>[id,{done:run.done,error:run.error}])),
      cache:localStorage.getItem('ganadero-ranch-context:'+currentUser?.id),
      animalIds:state.animals.map(animal=>animal.id)
    };},
    async storedAnimals(){return (await getAll('animals')).map(animal=>animal.id);},
    async seed(animal){await put('animals',animal);await refresh();},
    async observeRanch(ownerId){
      setRanchContext({status:'active',owner_id:ownerId,role:'owner',display_name:'Synthetic owner',ranch_name:'Synthetic ranch'},true);
      await switchRanchDatabase(ownerId);
    }
  };
  window.__syncLifecycle.ready=initialize().then(()=>{window.__syncLifecycle.initialized=true;});
`;

function gate(name, {repeat = false, response} = {}) {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {name, repeat, response, promise, release, calls: []};
}

const activeContext = ownerId => ({status: 200, error: null, data: {
  status: 'active', owner_id: ownerId, role: 'owner',
  display_name: 'Synthetic owner', ranch_name: 'Isolated lifecycle fixture'
}});
const emptyPage = () => ({status: 200, error: null, data: {
  protocolVersion: 1, status: 'ok', epoch: 'synthetic-lifecycle-epoch',
  head: 0, nextCursor: 0, hasMore: false, changes: []
}});
function animal(id, name = 'Local fixture') {
  return {id, name, tag: 'SYNTHETIC', status: 'Activo', internalId: 'ANM-00001',
    createdAt: '2026-11-27T10:00:00.000Z', updatedAt: '2026-11-27T10:00:00.000Z'};
}
function stalePage() {
  const reply = emptyPage();
  reply.data.head = reply.data.nextCursor = 1;
  reply.data.changes = [{revision: 1, kind: 'animal', entity_id: LEAK_ID, deleted: false,
    record: {owner_id: OWNER, animal_id: LEAK_ID, modified_at: '2026-11-27T10:00:00.000Z',
      deleted_at: null, payload: {animal: animal(LEAK_ID, 'Must not cross scope'), events: [], photos: [], forecasts: []}}}];
  return reply;
}

async function serve(req, res) {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html';
    if (rel === 'config.js') {
      res.writeHead(200, {'Content-Type': 'application/javascript', 'Cache-Control': 'no-store'});
      res.end(`window.GANADERO_CONFIG=${JSON.stringify({supabaseUrl: origin, supabaseAnonKey: 'synthetic-public-key',
        syncEventRpcV1: true, syncIncrementalV1: true, syncRpcOnlyV1: true, syncBackgroundV1: false})};`);
      return;
    }
    const target = path.resolve(ROOT, rel);
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    let body = await fs.readFile(target);
    if (rel === 'index.html') body = Buffer.from(body.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, ''));
    if (rel === 'app.js') {
      const initializer = /\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/;
      assert(initializer.test(appSource), 'Production initialize() entry point not found');
      body = Buffer.from(appSource.replace(initializer, '\n' + hooks + '\n'));
    }
    res.writeHead(200, {'Cache-Control': 'no-store', 'Content-Type': {
      '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
      '.css': 'text/css', '.svg': 'image/svg+xml'
    }[path.extname(target)] || 'application/octet-stream'});
    res.end(body);
  } catch (error) { res.writeHead(404); res.end('Isolated test asset unavailable: ' + error.message); }
}

async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Timed out: ' + label);
}

async function fixture({holdStartupPull = false, holdStartupSession = false} = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  const f = {context, gates: [], calls: [], errors: [], active: 0, maxActive: 0, contextReply: null};
  if (holdStartupPull) {
    f.startup = gate('sync_pull_changes');
    f.gates.push(f.startup);
  }
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await context.exposeBinding('__lifecycleRpc', async (_, name, args, actor) => {
    const call = {name, args: structuredClone(args), actor, started: Date.now()};
    f.calls.push(call); f.active++; f.maxActive = Math.max(f.maxActive, f.active);
    try {
      const held = f.gates.find(item => item.name === name && (item.repeat || !item.calls.length));
      if (held) { held.calls.push(call); await held.promise; }
      if (held?.response) return structuredClone(held.response);
      if (name === 'get_my_ranch_context') return structuredClone(f.contextReply || activeContext(actor === OTHER_USER ? OTHER_OWNER : OWNER));
      if (name === 'sync_pull_changes') return emptyPage();
      if (name === 'sync_read_entities') return {status: 200, error: null,
        data: args.p_entities.map(({kind, id}) => ({kind, id, revision: 0, data: null}))};
      throw Error('Unexpected synthetic RPC: ' + name);
    } finally { call.finished = Date.now(); f.active--; }
  });
  await context.addInitScript(({userId, holdSession}) => {
    const auth = window.__lifecycleAuth = {
      user: {id: userId, email: 'synthetic@example.invalid'}, callback: null,
      async emit(event, id = this.user?.id) {
        this.user = id ? {id, email: 'synthetic@example.invalid'} : null;
        await this.callback(event, this.user ? {user: this.user, access_token: 'synthetic'} : null);
      }
    };
    window.supabase = {createClient(url) { return {
      supabaseUrl: url,
      auth: {
        onAuthStateChange(callback) { auth.callback = callback; return {data: {subscription: {unsubscribe() {}}}}; },
        async getSession() {
          const requestedUser = auth.user;
          if (holdSession) {
            holdSession = false;
            await new Promise(resolve => { auth.releaseSession = resolve; });
          }
          return {error: null, data: {session: requestedUser ? {user: requestedUser, access_token: 'synthetic'} : null}};
        }
      },
      rpc(name, args) {
        const request = window.__lifecycleRpc(name, args, auth.user?.id);
        request.abortSignal = () => request;
        return request;
      },
      from(table) { throw Error('Legacy table access is outside this lifecycle fixture: ' + table); },
      storage: {from() { throw Error('Storage is outside this lifecycle fixture'); }}
    }; }};
  }, {userId: USER, holdSession: holdStartupSession});
  f.page = await context.newPage();
  f.page.on('pageerror', error => f.errors.push(error.message));
  await f.page.goto(origin);
  await f.page.waitForFunction(() => !!window.__syncLifecycle);
  if (holdStartupPull) await until(() => f.startup.calls.length === 1, 'initialization pull');
  else if (holdStartupSession) await f.page.waitForFunction(() => typeof window.__lifecycleAuth.releaseSession === 'function');
  else {
    await f.page.waitForFunction(() => window.__syncLifecycle.initialized);
    const state = await snapshot(f);
    assert.equal(state.ready, true, 'Real initialize() did not establish ranch access');
    assert.equal(state.ownerId, OWNER);
    assert.deepEqual(f.errors, []);
  }
  await reset(f);
  return f;
}

const snapshot = f => f.page.evaluate(() => window.__syncLifecycle.snapshot());
const start = (f, label, kind = 'sync') => f.page.evaluate(({label, kind}) => window.__syncLifecycle.start(label, kind), {label, kind});
const finish = (f, label) => f.page.evaluate(label => window.__syncLifecycle.wait(label), label);
async function reset(f) {
  f.calls.length = 0; f.maxActive = f.active;
  await f.page.evaluate(() => window.__syncLifecycle.clearObservations());
}
async function idle(f) {
  // A coalesced retry is scheduled by a zero-delay timer after the first cycle.
  // Require a stable idle observation across event-loop turns, not just that gap.
  for (let stable = 0; stable < 3;) {
    await f.page.waitForFunction(() => {
      const s = window.__syncLifecycle.snapshot();
      return !s.syncing && !s.requested && Object.values(s.runs).every(run => run.done);
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    const state = await snapshot(f);
    stable = !f.active && !state.syncing && !state.requested ? stable + 1 : 0;
  }
}
function assertNoFalseAbort(state) {
  assert(!state.notices.some(message => FALSE_ABORT.test(message)),
    'A second same-session trigger caused the screenshot toast: ' + JSON.stringify(state.notices));
  assert(!state.statuses.includes('Error de sincronización'), 'Same-session overlap aborted a valid cycle');
}
async function check(name, options, run) {
  if (process.env.SYNC_LIFECYCLE_CASE && !name.includes(process.env.SYNC_LIFECYCLE_CASE)) return;
  let f;
  const started = Date.now();
  try {
    f = await fixture(options);
    const detail = await run(f);
    assert.deepEqual(f.errors, [], 'Uncaught browser errors');
    results.push({name, status: 'passed', milliseconds: Date.now() - started, detail});
    console.log('PASS', name);
  } catch (error) {
    const state = f && await snapshot(f).catch(() => null);
    results.push({name, status: 'failed', error: error.stack, state, calls: f?.calls});
    console.error('FAIL', name, error.message);
    if (f) await f.page.screenshot({path: path.join(OUT, 'failure-' + results.length + '.png')}).catch(() => {});
  } finally {
    f?.gates.forEach(item => item.release());
    await f?.context.close();
  }
}

async function overlapping(f, {startup = false, trigger = 'sync'} = {}) {
  const pull = startup ? f.startup : gate('sync_pull_changes');
  if (!startup) {
    f.gates.push(pull);
    await start(f, 'first');
    await until(() => pull.calls.length === 1, 'first cycle waiting in RPC');
  }
  const contextGate = gate('get_my_ranch_context', {repeat: true});
  f.gates.push(contextGate);
  if (trigger === 'auth') {
    await f.page.evaluate(async () => {
      await window.__lifecycleAuth.emit('SIGNED_IN');
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  } else await start(f, 'second', trigger);
  // In the old implementation this second context RPC immediately sets ready
  // false while the first pull is still outstanding. Keep it suspended while
  // releasing that pull, making the false scope abort deterministic.
  pull.release();
  if (startup) await f.page.waitForFunction(() => window.__syncLifecycle.initialized);
  else await finish(f, 'first');
  const firstSettled = await snapshot(f);
  contextGate.release();
  if (trigger !== 'auth') await finish(f, 'second');
  await idle(f);
  assertNoFalseAbort(firstSettled);
  const final = await snapshot(f);
  assertNoFalseAbort(final);
  assert.equal(f.maxActive, 1, 'Overlapping triggers performed concurrent authorization/sync RPCs');
  assert.equal(final.ready, true);
  assert.equal(final.ownerId, OWNER);
  assert(final.statuses.includes('Sincronizado'), 'The valid cycle never completed');
  return {maximumConcurrentRpc: f.maxActive, calls: f.calls.map(call => call.name),
    completedCycles: final.statuses.filter(message => message === 'Sincronizado').length};
}

async function main() {
  // One immutable source snapshot per run also makes the baseline comparison
  // reproducible while another collaborator edits the shared working tree.
  appSource = await fs.readFile(process.env.SYNC_LIFECYCLE_APP_SOURCE || path.join(ROOT, 'app.js'), 'utf8');
  sourceHash = crypto.createHash('sha256').update(appSource).digest('hex');
  await fs.mkdir(OUT, {recursive: true});
  server = http.createServer((req, res) => { void serve(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']});

  await check('Two syncData calls coalesce without a false session/ranch abort', {}, f => overlapping(f));
  await check('Same-account Auth callback during real initialize does not abort its first sync',
    {holdStartupPull: true}, f => overlapping(f, {startup: true, trigger: 'auth'}));
  await check('Manual ranch refresh waits for the active sync instead of invalidating it', {},
    f => overlapping(f, {trigger: 'refresh'}));

  await check('One visible event performs one authorization and one sync cycle', {}, async f => {
    const held = gate('get_my_ranch_context', {repeat: true}); f.gates.push(held);
    await f.page.evaluate(() => {
      if (document.visibilityState !== 'visible') throw Error('Fixture must be visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await until(() => held.calls.length > 0, 'visibility authorization');
    held.release(); await idle(f);
    const state = await snapshot(f); assertNoFalseAbort(state);
    assert.equal(f.calls.filter(call => call.name === 'get_my_ranch_context').length, 1, 'Duplicated visibility listener or redundant preflight');
    assert.equal(f.calls.filter(call => call.name === 'sync_pull_changes').length, 1, 'One visible event started multiple sync cycles');
    assert.equal(f.maxActive, 1);
    return {contextCalls: 1, pullCalls: 1};
  });

  await check('Two concurrent context loads share one preflight', {}, async f => {
    const held = gate('get_my_ranch_context', {repeat: true}); f.gates.push(held);
    await start(f, 'context-one', 'context'); await start(f, 'context-two', 'context');
    await until(() => held.calls.length > 0, 'shared preflight');
    held.release(); await Promise.all([finish(f, 'context-one'), finish(f, 'context-two')]);
    assert.equal(held.calls.length, 1, 'Concurrent context loaders sent duplicate RPCs');
    assert.equal(f.maxActive, 1);
    assert.equal((await snapshot(f)).ready, true);
    return {contextCalls: held.calls.length};
  });

  await check('A real Auth account change rejects the old in-flight response', {}, async f => {
    const held = gate('sync_pull_changes', {response: stalePage()}); f.gates.push(held);
    await start(f, 'old-account'); await until(() => held.calls.length > 0, 'old account pull');
    const newContext = gate('get_my_ranch_context', {repeat: true}); f.gates.push(newContext);
    await f.page.evaluate(id => window.__lifecycleAuth.emit('SIGNED_IN', id), OTHER_USER);
    assert.equal((await snapshot(f)).userId, OTHER_USER);
    held.release(); await finish(f, 'old-account'); newContext.release();
    await idle(f);
    await f.page.waitForFunction(owner => window.__syncLifecycle.snapshot().ownerId === owner && window.__syncLifecycle.snapshot().ready, OTHER_OWNER);
    const state = await snapshot(f), stored = await f.page.evaluate(() => window.__syncLifecycle.storedAnimals());
    assert(!state.animalIds.includes(LEAK_ID)); assert(!stored.includes(LEAK_ID));
    assert(state.database.includes(OTHER_USER) && state.database.includes(OTHER_OWNER));
    return {userId: state.userId, ownerId: state.ownerId, staleResponseApplied: false};
  });

  await check('Rapid Auth sign-out then sign-in cannot run an old guest-database timer', {}, async f => {
    const held = gate('sync_pull_changes', {response: stalePage()}); f.gates.push(held);
    await start(f, 'before-logout'); await until(() => held.calls.length > 0, 'pre-logout pull');
    const newContext = gate('get_my_ranch_context', {repeat: true}); f.gates.push(newContext);
    await f.page.evaluate(async user => {
      await window.__lifecycleAuth.emit('SIGNED_OUT', null);
      await window.__lifecycleAuth.emit('SIGNED_IN', user);
    }, OTHER_USER);
    held.release(); await finish(f, 'before-logout'); newContext.release(); await idle(f);
    await f.page.waitForFunction(owner => window.__syncLifecycle.snapshot().ownerId === owner && window.__syncLifecycle.snapshot().ready, OTHER_OWNER);
    const state = await snapshot(f);
    assert.equal(state.userId, OTHER_USER); assert.equal(state.ownerId, OTHER_OWNER);
    assert(state.database.includes(OTHER_USER) && state.database.includes(OTHER_OWNER));
    assert(!state.animalIds.includes(LEAK_ID));
    assert.deepEqual(state.guestSwitches.filter(call => call.userId !== null), [],
      'A deferred logout switched to the guest database after a new account signed in');
    return {userId: state.userId, ownerId: state.ownerId, guestSwitchesAfterLogin: 0};
  });

  await check('A late initial getSession response cannot replace a newer Auth account',
    {holdStartupSession: true}, async f => {
      await f.page.evaluate(user => window.__lifecycleAuth.emit('SIGNED_IN', user), OTHER_USER);
      await f.page.waitForFunction(owner => window.__syncLifecycle.snapshot().ownerId === owner && window.__syncLifecycle.snapshot().ready, OTHER_OWNER);
      await f.page.evaluate(() => window.__lifecycleAuth.releaseSession());
      await f.page.waitForFunction(() => window.__syncLifecycle.initialized);
      await idle(f);
      const state = await snapshot(f);
      assert.equal(state.userId, OTHER_USER, 'A stale initial session overwrote the observed Auth account');
      assert.equal(state.ownerId, OTHER_OWNER);
      assert(state.database.includes(OTHER_USER) && state.database.includes(OTHER_OWNER));
      assertNoFalseAbort(state);
      return {userId: state.userId, ownerId: state.ownerId, staleSessionIgnored: true};
    });

  await check('An observed ranch change still rejects the old in-flight response', {}, async f => {
    const held = gate('sync_pull_changes', {response: stalePage()}); f.gates.push(held);
    await start(f, 'old-ranch'); await until(() => held.calls.length > 0, 'old ranch pull');
    await f.page.evaluate(owner => window.__syncLifecycle.observeRanch(owner), OTHER_OWNER);
    held.release(); await finish(f, 'old-ranch'); await idle(f);
    const state = await snapshot(f), stored = await f.page.evaluate(() => window.__syncLifecycle.storedAnimals());
    assert.equal(state.ownerId, OTHER_OWNER);
    assert(!state.animalIds.includes(LEAK_ID)); assert(!stored.includes(LEAK_ID));
    assert(state.database.includes(OTHER_OWNER));
    return {ownerId: state.ownerId, staleResponseApplied: false};
  });

  await check('HTTP 401 fails closed, preserves local data and releases the sync lock', {}, async f => {
    await f.page.evaluate(record => window.__syncLifecycle.seed(record), animal(LEAK_ID));
    assert((await snapshot(f)).cache, 'The test must begin with a verified cached membership');
    await reset(f);
    f.contextReply = {status: 401, data: null, error: {code: 'PGRST301', message: 'Synthetic JWT rejected'}};
    await start(f, 'unauthorized'); await finish(f, 'unauthorized'); await idle(f);
    const denied = await snapshot(f);
    assert.equal(denied.syncing, false); assert.equal(denied.ready, false);
    assert.equal(denied.offline, false); assert.equal(denied.ownerId, null); assert.equal(denied.cache, null);
    assert.deepEqual(denied.animalIds, []);
    assert((await f.page.evaluate(() => window.__syncLifecycle.storedAnimals())).includes(LEAK_ID), 'Authorization failure deleted durable local data');
    assert.deepEqual(f.calls.map(call => call.name), ['get_my_ranch_context'], 'A rejected membership still delivered or pulled data');
    f.contextReply = null;
    await start(f, 'authorized-again'); await finish(f, 'authorized-again'); await idle(f);
    assert.equal((await snapshot(f)).ready, true, 'A failed preflight left the sync mutex stuck');
    return {status: 401, remoteDataCallsWhileDenied: 0, localDataPreserved: true, retrySucceeded: true};
  });
}

main().catch(error => {
  results.push({name: 'harness', status: 'failed', error: error.stack});
  console.error(error);
}).finally(async () => {
  await fs.mkdir(OUT, {recursive: true});
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({sourceSha256: sourceHash,
    transport: 'synthetic-loopback-only', initialization: 'real production initialize', results}, null, 2));
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (!results.length || results.some(result => result.status === 'failed')) process.exitCode = 1;
});
