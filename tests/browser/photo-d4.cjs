// Browser regression for D4 using real IndexedDB, WebCrypto, Web Locks and the
// production service worker. Auth/RPC/storage are synthetic; all external URLs
// are blocked, and neither user accounts nor production services are accessed.
// Run: node tests/browser/photo-d4.cjs
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE_PATH, D4_BROWSER_ARTIFACTS.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT=path.resolve(__dirname,'../..');
const OUT=path.resolve(process.env.D4_BROWSER_ARTIFACTS || path.join(os.tmpdir(),'ganaderov-d4-'+process.pid));
const EXE=process.env.CHROMIUM_EXECUTABLE_PATH;
const USER='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const ANIMAL='33333333-3333-4333-8333-333333333333';
const P1='44444444-4444-4444-8444-444444444444';
const P2='55555555-5555-4555-8555-555555555555';
const stamp='2026-11-27T10:00:00.000Z';
const tests=[];
const pageErrors=[];
const rpcCalls=[];
const storageCalls=[];
let online=true,receiptMode='applied';
let remotePhotos=[];
const revisions=new Map([[P1,7],[P2,9]]);
const receipts=new Map();
let browser,server;
let sourceSha256;

async function test(name,fn) {
  const start=Date.now();
  try {const detail=await fn();tests.push({name,status:'passed',milliseconds:Date.now()-start,detail});console.log('PASS',name);}
  catch(error){tests.push({name,status:'failed',milliseconds:Date.now()-start,error:error.stack});console.error('FAIL',name,error.message);}
}
const config="window.GANADERO_CONFIG={supabaseUrl:'https://d4-synthetic.invalid',supabaseAnonKey:'synthetic',syncEventRpcV1:true,syncRpcOnlyV1:false,syncBackgroundV1:false};";
async function serve(req,res) {
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/config.js'){res.setHeader('Content-Type','application/javascript');res.end(config);return;}
    if(url.pathname==='/supabase-stub.js'){res.setHeader('Content-Type','application/javascript');res.end('// Synthetic Supabase bound by isolated test harness');return;}
    const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
    const target=path.resolve(ROOT,rel);
    if(!target.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
    let body=await fs.readFile(target);
    const mime={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[path.extname(target)]??'application/octet-stream';
    if(rel==='index.html')body=Buffer.from(body.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/,''));
    if(rel==='app.js'){
      const hooks=await fs.readFile(path.join(__dirname,'photo-d4-hooks.js'),'utf8');
      const source=body.toString();
      sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
      assert(source.match(/\s+initialize\(\);\s*\}\)\(\);?\s*$/),'App initialization hook not found');
      body=Buffer.from(source.replace(/\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/,'\n'+hooks+'\n'));
    }
    if(rel==='service-worker.js')body=Buffer.from(body.toString().replace(/const SUPABASE_SCRIPT = [^;]+;/,'const SUPABASE_SCRIPT = new URL("./supabase-stub.js",self.location.href).href;'));
    res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');res.end(body);
  }catch(error){res.writeHead(404);res.end('Local test asset unavailable');}
}
function photoData(photo){const {bytes,...data}=photo;return data;}
async function stubRpc(name,args) {
  rpcCalls.push({name,args:structuredClone(args),online});
  if(!online)throw Error('Synthetic offline: RPC prohibited');
  if(name==='sync_read_entity'){
    const photo=remotePhotos.find(p=>p.id===args.p_id);
    return {error:null,data:photo?{revision:revisions.get(photo.id),parentId:ANIMAL,data:photoData(photo)}:{revision:revisions.get(args.p_id)??1,parentId:ANIMAL,data:null}};
  }
  if(name==='sync_apply_operation'){
    const op=args.p_operation;
    if(receipts.has(op.operationId))return {error:null,data:{...receipts.get(op.operationId),status:'duplicate'}};
    const photo=remotePhotos.find(p=>p.id===op.entityId);
    if(receiptMode==='transport')throw Error('Synthetic lost acknowledgement');
    const mismatch=op.baseRevision!==revisions.get(op.entityId)||!photo;
    if(receiptMode==='conflict'||mismatch)return {error:null,data:{protocolVersion:1,operationId:op.operationId,status:'conflict',revision:null,serverReceivedAt:new Date().toISOString(),code:photo?'REVISION_CONFLICT':'ENTITY_NOT_AVAILABLE'}};
    if(op.action==='photo.crop')Object.assign(photo,op.changes);
    else if(op.action==='photo.primary')for(const p of remotePhotos){
      const changed=p.primary!==(p.id===op.entityId);
      p.primary=p.id===op.entityId;
      if(changed&&p.id!==op.entityId)revisions.set(p.id,revisions.get(p.id)+1);
    }
    else if(op.action==='photo.delete'){
      const wasPrimary=photo.primary;
      remotePhotos=remotePhotos.filter(p=>p.id!==op.entityId);
      if(wasPrimary&&remotePhotos.length){remotePhotos[0].primary=true;revisions.set(remotePhotos[0].id,revisions.get(remotePhotos[0].id)+1);}
    }
    else throw Error('Unexpected action '+op.action);
    const rev=(revisions.get(op.entityId)||0)+1;revisions.set(op.entityId,rev);
    const receipt={protocolVersion:1,operationId:op.operationId,status:'applied',revision:rev,serverReceivedAt:new Date().toISOString(),code:'OK'};
    receipts.set(op.operationId,receipt);
    if(receiptMode==='applied-then-lost')throw Error('Synthetic acknowledgement lost after server commit');
    return {error:null,data:receipt};
  }
  throw Error('Unexpected RPC: '+name);
}
async function main(){
  await fs.mkdir(OUT,{recursive:true});
  server=http.createServer((req,res)=>void serve(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(EXE?{executablePath:EXE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'allow'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.exposeBinding('__d4rpc',(_,name,args)=>stubRpc(name,args));
  await context.exposeBinding('__d4storage',(_,kind,bucket,name,extra)=>{
    storageCalls.push({kind,bucket,path:name});
    if(!online)throw Error('Synthetic offline storage prohibited');
    if(kind!=='download')throw Error('Unexpected storage mutation');
    const photo=remotePhotos.find(p=>p.storagePath===name);
    return photo?{bytes:photo.bytes,mime:photo.mime}:{error:{message:'Synthetic missing photo'}};
  });
  const page=await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(origin);
  await page.waitForFunction(()=>!!window.__d4);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  });
  await page.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=300;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#2c5f2d';ctx.fillRect(0,0,300,300);ctx.fillStyle='#efd6aa';ctx.fillRect(300,0,300,300);ctx.fillStyle='#c3423f';ctx.fillRect(120,60,360,180);
    return Array.from(new Uint8Array(await(await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer()));
  });
  const animal={id:ANIMAL,internalId:'ANM-00001',tag:'D4-001',name:'Foto sintética D4',sex:'Hembra',status:'Activo',createdAt:stamp,updatedAt:stamp};
  remotePhotos=[P1,P2].map((id,i)=>({id,animalId:ANIMAL,name:'synthetic-'+(i+1)+'.png',mime:'image/png',primary:i===0,createdAt:stamp,cropX:50,cropY:50,cropZoom:1,storagePath:`${OWNER}/${ANIMAL}/${id}`,bytes}));
  await page.evaluate(seed=>window.__d4.seed(seed),{animal,photos:remotePhotos});
  await page.evaluate(id=>window.__d4.show(id),ANIMAL);
  await test('Actual AES-GCM protected IndexedDB stores photo bytes',async()=>{
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    const raw=await page.evaluate(()=>window.__d4.raw('photos'));
    assert.equal(inspect.photos.length,2);assert.deepEqual(inspect.photos[0].blob.bytes,bytes);
    assert(raw.every(r=>r.encrypted&&!r.plainKeys.includes('blob')&&!r.plainKeys.includes('cropX')));
    return {bytes:bytes.length,raw};
  });
  await test('Download/cache revision before disconnect',async()=>{
    const revision=await page.evaluate(id=>window.__d4.call('photoPresentationRevision',window.__d4.state.photos.find(p=>p.id===id)),P1);
    assert.equal(revision,7);
    return {revision};
  });
  await test('Framing preview/reset do not enqueue until explicit Save; zoom enables both axes',async()=>{
    await page.locator('.detail-crop summary').click();
    await page.locator('[data-photo-crop="zoom"]').evaluate(el=>{el.value='2.2';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await page.locator('[data-photo-crop="x"]').isDisabled(),false);
    assert.equal(await page.locator('[data-photo-crop="y"]').isDisabled(),false);
    assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
    await page.locator('[data-reset-photo-crop]').click();
    assert.equal(await page.locator('[data-photo-crop="zoom"]').inputValue(),'1');
    assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
  });
  online=false;await context.setOffline(true);
  const callCount=rpcCalls.length;
  await test('Offline framing queues without network and keeps source bytes',async()=>{
    for(const [axis,value] of [['zoom','2.2'],['x','17'],['y','81']])await page.locator(`[data-photo-crop="${axis}"]`).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
    await page.locator('[data-save-photo-crop]').click();
    await page.waitForFunction(async id=>{const s=await window.__d4.inspect();return s.outbox.some(r=>r.state==='pending')&&s.display.find(p=>p.id===id)?.cropX===17;},P1,{timeout:4000});
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(rpcCalls.length,callCount,'offline save attempted a server read');
    const pending=inspect.outbox.filter(r=>r.state==='pending'&&r.operation.action==='photo.crop');
    assert.equal(pending.length,1);
    assert.equal(pending[0].operation.baseRevision,7);
    assert.equal(inspect.display.find(p=>p.id===P1).cropX,17);
    assert.equal(inspect.photos.find(p=>p.id===P1).cropX,50,'unconfirmed crop leaked into confirmed legacy photo');
    assert.deepEqual(inspect.photos.find(p=>p.id===P1).blob.bytes,bytes);
    return {operationId:pending[0].id};
  });
  // Real offline navigation is fulfilled by the production service worker's
  // CacheStorage strategy. Its SDK URL alone points to our local synthetic SDK.
  await page.reload();await page.waitForFunction(()=>!!window.__d4);
  await page.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
  await page.evaluate(id=>window.__d4.show(id),ANIMAL);await context.setOffline(true);
  await test('Restart with backend offline restores pending framing and encrypted bytes',async()=>{
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.display.find(p=>p.id===P1).cropX,17);
    assert.equal(inspect.display.find(p=>p.id===P1).cropZoom,2.2);
    assert.equal(inspect.outbox.filter(r=>r.state==='pending').length,1);
    assert.deepEqual(inspect.photos.find(p=>p.id===P1).blob.bytes,bytes);
    return {displayCrop:inspect.display.find(p=>p.id===P1).cropX};
  });
  await test('Second mutation on animal is blocked while first remains unresolved',async()=>{
    try{await page.evaluate(id=>window.__d4.call('choosePrimary',id),P2);}catch(error){}
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.outbox.filter(r=>r.state==='pending').length,1);
    assert.equal(inspect.display.find(p=>p.id===P1).primary,true);
  });
  await page.screenshot({path:path.join(OUT,'pending-crop.png'),fullPage:false});
  online=true;await context.setOffline(false);
  await test('Reconnect confirms same operation ID without storage mutation',async()=>{
    await page.evaluate(()=>window.__d4.flush());
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    const entry=inspect.outbox.find(r=>r.operation.action==='photo.crop');
    assert.equal(entry.state,'confirmed');assert.equal(entry.receipt.revision,8);
    assert(!storageCalls.some(r=>r.kind!=='download'));
    return {receipt:entry.receipt};
  });
  await test('Remote metadata pull preserves framed presentation and original bytes',async()=>{
    await page.evaluate(record=>window.__d4.importRemote(record),{animal_id:ANIMAL,modified_at:new Date().toISOString(),payload:{animal,events:[],photos:remotePhotos.map(photoData),forecasts:[]},deleted_at:null});
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.photos.find(p=>p.id===P1).cropX,17);
    assert.equal(inspect.display.find(p=>p.id===P1).cropZoom,2.2);
    assert.deepEqual(inspect.photos.find(p=>p.id===P1).blob.bytes,bytes);
  });
  await test('Verified canonical revision settles overlay and unlocks next edit at revision 8',async()=>{
    await page.evaluate(()=>window.__d4.cacheRevisions());
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.outbox.find(r=>r.operation.action==='photo.crop').photoSettled,true);
    assert.equal(await page.locator('[data-save-photo-crop]').isDisabled(),false);
    const rev=await page.evaluate(id=>window.__d4.call('photoPresentationRevision',window.__d4.state.photos.find(p=>p.id===id)),P1);
    assert.equal(rev,8);
    assert.equal(storageCalls.length,0,'Metadata-only pull downloaded already cached original');
  });
  await page.screenshot({path:path.join(OUT,'confirmed-crop.png'),fullPage:false});
  const second=await context.newPage();second.on('pageerror',error=>pageErrors.push(error.message));second.on('dialog',dialog=>dialog.accept());
  await second.goto(origin);await second.waitForFunction(()=>!!window.__d4);
  await second.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
  await second.evaluate(id=>window.__d4.show(id),ANIMAL);
  online=false;await context.setOffline(true);
  await test('Two tabs racing on one animal enqueue exactly one operation',async()=>{
    await Promise.all([
      page.evaluate(id=>window.__d4.call('savePhotoCrop',id,23,45,1.8),P1),
      second.evaluate(id=>window.__d4.call('choosePrimary',id),P2)
    ]);
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    const pending=inspect.outbox.filter(r=>r.state==='pending');
    assert.equal(pending.length,1);
    return {winningAction:pending[0].operation.action,baseRevision:pending[0].operation.baseRevision};
  });
  online=true;await context.setOffline(false);
  await page.evaluate(()=>window.__d4.flush());
  await page.evaluate(record=>window.__d4.importRemote(record),{animal_id:ANIMAL,modified_at:new Date().toISOString(),payload:{animal,events:[],photos:remotePhotos.map(photoData),forecasts:[]},deleted_at:null});
  await page.evaluate(()=>window.__d4.cacheRevisions());
  await second.close();
  online=false;await context.setOffline(true);
  await test('Offline pending delete retains source bytes and hides only target photo',async()=>{
    await page.evaluate(id=>window.__d4.call('deletePhoto',id),P2);
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.photos.length,2);
    assert.equal(inspect.display.some(p=>p.id===P2),false);
    assert.deepEqual(inspect.photos.find(p=>p.id===P2).blob.bytes,bytes);
    assert.equal(inspect.outbox.filter(r=>r.state==='pending'&&r.operation.action==='photo.delete').length,1);
  });
  const changed=remotePhotos.find(p=>p.id===P2);changed.cropX=88;revisions.set(P2,revisions.get(P2)+1);
  online=true;await context.setOffline(false);
  await test('Remote crop vs queued delete becomes explicit conflict and never removes bytes',async()=>{
    await page.evaluate(()=>window.__d4.flush());await page.evaluate(id=>window.__d4.show(id),ANIMAL);
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    const entry=inspect.outbox.find(r=>r.operation.action==='photo.delete');
    assert.equal(entry.state,'conflict');assert.equal(entry.code,'REVISION_CONFLICT');
    assert.equal(inspect.display.some(p=>p.id===P2),true);
    assert.equal(remotePhotos.find(p=>p.id===P2).cropX,88);
    assert.equal(await page.locator('[data-save-photo-crop]').isDisabled(),true);
    assert(!storageCalls.some(r=>r.kind!=='download'));
    return {conflictId:entry.id};
  });
  await page.screenshot({path:path.join(OUT,'delete-conflict.png'),fullPage:false});
  await test('Archiving photo conflict preserves intent for review and unlocks confirmed gallery',async()=>{
    await page.evaluate(async()=>{const s=await window.__d4.inspect();await window.__d4.archive(s.outbox.find(r=>r.operation.action==='photo.delete').id);});
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    const entry=inspect.outbox.find(r=>r.operation.action==='photo.delete');
    assert.equal(entry.state,'archived');assert.equal(entry.archivedFrom,'conflict');assert.equal(entry.operation.changes.animalId,ANIMAL);
    assert.equal(inspect.display.length,2);
    assert.equal(await page.locator('[data-save-photo-crop]').isDisabled(),false);
  });
  await page.evaluate(record=>window.__d4.importRemote(record),{animal_id:ANIMAL,modified_at:new Date().toISOString(),payload:{animal,events:[],photos:remotePhotos.map(photoData),forecasts:[]},deleted_at:null});
  await page.evaluate(()=>window.__d4.cacheRevisions());
  await test('Lost acknowledgement retries the immutable operation ID after restart and accepts duplicate',async()=>{
    online=false;await context.setOffline(true);
    await page.evaluate(id=>window.__d4.call('savePhotoCrop',id,31,62,2.6),P1);
    let snapshot=await page.evaluate(()=>window.__d4.inspect());
    const original=snapshot.outbox.find(r=>r.state==='pending');
    assert(original);
    const priorRevision=revisions.get(P1);
    receiptMode='applied-then-lost';online=true;await context.setOffline(false);
    await page.evaluate(()=>window.__d4.flush());
    snapshot=await page.evaluate(()=>window.__d4.inspect());
    let retry=snapshot.outbox.find(r=>r.id===original.id);
    assert.equal(retry.state,'pending');assert.equal(retry.code,'TRANSPORT_UNKNOWN');assert.equal(retry.attempts,1);
    assert.deepEqual(retry.operation,original.operation);
    assert.equal(revisions.get(P1),priorRevision+1);
    online=false;await context.setOffline(true);
    await page.reload();await page.waitForFunction(()=>!!window.__d4);
    await page.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
    snapshot=await page.evaluate(()=>window.__d4.inspect());retry=snapshot.outbox.find(r=>r.id===original.id);
    assert.deepEqual(retry.operation,original.operation);
    assert.equal(snapshot.display.find(p=>p.id===P1).cropX,31);
    receiptMode='applied';online=true;await context.setOffline(false);
    await page.evaluate(()=>window.__d4.flushAfter(31000));
    snapshot=await page.evaluate(()=>window.__d4.inspect());retry=snapshot.outbox.find(r=>r.id===original.id);
    assert.equal(retry.state,'confirmed');assert.equal(retry.receipt.status,'duplicate');assert.equal(retry.attempts,2);
    assert.equal(revisions.get(P1),priorRevision+1,'Duplicate was applied twice');
    return {operationId:original.id,attempts:retry.attempts,receipt:retry.receipt.status};
  });
  await page.evaluate(record=>window.__d4.importRemote(record),{animal_id:ANIMAL,modified_at:new Date().toISOString(),payload:{animal,events:[],photos:remotePhotos.map(photoData),forecasts:[]},deleted_at:null});
  await page.evaluate(()=>window.__d4.cacheRevisions());
  await page.evaluate(id=>window.__d4.show(id),ANIMAL);
  await test('Unpublished local photo is preserved offline and never invents a server revision',async()=>{
    online=false;await context.setOffline(true);
    const before=await page.evaluate(()=>window.__d4.inspect());
    await page.evaluate(bytes=>window.__d4.call('addPhotos',[new File([Uint8Array.from(bytes)],'new-offline.png',{type:'image/png'})]),bytes);
    let snapshot=await page.evaluate(()=>window.__d4.inspect());
    const added=snapshot.photos.find(p=>!before.photos.some(old=>old.id===p.id));
    assert(added);assert.deepEqual(added.blob.bytes,bytes);
    const callsBefore=rpcCalls.length;
    await page.evaluate(id=>window.__d4.call('savePhotoCrop',id,12,24,1.9),added.id);
    snapshot=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(snapshot.outbox.length,before.outbox.length);
    assert.equal(snapshot.photos.find(p=>p.id===added.id).cropX,50);
    assert.equal(snapshot.display.find(p=>p.id===added.id).cropX,50);
    assert.equal(rpcCalls.length,callsBefore);
    assert.match(await page.locator('#toast').innerText(),/Sincroniza esta fotografía una vez/);
    await page.evaluate(id=>window.__d4.call('remove','photos',id),added.id);
    await page.evaluate(id=>window.__d4.show(id),ANIMAL);
  });
  await test('Unsupported and oversized images are rejected before persistence',async()=>{
    const before=await page.evaluate(()=>window.__d4.inspect());
    await page.evaluate(()=>window.__d4.call('addPhotos',[new File(['GIF89a'],'invalid.gif',{type:'image/gif'})]));
    await page.evaluate(()=>window.__d4.call('addPhotos',[new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'})]));
    const snapshot=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(snapshot.photos.length,before.photos.length);
    assert.equal(snapshot.outbox.length,before.outbox.length);
  });
  await test('Different account/ranch cannot read prior photos or operations',async()=>{
    await page.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ownerId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.photos.length,0);assert.equal(inspect.outbox.length,0);assert.equal(inspect.display.length,0);
    await page.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
    assert.equal((await page.evaluate(()=>window.__d4.inspect())).photos.length,2);
  });
  online=true;await context.setOffline(false);
  await test('A remote pull waiting on the shared lock cannot overwrite a concurrent local edit',async()=>{
    const other=await context.newPage();
    other.on('pageerror',error=>pageErrors.push(error.message));
    await other.goto(origin);await other.waitForFunction(()=>!!window.__d4);
    await other.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
    await other.evaluate(()=>window.__d4.blockWrites());
    let localWrite,remoteInstall;
    try{
      localWrite=other.evaluate(async id=>{
        const animal=await window.__d4.call('getOne','animals',id);
        await window.__d4.call('put','animals',{...animal,name:'Concurrent local edit must survive',updatedAt:new Date().toISOString()});
      },ANIMAL);
      await page.waitForFunction(async()=>{
        const locks=await navigator.locks.query();
        return locks.pending.filter(lock=>lock.name==='ganaderov-protected:'+window.__d4.scope().database.name).length>=1;
      },{},{timeout:4000});
      remoteInstall=page.evaluate(record=>window.__d4.importRemote(record),{animal_id:ANIMAL,modified_at:new Date().toISOString(),payload:{animal:{...animal,name:'Remote snapshot'},events:[],photos:remotePhotos.map(photoData),forecasts:[]},deleted_at:null});
      await page.waitForFunction(async()=>{
        const locks=await navigator.locks.query();
        return locks.pending.filter(lock=>lock.name==='ganaderov-protected:'+window.__d4.scope().database.name).length>=2;
      },{},{timeout:4000});
      await other.evaluate(()=>window.__d4.unblockWrites());
      await localWrite;
      assert.equal(await remoteInstall,false,'Remote snapshot overwrote a local edit committed while it waited');
      const result=await page.evaluate(id=>window.__d4.call('getOne','animals',id),ANIMAL);
      assert.equal(result.name,'Concurrent local edit must survive');
    }finally{
      await other.evaluate(()=>window.__d4.unblockWrites()).catch(()=>{});
      await Promise.allSettled([localWrite,remoteInstall].filter(Boolean));
      await other.close();
    }
  });
  await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({browserVersion:browser.version(),sourceSha256,tests,pageErrors,rpcCalls,storageCalls},null,2));
  console.log(JSON.stringify({passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length,pageErrors,report:path.join(OUT,'report.json')}));
  if(tests.some(t=>t.status==='failed')||pageErrors.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
