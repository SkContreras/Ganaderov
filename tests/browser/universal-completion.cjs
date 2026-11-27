// Real browser/IndexedDB/WebCrypto and production forms/outbox. Only transport is
// synthetic here; real Auth/PostgREST/Storage gates run in tests/integration.
const fs=require('node:fs/promises'), path=require('node:path'), http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'../..');
const OUT=process.env.UNIVERSAL_BROWSER_ARTIFACTS||path.join(require('node:os').tmpdir(),'ganaderov-universal-'+process.pid);
const USER='11111111-1111-4111-8111-111111111111', OWNER='22222222-2222-4222-8222-222222222222';
const remote=new Map(), receipts=new Map(), sent=[], uploads=[], tests=[], errors=[];
let server,browser,context,page,online=true,loseNext=false,origin;
const key=(kind,id)=>kind+':'+id;
async function rpc(name,args){
  assert(online,'Offline capture attempted RPC');
  if(name==='get_my_ranch_context')return {status:200,error:null,data:{status:'active',owner_id:OWNER,role:'owner',display_name:'Test owner',ranch_name:'Disposable fixture'}};
  if(name==='sync_read_entity')return {error:null,data:remote.get(key(args.p_kind,args.p_id))||{revision:0,data:null}};
  if(name==='sync_read_entities')return {error:null,data:args.p_entities.map(({kind,id})=>({kind,id,...(remote.get(key(kind,id))||{revision:0,data:null})}))};
  assert.equal(name,'sync_apply_operation');
  const op=structuredClone(args.p_operation); sent.push(op);
  if(receipts.has(op.operationId))return {error:null,data:{...receipts.get(op.operationId),status:'duplicate'}};
  const kind=op.action.split('.')[0], previous=remote.get(key(kind,op.entityId));
  if(!op.action.endsWith('.create'))assert.equal(op.baseRevision,previous?.revision??0,'Draft did not use its exact predecessor receipt');
  let data=previous?.data?structuredClone(previous.data):null;
  const c=op.changes;
  if(op.action==='animal.create')data={id:op.entityId,status:'Activo',internalId:'ANM-00001',createdAt:op.capturedAt,updatedAt:op.capturedAt,...c.fields};
  else if(op.action==='animal.update')Object.assign(data,c.fields);
  else if(['animal.archive','animal.restore'].includes(op.action))Object.assign(data,c);
  else if(op.action==='event.create')data={id:op.entityId,animalId:c.animalId,type:c.type,date:c.date,createdAt:op.capturedAt,weight:c.weight,label:c.product,notes:c.notes};
  else if(op.action==='event.update')Object.assign(data,c,Object.hasOwn(c,'product')?{label:c.product}:{});
  else if(op.action.endsWith('.delete'))data=null;
  else if(op.action==='config.update')data=c.config;
  else if(op.action==='journey.create')data={id:op.entityId,...c,status:'in_progress',createdAt:op.capturedAt,updatedAt:op.capturedAt,roster:c.animalIds.map(id=>({id,attended:false}))};
  else if(op.action==='journey.attend')Object.assign(data.roster.find(row=>row.id===c.animalId),{attended:true},Object.hasOwn(c,'weight')?{weight:c.weight}:{});
  else if(op.action==='journey.finish')data.status=data.roster.some(row=>!row.attended)?'incomplete':'completed';
  else if(op.action==='journey.resume')data.status='in_progress';
  else if(op.action==='photo.create')data={id:op.entityId,...c,createdAt:op.capturedAt,storagePath:OWNER+'/'+c.animalId+'/'+op.entityId};
  else throw Error('Unexpected action '+op.action);
  const revision=(previous?.revision||0)+1;
  remote.set(key(kind,op.entityId),{revision,data,parentId:c.animalId});
  const receipt={protocolVersion:1,operationId:op.operationId,status:'applied',revision,serverReceivedAt:new Date().toISOString(),code:'OK'};
  receipts.set(op.operationId,receipt);
  if(loseNext){loseNext=false;throw Error('Lost acknowledgement after commit');}
  return {error:null,data:receipt};
}
async function serve(req,res){
  try{
    const rel=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(rel==='config.js'){res.setHeader('Content-Type','application/javascript');res.end("window.GANADERO_CONFIG={supabaseUrl:'https://universal-synthetic.invalid',supabaseAnonKey:'synthetic',syncEventRpcV1:true,syncJourneyUniversalV1:true,syncBackgroundV1:false};");return;}
    const file=path.resolve(ROOT,rel);assert(file.startsWith(ROOT+path.sep));
    let body=await fs.readFile(file);
    if(rel==='index.html')body=Buffer.from(body.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/,''));
    if(rel==='app.js')body=Buffer.from(body.toString().replace(/\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/,'\n'+await fs.readFile(path.join(__dirname,'photo-d4-hooks.js'),'utf8')+'\n'));
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(body);
  }catch(_){res.writeHead(404);res.end();}
}
const call=(name,...args)=>page.evaluate(({name,args})=>window.__d4.call(name,...args),{name,args});
const queue=()=>page.evaluate(async()=>(await window.__d4.call('getAll','operationOutbox')).sort((a,b)=>(a.sequence||0)-(b.sequence||0)));
async function waitFor(predicate){await page.waitForFunction(predicate,undefined,{timeout:10000});}
async function check(name,fn){const started=Date.now();try{await fn();tests.push({name,status:'passed',milliseconds:Date.now()-started});console.log('PASS',name);}catch(error){tests.push({name,status:'failed',error:error.stack});throw error;}}
async function setup(){
  await page.goto(origin);await page.waitForFunction(()=>!!window.__d4);
  await page.evaluate(async({userId,ownerId})=>{await window.__d4.setup({userId,ownerId});window.__d4.state.syncing=true;},{userId:USER,ownerId:OWNER});
}
async function main(){
  await fs.mkdir(OUT,{recursive:true});server=http.createServer((req,res)=>void serve(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1320,height:1080},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.exposeBinding('__d4rpc',(_,name,args)=>rpc(name,args));
  await context.exposeBinding('__d4storage',(_,kind,bucket,name,extra)=>{assert(online);assert.equal(bucket,'animal-photos');assert.equal(kind,'upload');uploads.push({name,...extra});return {error:null};});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.type()==='confirm'?dialog.accept():dialog.type()==='prompt'?dialog.accept('Prueba de revisión'):dialog.dismiss());
  await setup();let animalId,journeyId,creation;
  await check('Actual animal form captures offline without mutating canonical inventory',async()=>{
    await context.setOffline(true);online=false;
    await page.locator('#add-animal-button').click();
    await page.locator('#animal-tag').fill('OFFLINE-001');
    await page.locator('#animal-name').fill('Cría pendiente');
    await page.locator('#animal-sex').selectOption('Hembra');
    await page.locator('#animal-save').click();
    await waitFor(()=>!document.querySelector('#animal-dialog').open&&window.__d4.state.animals.length===1);
    const rows=await queue();creation=rows.find(row=>row.operation.action==='animal.create');assert(creation);animalId=creation.operation.entityId;
    assert.equal((await call('getAll','animals')).length,0);assert.equal(creation.operation.baseRevision,null);
    assert.equal(Object.hasOwn(creation.operation.changes.fields,'internalId'),false);
    assert.equal(await page.locator('#stat-total').innerText(),'0');
    assert.match(await page.locator('#animal-rows').innerText(),/Pendiente de sincronizar/);
  });
  await check('Offline history/photo/journey depend on the new animal and durable predecessor receipts',async()=>{
    await page.evaluate(id=>window.__d4.show(id),animalId);
    await page.locator('[data-add-record="note"]').click();await page.locator('#record-fields textarea[name="notes"]').fill('Nacimiento registrado sin conexión');
    await page.locator('#record-form button[type="submit"]').click();
    await waitFor(()=>window.__d4.state.pendingEvents.length===1);
    await page.evaluate(id=>window.__d4.call('queueUniversal',[{action:'photo.create',id:crypto.randomUUID(),blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),changes:{animalId:id,name:'original.png',mime:'image/png',primary:true}}]),animalId);
    journeyId=await page.evaluate(()=>crypto.randomUUID());
    await call('queueUniversal',[{action:'journey.create',id:journeyId,changes:{type:'bath',date:new Date().toISOString().slice(0,10),animalIds:[animalId]}}]);
    await page.evaluate(id=>window.__d4.call('queueJourneyChange',window.__d4.state.journeys.find(row=>row.id===id),'journey.attend',{animalId:window.__d4.state.animals[0].id}),journeyId);
    await page.evaluate(id=>window.__d4.call('queueJourneyChange',window.__d4.state.journeys.find(row=>row.id===id),'journey.finish',{allowIncomplete:false}),journeyId);
    const rows=await queue();assert.equal(rows.length,6);assert.equal(sent.length,0);
    assert(rows.filter(row=>['event.create','photo.create','journey.create'].includes(row.operation.action)).every(row=>row.dependsOn.includes(creation.id)));
    const chain=rows.filter(row=>row.operation.action.startsWith('journey.'));
    assert.equal(chain[1].sealed,false);assert.equal(chain[1].baseOperationId,chain[0].id);assert.equal(chain[2].baseOperationId,chain[1].id);
    assert.equal((await call('getAll','events')).length,0);assert.equal((await call('getAll','journeys')).length,0);
    const raw=await page.evaluate(()=>window.__d4.raw('photoUploads'));assert.equal(raw.length,1);assert(raw[0].encrypted);
  });
  await check('Restart preserves every UUID and seals only after the lost acknowledgement is recovered',async()=>{
    const before=await queue();await context.setOffline(false);online=true;await setup();
    assert.deepEqual((await queue()).map(row=>row.operation),before.map(row=>row.operation));
    loseNext=true;await page.evaluate(()=>window.__d4.flush());
    let rows=await queue();assert.equal(rows.filter(row=>row.state==='confirmed').length,0);assert.equal(sent.length,1);
    assert.equal(rows.find(row=>row.id===creation.id).state,'pending');
    assert(rows.filter(row=>row.operation.action==='journey.attend'||row.operation.action==='journey.finish').every(row=>!row.sealed));
    await page.evaluate(()=>window.__d4.flushAfter(60000));rows=await queue();
    assert(rows.every(row=>row.state==='confirmed'));assert.equal(sent.filter(op=>op.operationId===creation.id).length,2);
    assert.deepEqual(sent[0],sent[1]);
    assert.deepEqual(rows.filter(row=>row.operation.action.startsWith('journey.')).map(row=>row.operation.baseRevision),[null,1,2]);
    assert.equal(uploads.length,1);assert.deepEqual(uploads[0].bytes,[137,80,78,71]);
    assert.equal((await call('getAll','animals')).length,0,'A receipt must not become a canonical snapshot');
  });
  await check('A failed dependency blocks its draft and cross-account originals cannot be delivered',async()=>{
    const id=await page.evaluate(()=>crypto.randomUUID());
    await call('queueUniversal',[{action:'animal.create',id,changes:{fields:{tag:'CONFLICT',sex:'Macho'}}},{action:'event.create',id:await page.evaluate(()=>crypto.randomUUID()),changes:{animalId:id,type:'bath',date:new Date().toISOString().slice(0,10)}}]);
    await page.evaluate(async()=>{const rows=await window.__d4.call('getAll','operationOutbox');const parent=rows.find(row=>row.state==='pending'&&row.operation.action==='animal.create');await window.__d4.call('put','operationOutbox',{...parent,state:'conflict',code:'REVIEW_REQUIRED'});});
    const count=sent.length;await page.evaluate(()=>window.__d4.flush());assert.equal(sent.length,count);
    const blocked=(await queue()).find(row=>row.state==='blocked');assert(blocked);assert.equal(blocked.code,'DEPENDENCY_REQUIRES_REVIEW');
    const foreign='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await page.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:foreign,ownerId:OWNER});
    assert.equal((await queue()).length,0);assert.equal((await call('getAll','photoUploads')).length,0);
  });
  await check('Expired cached permissions prevent new offline capture',async()=>{
    await setup();await context.setOffline(true);online=false;
    const before=(await queue()).length;
    await page.evaluate(()=>{const cache=JSON.parse(localStorage.getItem('ganadero-ranch-context:'+window.__d4.scope().userId));cache.verifiedAt=Date.now()-86400001;localStorage.setItem('ganadero-ranch-context:'+window.__d4.scope().userId,JSON.stringify(cache));});
    await assert.rejects(call('queueUniversal',[{action:'animal.create',id:await page.evaluate(()=>crypto.randomUUID()),changes:{fields:{tag:'EXPIRED',sex:'Macho'}}}]),/renovar el acceso/);
    assert.equal((await queue()).length,before);
  });
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(OUT,'offline-queue.png')});
}
(async()=>{let failure;try{await main();}catch(error){failure=error.stack;console.error(error.stack);process.exitCode=1;}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.mkdir(OUT,{recursive:true});await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({tests,errors,failure,scope:'Production Web forms/outbox; real IndexedDB/AES-GCM/WebLocks, synthetic transport'},null,2));}})();
