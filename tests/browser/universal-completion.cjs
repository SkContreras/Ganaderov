// Real browser/IndexedDB/WebCrypto and production forms/outbox. Only transport is
// synthetic here; real Auth/PostgREST/Storage gates run in tests/integration.
const fs=require('node:fs/promises'), path=require('node:path'), http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'../..');
const OUT=process.env.UNIVERSAL_BROWSER_ARTIFACTS||path.join(require('node:os').tmpdir(),'ganaderov-universal-'+process.pid);
const USER='11111111-1111-4111-8111-111111111111', OWNER='22222222-2222-4222-8222-222222222222';
const remote=new Map(), receipts=new Map(), sent=[], uploads=[], tests=[], errors=[];
let server,browser,context,page,online=true,loseNext=false,origin,legacyRead=null,storageHandler=null,ranchReply=null;
const key=(kind,id)=>kind+':'+id;
async function rpc(name,args){
  assert(online,'Offline capture attempted RPC');
  if(name==='get_my_ranch_context')return ranchReply?ranchReply():{status:200,error:null,data:{status:'active',owner_id:OWNER,role:'owner',display_name:'Test owner',ranch_name:'Disposable fixture'}};
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
    if(rel==='app.js'){
      // Optional read-only source lets a focused regression exercise the prior
      // implementation without reverting files in the shared working tree.
      const source=process.env.UNIVERSAL_APP_SOURCE?await fs.readFile(process.env.UNIVERSAL_APP_SOURCE,'utf8'):body.toString();
      body=Buffer.from(source.replace(/\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/,'\n'+await fs.readFile(path.join(__dirname,'photo-d4-hooks.js'),'utf8')+'\n'));
    }
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(body);
  }catch(_){res.writeHead(404);res.end();}
}
const call=(name,...args)=>page.evaluate(({name,args})=>window.__d4.call(name,...args),{name,args});
const queue=()=>page.evaluate(async()=>(await window.__d4.call('getAll','operationOutbox')).sort((a,b)=>(a.sequence||0)-(b.sequence||0)));
async function waitFor(predicate){await page.waitForFunction(predicate,undefined,{timeout:10000});}
async function check(name,fn){if(process.env.UNIVERSAL_BROWSER_CASE&&!name.includes(process.env.UNIVERSAL_BROWSER_CASE))return;const started=Date.now();try{await fn();tests.push({name,status:'passed',milliseconds:Date.now()-started});console.log('PASS',name);}catch(error){tests.push({name,status:'failed',error:error.stack});throw error;}}
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
  await context.exposeBinding('__d4storage',(_,kind,bucket,name,extra)=>{assert(online);assert.equal(bucket,'animal-photos');if(storageHandler)return storageHandler(kind,name,extra);assert.equal(kind,'upload');uploads.push({name,...extra});return {error:null};});
  await context.exposeBinding('__d4legacyWrite',(_,request)=>{assert(legacyRead,'Unexpected legacy table request');return legacyRead(request);});
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
  await context.setOffline(false);online=true;
  await check('A delayed ranch configuration response cannot cross an account/database switch',async()=>{
    const scopeA={userId:'11111111-1111-4111-8111-111111111301',ownerId:'22222222-2222-4222-8222-222222222301'};
    const scopeB={userId:'11111111-1111-4111-8111-111111111302',ownerId:'22222222-2222-4222-8222-222222222302'};
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scopeA);
    const configA=await page.evaluate(()=>window.__d4.call('ranchAnimalFieldConfigPayload',window.__d4.state.fieldConfig));
    configA.fields.tag.label='PRIVATE CONFIG A';
    let entered,release;
    const reached=new Promise(resolve=>{entered=resolve;});
    const response=new Promise(resolve=>{release=resolve;});
    legacyRead=request=>{
      assert.equal(request.table,'ranch_animal_configs');
      assert.deepEqual(request.filters,[['owner_id',scopeA.ownerId]]);
      entered();return response;
    };
    const pending=call('syncAnimalFieldConfig').then(()=>({succeeded:true}),error=>({error:error.message}));
    await reached;
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scopeB);
    const configB=await page.evaluate(()=>window.__d4.call('ranchAnimalFieldConfigPayload',window.__d4.state.fieldConfig));
    configB.fields.tag.label='PRIVATE CONFIG B';
    const recordB={id:'animal-fields',ownerId:scopeB.ownerId,config:configB,revision:3,baseRevision:3,dirty:false};
    await call('put','ranchSettings',recordB);await call('refresh');
    release({data:{owner_id:scopeA.ownerId,config:configA,revision:1,updated_at:new Date().toISOString()},error:null});
    const result=await pending;legacyRead=null;
    assert.match(result.error||'',/sesión o el rancho cambió/i);
    assert.deepEqual(await call('getOne','ranchSettings','animal-fields'),recordB);
    assert.equal(await page.evaluate(()=>window.__d4.state.fieldConfig.fields.tag.label),'PRIVATE CONFIG B');
    assert.equal((await queue()).length,0);
  });
  await check('Stale settings and inline list forms cannot adopt another tab\'s configuration revision',async()=>{
    const scope={userId:USER,ownerId:'22222222-2222-4222-8222-222222222303'};
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scope);
    const base=await page.evaluate(()=>window.__d4.call('ranchAnimalFieldConfigPayload',window.__d4.state.fieldConfig));
    await call('put','ranchSettings',{id:'animal-fields',ownerId:scope.ownerId,config:base,revision:1,baseRevision:1,dirty:false});
    remote.set(key('config',scope.ownerId),{revision:1,data:structuredClone(base)});
    await call('refresh');await call('renderAnimalSettings');
    const sibling=await context.newPage();sibling.on('pageerror',error=>errors.push(error.message));
    try{
      await sibling.goto(origin);await sibling.waitForFunction(()=>!!window.__d4);
      await sibling.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scope);
      const first=structuredClone(base),stale=structuredClone(base);
      first.fields.tag.label='Arete de la primera pestaña';stale.fields.name.label='Nombre de la segunda pestaña';
      await sibling.evaluate(({ownerId,config})=>window.__d4.call('queueUniversal',[{action:'config.update',id:ownerId,changes:{config}}]),{ownerId:scope.ownerId,config:first});
      const captured=await queue();assert.equal(captured.length,1);
      await assert.rejects(call('persistAnimalFieldConfig',stale,'Should not save'),/cambio nuevo en otra pestaña/);
      assert.deepEqual((await queue()).map(row=>row.operation),captured.map(row=>row.operation));
      // The inline option editor has its own displayed config base, captured
      // when the animal form opens, and must reject the same unseen predecessor.
      await call('openAnimalForm');
      await call('createAnimalListOption','breed');
      assert.deepEqual((await queue()).map(row=>row.operation),captured.map(row=>row.operation));
      assert.match(await page.locator('#toast').innerText(),/cambio nuevo en otra pestaña/);
      await page.evaluate(()=>document.querySelector('#animal-dialog').close());
      // Now the other tab receives the canonical snapshot and settles its row.
      // The old form must not silently attach its full C0 payload to revision 2.
      await sibling.evaluate(()=>window.__d4.flush());
      const confirmed=remote.get(key('config',scope.ownerId));assert.equal(confirmed.revision,2);
      await sibling.evaluate(async({ownerId,config})=>{
        await window.__d4.call('put','ranchSettings',{id:'animal-fields',ownerId,config,revision:2,baseRevision:2,dirty:false});
        await window.__d4.call('cacheUniversalRevisions',window.__d4.scope());
      },{ownerId:scope.ownerId,config:confirmed.data});
      assert.equal((await queue())[0].settled,true);
      await assert.rejects(call('persistAnimalFieldConfig',stale,'Should not save'),/registro cambió mientras estaba abierto/);
      assert.equal((await queue()).length,1);
      assert.deepEqual((await call('getOne','ranchSettings','animal-fields')).config,first);
    }finally{await sibling.close();}
  });
  await check('A foreground original-byte collision becomes blocked without a fabricated server receipt',async()=>{
    const scope={userId:USER,ownerId:'22222222-2222-4222-8222-222222222304'};
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scope);
    const animal='33333333-3333-4333-8333-333333333304',photo='44444444-4444-4444-8444-444444444304';
    const original=[137,80,78,71,13,10,26,10,1,2,3],calls=[];
    await call('put','animals',{id:animal,status:'Activo',tag:'COLLISION',createdAt:new Date().toISOString()});await call('refresh');
    await page.evaluate(({photo,animal,original})=>window.__d4.call('queueUniversal',[{action:'photo.create',id:photo,
      changes:{animalId:animal,name:'original.png',mime:'image/png',primary:true},blob:new Blob([Uint8Array.from(original)],{type:'image/png'})}]),{photo,animal,original});
    const captured=(await queue())[0],before=sent.length;
    storageHandler=(kind,name,extra)=>{
      calls.push({kind,name});assert.equal(name,scope.ownerId+'/'+animal+'/'+photo);
      if(kind==='upload'){assert.deepEqual(extra.bytes,original);assert.equal(extra.options.upsert,false);return {error:{statusCode:'409',message:'The resource already exists'}};}
      assert.equal(kind,'download');return {bytes:[...original,99],mime:'image/png',error:null};
    };
    try{await page.evaluate(()=>window.__d4.flush());}finally{storageHandler=null;}
    const blocked=(await queue())[0];assert.equal(blocked.state,'blocked');assert.equal(blocked.code,'PHOTO_BYTES_CONFLICT');
    assert.equal(blocked.receipt,undefined);assert.deepEqual(blocked.operation,captured.operation);
    assert.equal(sent.length,before);assert.deepEqual(calls.map(row=>row.kind),['upload','download']);
    const preserved=await page.evaluate(async id=>{const row=await window.__d4.call('getOne','photoUploads',id);return {bytes:Array.from(new Uint8Array(await row.blob.arrayBuffer())),userId:row.userId,ownerId:row.ownerId};},captured.id);
    assert.deepEqual(preserved,{bytes:original,...scope});
    await page.evaluate(()=>window.__d4.flushAfter(60000));assert.equal(sent.length,before);
    assert.equal((await call('getAll','photos')).length,0);
  });
  await check('A bounded delivery run counts conflicts and transport failures toward its attempt limit',async()=>{
    const scope={userId:USER,ownerId:'22222222-2222-4222-8222-222222222305'};
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scope);
    await page.evaluate(()=>window.__d4.call('queueUniversal',Array.from({length:10},(_,index)=>({
      action:'animal.create',id:crypto.randomUUID(),changes:{fields:{tag:'BOUNDED-'+index}}}))));
    const captured=await queue();
    const result=await page.evaluate(async()=>{
      const {deliverUniversal}=await import('./sync/universal-outbox.mjs'),scope=window.__d4.scope(),attempted=[];
      const result=await deliverUniversal({...scope,limit:8,sendOperation:async operation=>{
        attempted.push(operation.operationId);
        if(attempted.length%2===0)throw Error('Synthetic transport failure');
        return {protocolVersion:1,operationId:operation.operationId,status:'conflict',revision:null,
          serverReceivedAt:new Date().toISOString(),code:'REVISION_CONFLICT'};
      }});
      return {result,attempted};
    });
    assert.equal(result.result.attempted,8);assert.equal(result.result.sent,0);
    assert.deepEqual(result.attempted,captured.slice(0,8).map(row=>row.id));
    const after=await queue();assert.equal(after.filter(row=>row.state==='conflict').length,4);
    assert(after.slice(0,8).every(row=>row.attempts===1));
    assert(after.slice(8).every(row=>row.state==='pending'&&row.attempts===0&&row.nextAt===0));
    assert.deepEqual(after.map(row=>row.operation),captured.map(row=>row.operation));
  });
  await check('Legacy recovery preserves unselected fields and original bytes when delivery/pull wins the reconciliation race',async()=>{
    const scope={userId:USER,ownerId:'22222222-2222-4222-8222-222222222306'};
    const animal='33333333-3333-4333-8333-333333333306',photo='44444444-4444-4444-8444-444444444306';
    const original=Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
    const local={id:animal,tag:'LEGACY-RACE',name:'Nombre local recuperable',color:'Color local recuperable',status:'Activo',createdAt:'2026-11-27T00:00:00Z',updatedAt:'2026-11-27T00:01:00Z'};
    const serverAnimal={...local,name:'Nombre del servidor',color:'Color del servidor',internalId:'ANM-00306',updatedAt:'2026-11-27T00:02:00Z'};
    remote.set(key('animal',animal),{revision:5,data:serverAnimal});
    const remoteRecord=()=>({animal_id:animal,modified_at:'2026-11-27T00:02:0'+remote.get(key('animal',animal)).revision+'Z',deleted_at:null,
      payload:{animal:structuredClone(remote.get(key('animal',animal)).data),events:[],photos:[],forecasts:[]}});
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scope);
    await page.evaluate(({local,photo,original})=>window.__d4.seed({animal:local,photos:[{id:photo,animalId:local.id,name:'legacy-original.png',mime:'image/png',primary:true,
      createdAt:'2026-11-27T00:01:00Z',cropX:50,cropY:50,cropZoom:1,bytes:original}]}),{local,photo,original});
    const snapshot=await page.evaluate(async({ownerId,animal,remote})=>{
      const local=JSON.parse(await window.__d4.call('bundleFingerprint',await window.__d4.call('getLocalBundle',animal)));
      const snapshot={id:'conflict:animal:'+animal,ownerId,kind:'animal',entityId:animal,base:null,local,
        remote:JSON.parse(await window.__d4.call('remoteFingerprint',remote)),version:remote.modified_at};
      await window.__d4.call('put','syncMeta',snapshot);return snapshot;
    },{ownerId:scope.ownerId,animal,remote:remoteRecord()});
    legacyRead=request=>{
      assert.equal(request.table,'animal_sync_records');
      assert.deepEqual(request.filters,[['owner_id',scope.ownerId],['animal_id',animal]]);
      return {data:remoteRecord(),error:null};
    };
    try{
      // Hold only the post-enqueue callback. The actual root prepare callback,
      // encrypted transaction and production recovery UI remain unchanged.
      await page.evaluate(()=>window.__d4.call(`async () => {
        const original = reconcileLegacyConflict;
        window.__legacyRace = {paused:false};
        reconcileLegacyConflict = async (...args) => {
          reconcileLegacyConflict = original;
          window.__legacyRace.paused = true;
          await new Promise(resolve => { window.__legacyRace.resume = resolve; });
          return original(...args);
        };
      }`));
      await page.evaluate(async snapshot=>{
        const module=await import('./sync/legacy-recovery.mjs');
        const dialog=document.createElement('dialog');dialog.id='legacy-race-review';document.body.append(dialog);
        await window.__d4.call('mountLegacyReview',dialog,window.__d4.scope(),module.conflictRecoverySource(snapshot));dialog.showModal();
      },snapshot);
      const review=page.locator('#legacy-race-review');
      await review.locator('[data-recovery-claim]').check();
      await review.getByRole('button',{name:'Comparar esta copia',exact:true}).click();
      const animalReview=review.locator(`[data-recovery-entry="animal:${animal}"]`);
      await animalReview.locator('summary').click();
      await animalReview.getByRole('button',{name:'Revisar con el servidor',exact:true}).click();
      await animalReview.locator('input[value="name"]').check();
      await animalReview.getByRole('button',{name:'Convertir selección a operaciones',exact:true}).click();
      await waitFor(()=>window.__legacyRace.paused);
      const captured=(await queue())[0];assert.equal(captured.operation.baseRevision,5);
      assert.deepEqual(captured.operation.changes,{fields:{name:local.name}});
      const linked=await call('getOne','syncMeta',snapshot.id);assert(linked.recoveryBackupId);
      const backupId=linked.recoveryBackupId;
      const backupsBefore=await page.evaluate(()=>window.__d4.raw('legacyRecovery'));
      assert.equal(backupsBefore.length,2);assert(backupsBefore.every(row=>row.encrypted));
      // Another sender can commit and install a fresh snapshot before the
      // original conversion callback resumes. This intentionally removes the
      // unuploaded photo from canonical storage, making the backup essential.
      await page.evaluate(()=>window.__d4.flush());
      assert.equal(remote.get(key('animal',animal)).revision,6);
      await page.evaluate(record=>window.__d4.importRemote(record),remoteRecord());
      await page.evaluate(async animal=>{
        await window.__d4.call('clearSyncConflict',window.__d4.scope(),'animal',animal);
        await window.__d4.call('cacheUniversalRevisions',window.__d4.scope());
      },animal);
      assert.equal((await call('getAll','photos')).length,0);
      assert.equal((await call('getOne','animals',animal)).color,'Color del servidor');
      assert.equal((await call('getOne','syncMeta',snapshot.id)).recoveryBackupId,backupId);
      await page.evaluate(()=>window.__legacyRace.resume());
      await waitFor(()=>document.querySelector('#legacy-race-review').textContent.includes('1 operación guardada.'));
      assert.doesNotMatch(await review.innerText(),/Falta actualizar la ficha/);
      assert((await call('getAll','syncMeta')).some(row=>row.id==='legacy-reconciled:'+backupId.slice('legacy-conflict:'.length)));
      // Review again from the preserved original and recover the other field.
      await review.getByRole('button',{name:'Comparar esta copia',exact:true}).click();
      await animalReview.locator('summary').click();
      await animalReview.getByRole('button',{name:'Revisar con el servidor',exact:true}).click();
      assert.equal(await animalReview.locator('input[value="name"]').count(),0);
      await animalReview.locator('input[value="color"]').check();
      await animalReview.getByRole('button',{name:'Convertir selección a operaciones',exact:true}).click();
      await waitFor(()=>document.querySelector('#legacy-race-review').textContent.includes('1 operación guardada.'));
      const second=(await queue()).find(row=>row.operation.changes.fields?.color===local.color);assert(second);
      assert.equal(second.operation.baseRevision,6);assert.notEqual(second.id,captured.id);
      // The photo's bytes are still available even though it is absent from
      // canonical photos and the first recovery has already been reconciled.
      const photoReview=review.locator(`[data-recovery-entry="photo:${photo}"]`);
      await photoReview.locator('summary').click();
      await photoReview.getByRole('button',{name:'Revisar con el servidor',exact:true}).click();
      await photoReview.locator('input[value="create"]').check();
      await photoReview.getByRole('button',{name:'Convertir selección a operaciones',exact:true}).click();
      await page.waitForFunction(photo=>document.querySelector(`[data-recovery-entry="photo:${photo}"]`).textContent.includes('1 operación guardada.'),photo);
      const pendingPhoto=(await queue()).find(row=>row.operation.action==='photo.create');assert(pendingPhoto);
      assert(pendingPhoto.dependsOn.includes(second.id));
      const saved=await page.evaluate(async({backupId,photo,attachment})=>{
        const backup=await window.__d4.call('getOne','legacyRecovery',backupId);
        const original=await window.__d4.call('getOne','legacyRecovery',backupId+':photo:'+photo);
        const upload=await window.__d4.call('getOne','photoUploads',attachment);
        return {snapshot:backup.source,original:Array.from(new Uint8Array(await original.blob.arrayBuffer())),upload:Array.from(new Uint8Array(await upload.blob.arrayBuffer()))};
      },{backupId,photo,attachment:pendingPhoto.attachmentId});
      assert.deepEqual(saved.snapshot,snapshot);assert.deepEqual(saved.original,original);assert.deepEqual(saved.upload,original);
      assert.equal((await call('getAll','photos')).length,0);
    }finally{
      legacyRead=null;
      await page.evaluate(()=>{window.__legacyRace?.resume?.();document.querySelector('#legacy-race-review')?.remove();});
    }
  });
  await check('Same scoped database restores offline inventory after a permission check cancels an in-flight refresh',async()=>{
    const scope={userId:USER,ownerId:'22222222-2222-4222-8222-222222222307'};
    const canonical='33333333-3333-4333-8333-333333333307',pending='33333333-3333-4333-8333-333333333308';
    const canonicalPhoto='44444444-4444-4444-8444-444444444307',pendingPhoto='44444444-4444-4444-8444-444444444308';
    const bytes=Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
    await page.evaluate(async scope=>{await window.__d4.setup(scope);window.__d4.state.syncing=true;},scope);
    await page.evaluate(({canonical,canonicalPhoto,bytes})=>window.__d4.seed({animal:{id:canonical,tag:'CANONICAL-OFFLINE',name:'Animal confirmado',status:'Activo',createdAt:'2026-11-27T00:00:00Z'},
      photos:[{id:canonicalPhoto,animalId:canonical,name:'confirmed.png',mime:'image/png',primary:true,createdAt:'2026-11-27T00:00:00Z',bytes}]}),{canonical,canonicalPhoto,bytes});
    await page.evaluate(({pending,pendingPhoto,bytes})=>window.__d4.call('queueUniversal',[
      {action:'animal.create',id:pending,changes:{fields:{tag:'DRAFT-OFFLINE',name:'Animal pendiente',status:'Activo'}}},
      {action:'photo.create',id:pendingPhoto,changes:{animalId:pending,name:'pending.png',mime:'image/png',primary:true},blob:new Blob([Uint8Array.from(bytes)],{type:'image/png'})}
    ]),{pending,pendingPhoto,bytes});
    const captured=(await queue()).map(row=>row.operation),sentBefore=sent.length,uploadsBefore=uploads.length;
    const before=await page.evaluate(()=>{
      const scope=window.__d4.scope();window.__offlineRestoreDatabase=scope.database;
      return {name:scope.database.name,cache:localStorage.getItem('ganadero-ranch-context:'+scope.userId),visible:window.__d4.state.animals.length,online:navigator.onLine};
    });
    assert.equal(before.visible,2);assert.equal(before.online,true);
    await call('clearPrivateView');
    await page.evaluate(()=>window.__d4.holdOldRefresh());
    let reached,release,loading;
    const started=new Promise(resolve=>{reached=resolve;});
    const response=new Promise(resolve=>{release=resolve;});
    const failure={status:0,error:{message:'TypeError: Failed to fetch',code:''},data:null};
    ranchReply=()=>{reached();return response;};
    try{
      loading=call('loadRanchContext').then(()=>({ok:true}),error=>({error:error.message}));
      await started;
      assert.equal(await page.evaluate(()=>window.__d4.state.ranchReady),false);
      await page.evaluate(()=>window.__d4.finishOldRefresh());
      assert.equal(await page.evaluate(()=>window.__d4.state.animals.length),0,'The older refresh must really have been invalidated');
      release(failure);
      const outcome=await loading;assert.equal(outcome.ok,true,outcome.error);
      const restored=await page.evaluate(async pendingPhoto=>{
        const scope=window.__d4.scope(),photo=window.__d4.state.photos.find(row=>row.id===pendingPhoto);
        return {name:scope.database.name,sameDatabase:scope.database===window.__offlineRestoreDatabase,
          ready:window.__d4.state.ranchReady,offline:window.__d4.state.ranchContextOffline,
          cache:localStorage.getItem('ganadero-ranch-context:'+scope.userId),
          canonical:window.__d4.state.confirmedAnimals.map(row=>row.id),
          displayed:window.__d4.state.animals.map(row=>({id:row.id,pending:Boolean(row._pending)})),
          photoBytes:photo?.blob?Array.from(new Uint8Array(await photo.blob.arrayBuffer())):null};
      },pendingPhoto);
      assert.equal(restored.ready,true);assert.equal(restored.offline,true);
      assert.equal(restored.name,before.name);assert.equal(restored.sameDatabase,true);
      assert.equal(restored.cache,before.cache,'Offline fallback must not renew authorization');
      assert.deepEqual(restored.canonical,[canonical]);
      assert.deepEqual(restored.displayed,[{id:canonical,pending:false},{id:pending,pending:true}]);
      assert.deepEqual(restored.photoBytes,bytes);
      assert.deepEqual((await queue()).map(row=>row.operation),captured);
      assert.equal(sent.length,sentBefore);assert.equal(uploads.length,uploadsBefore);
      assert.match(await page.locator('#animal-rows').innerText(),/CANONICAL-OFFLINE/);
      assert.match(await page.locator('#animal-rows').innerText(),/DRAFT-OFFLINE/);
      assert((await page.evaluate(()=>window.__d4.raw('photoUploads'))).every(row=>row.encrypted));
    }finally{release(failure);ranchReply=null;await loading;}
  });
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(OUT,'offline-queue.png')});
}
(async()=>{let failure;try{await main();}catch(error){failure=error.stack;console.error(error.stack);process.exitCode=1;}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.mkdir(OUT,{recursive:true});await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({tests,errors,failure,scope:'Production Web forms/outbox; real IndexedDB/AES-GCM/WebLocks, synthetic transport'},null,2));}})();
