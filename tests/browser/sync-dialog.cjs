// Actual dialog, IndexedDB, WebCrypto and production queue helpers. Transport is
// synthetic and restricted to loopback; no account or production service is used.
const fs=require('node:fs/promises'), path=require('node:path'), http=require('node:http');
const assert=require('node:assert/strict'), crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.resolve(process.env.SYNC_DIALOG_ARTIFACTS||path.join(require('node:os').tmpdir(),'ganaderov-sync-dialog-'+process.pid));
const USER='11111111-1111-4111-8111-111111111111', OWNER='22222222-2222-4222-8222-222222222222';
const OTHER='99999999-9999-4999-8999-999999999999', ANIMAL='33333333-3333-4333-8333-333333333333';
const stamp='2026-11-27T10:00:00.000Z', tests=[], errors=[], network=[];
const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const animal={id:ANIMAL,tag:'MX-012',name:'Luna',status:'Activo',createdAt:stamp,updatedAt:stamp};
let browser,context,page,server,origin,sourceSha256,fixtures,heldRead;
async function serve(req,res){
  try{
    const rel=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(rel==='config.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end("window.GANADERO_CONFIG={supabaseUrl:'https://sync-dialog-synthetic.invalid',supabaseAnonKey:'synthetic',syncEventRpcV1:true,syncJourneyUniversalV1:true,syncBackgroundV1:false};");return;}
    const file=path.resolve(ROOT,rel);assert(file.startsWith(ROOT+path.sep));let body=await fs.readFile(file);
    if(rel==='index.html')body=Buffer.from(body.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/,''));
    if(rel==='app.js'){
      const source=body.toString();sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
      body=Buffer.from(source.replace(/\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/,'\n'+await fs.readFile(path.join(__dirname,'photo-d4-hooks.js'),'utf8')+'\n'));
    }
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(body);
  }catch(_){res.writeHead(404);res.end();}
}
const call=(name,...args)=>page.evaluate(({name,args})=>window.__d4.call(name,...args),{name,args});
const row=id=>page.locator(`.sync-outbox-item[data-operation-id="${id}"]`);
async function check(name,fn){const started=Date.now();try{await fn();tests.push({name,status:'passed',milliseconds:Date.now()-started});console.log('PASS',name);}catch(error){tests.push({name,status:'failed',error:error.stack});throw error;}}
async function open(){await page.getByRole('button',{name:'Estado de cambios',exact:true}).click();await page.locator('#event-outbox-dialog').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelectorAll('.sync-outbox-item').length===6);}
async function main(){
  await fs.mkdir(OUT,{recursive:true});server=http.createServer((req,res)=>void serve(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block',acceptDownloads:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.exposeBinding('__d4rpc',async(_,name,args)=>{
    network.push({name,args});assert.equal(name,'sync_read_entity');
    if(heldRead){const gate=heldRead;heldRead=null;gate.entered();await gate.wait;}
    return {error:null,data:{revision:2,data:{...animal,name:'Luna del servidor'}}};
  });
  await context.exposeBinding('__d4storage',()=>{throw Error('Dialog must not upload, fetch or delete a Storage object');});
  await context.addInitScript(()=>{
    const added=document.addEventListener.bind(document),removed=document.removeEventListener.bind(document),listeners=new Set();
    document.addEventListener=(type,callback,...rest)=>{if(type==='ganaderov:sync-updated')listeners.add(callback);return added(type,callback,...rest);};
    document.removeEventListener=(type,callback,...rest)=>{if(type==='ganaderov:sync-updated')listeners.delete(callback);return removed(type,callback,...rest);};
    window.__syncDialogListenerCount=()=>listeners.size;
  });
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.waitForFunction(()=>!!window.__d4);
  await page.evaluate(async({userId,ownerId,animal,bytes,stamp,other})=>{
    await window.__d4.setup({userId,ownerId});window.__d4.state.syncing=true;
    await window.__d4.seed({animal,photos:[]});
    const make=(action,entityId,changes,state,extra={})=>{
      const id=crypto.randomUUID(),operation={protocolVersion:1,operationId:id,ownerId,deviceId:crypto.randomUUID(),entityId,action,changes,baseRevision:1,capturedAt:stamp};
      return {id,userId,ownerId,operation,state,createdAt:stamp,sequence:1,attempts:0,settled:false,photoSettled:false,
        ...(state==='confirmed'?{receipt:{protocolVersion:1,operationId:id,status:'applied',revision:2,serverReceivedAt:stamp,code:'OK'}}:{}),...extra};
    };
    const rows={
      photoDone:make('photo.crop',crypto.randomUUID(),{animalId:animal.id,cropX:30,cropY:70,cropZoom:2},'confirmed',{photoSettled:true,settled:false}),
      photoWaiting:make('photo.primary',crypto.randomUUID(),{animalId:animal.id,previousPrimaryId:null},'confirmed'),
      animalDone:make('animal.update',animal.id,{fields:{name:'Luna'}},'confirmed',{settled:true}),
      pending:make('animal.create',crypto.randomUUID(),{fields:{name:'Lucero',tag:'MX-013'}},'pending',{baseRevision:null}),
      original:make('photo.create',crypto.randomUUID(),{animalId:animal.id,name:'original.png',mime:'image/png',primary:false},'blocked',{code:'PHOTO_BYTES_CONFLICT'}),
      conflict:make('animal.update',animal.id,{fields:{name:'Luna local'}},'conflict',{code:'REVISION_CONFLICT'})
    };
    for(const entry of Object.values(rows))await window.__d4.call('put','operationOutbox',entry);
    await window.__d4.call('put','photoUploads',{id:rows.original.id,userId,ownerId,blob:new Blob([Uint8Array.from(bytes)],{type:'image/png'})});
    for(const extra of [{userId:other},{ownerId:other}])await window.__d4.call('put','operationOutbox',make('animal.create',crypto.randomUUID(),{fields:{name:'PRIVATE-OTHER-SCOPE',tag:'PRIVATE'}},'pending',extra));
    window.__syncDialogFixtures=rows;
  },{userId:USER,ownerId:OWNER,animal,bytes:Array.from(original),stamp,other:OTHER});
  fixtures=await page.evaluate(()=>Object.fromEntries(Object.entries(window.__syncDialogFixtures).map(([key,value])=>[key,value.id])));
  await check('Real pending button opens the styled scoped dialog with readable animal labels',async()=>{
    await open();const dialog=page.locator('#event-outbox-dialog');
    assert(await dialog.evaluate(node=>node.classList.contains('modal')));
    const text=await dialog.locator('.sync-outbox-list').innerText();assert(!text.includes('PRIVATE-OTHER-SCOPE'));
    assert.match(text,/Luna · Arete MX-012/);assert.match(text,/Añadir animal/);assert.match(text,/Añadir fotografía/);
    const headings=await dialog.locator('.sync-outbox-item-heading').allInnerTexts();
    assert(!headings.some(text=>/animal\.update|animal\.create|photo\.create|[0-9a-f]{8}-[0-9a-f-]{27,}/.test(text)));
    assert.equal(await page.evaluate(()=>window.__syncDialogListenerCount()),1);
  });
  await check('Confirmed photos use photoSettled while other entities use settled',async()=>{
    assert.equal(await row(fixtures.photoDone).locator('.sync-outbox-badge').innerText(),'Confirmada');
    assert(!/actualizando/i.test(await row(fixtures.photoDone).innerText()));
    assert.equal(await row(fixtures.photoWaiting).locator('.sync-outbox-badge').innerText(),'Actualizando ficha');
    assert.equal(await row(fixtures.animalDone).locator('.sync-outbox-badge').innerText(),'Confirmada');
  });
  await check('A real refresh updates receipt status without rebuilding recovery or review choices',async()=>{
    await page.locator('[data-recovery-claim]').check();
    await row(fixtures.conflict).getByRole('button',{name:'Comparar y resolver',exact:true}).click();
    const selection=page.locator('.sync-outbox-resolution input[type=checkbox]').first();await selection.check();
    await page.evaluate(()=>{window.__syncDialogNodes={claim:document.querySelector('[data-recovery-claim]'),choice:document.querySelector('.sync-outbox-resolution input[type=checkbox]')};});
    await page.evaluate(async()=>{const row=window.__syncDialogFixtures.photoWaiting;await window.__d4.call('put','operationOutbox',{...row,photoSettled:true,settled:false});await window.__d4.call('refresh');});
    await page.waitForFunction(id=>document.querySelector(`.sync-outbox-item[data-operation-id="${id}"] .sync-outbox-badge`)?.textContent==='Confirmada',fixtures.photoWaiting);
    assert(await page.locator('[data-recovery-claim]').isChecked());assert(await selection.isChecked());
    assert(await page.evaluate(()=>window.__syncDialogNodes.claim===document.querySelector('[data-recovery-claim]')&&window.__syncDialogNodes.choice===document.querySelector('.sync-outbox-resolution input[type=checkbox]')));
  });
  await check('Original download and reversible conflict archival remain available',async()=>{
    const pendingDownload=page.waitForEvent('download');await row(fixtures.original).getByRole('button',{name:'Descargar original',exact:true}).click();
    const download=await pendingDownload,downloaded=await fs.readFile(await download.path());assert.deepEqual(downloaded,original);
    await row(fixtures.original).getByRole('button',{name:'Archivar / conservar servidor',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector(`.sync-outbox-item[data-operation-id="${id}"] .sync-outbox-badge`)?.textContent==='Archivada',fixtures.original);
    await row(fixtures.original).getByRole('button',{name:'Recuperar para revisión',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector(`.sync-outbox-item[data-operation-id="${id}"] .sync-outbox-badge`)?.textContent==='Requiere atención',fixtures.original);
    assert(await page.locator('[data-recovery-claim]').isChecked());assert(await page.locator('.sync-outbox-resolution input[type=checkbox]').first().isChecked());
  });
  await check('The shared sync event releases a button disabled by an external busy sender',async()=>{
    const button=page.getByRole('button',{name:'Sincronizar ahora',exact:true});
    assert(await button.isDisabled());
    await page.evaluate(()=>{window.__d4.state.syncing=false;document.dispatchEvent(new CustomEvent('ganaderov:sync-updated'));});
    await page.waitForFunction(()=>!document.querySelector('#event-outbox-dialog .sync-outbox-footer .button-primary').disabled);
    assert(await button.isEnabled());
    await page.evaluate(()=>{window.__d4.state.syncing=true;document.dispatchEvent(new CustomEvent('ganaderov:sync-updated'));});
    await page.waitForFunction(()=>document.querySelector('#event-outbox-dialog .sync-outbox-footer .button-primary').disabled);
    await page.evaluate(()=>{window.__d4.state.syncing=false;document.dispatchEvent(new CustomEvent('ganaderov:sync-updated'));});
    await page.waitForFunction(()=>!document.querySelector('#event-outbox-dialog .sync-outbox-footer .button-primary').disabled);
    assert(await page.locator('[data-recovery-claim]').isChecked());
  });
  await check('Archival invalidates only its review panel and remote state updates cannot retain a stale editor',async()=>{
    const first=page.locator(`.sync-outbox-resolution[data-operation-id="${fixtures.conflict}"]`);
    await page.evaluate(async()=>{
      const entry=window.__syncDialogFixtures.animalDone;
      await window.__d4.call('put','operationOutbox',{...entry,state:'conflict',settled:false,code:'REVISION_CONFLICT'});
      await window.__d4.call('refresh');
    });
    await page.waitForFunction(id=>document.querySelector(`.sync-outbox-item[data-operation-id="${id}"] .sync-outbox-badge`)?.textContent==='Requiere revisión',fixtures.animalDone);
    await row(fixtures.animalDone).getByRole('button',{name:'Comparar y resolver',exact:true}).click();
    const second=page.locator(`.sync-outbox-resolution[data-operation-id="${fixtures.animalDone}"]`);
    await second.locator('input[type=checkbox]').first().check();
    await row(fixtures.conflict).getByRole('button',{name:'Comparar y resolver',exact:true}).click();
    assert.equal(await first.count(),1);assert(await first.locator('input[type=checkbox]').first().isChecked());
    await row(fixtures.conflict).getByRole('button',{name:'Archivar / conservar servidor',exact:true}).click();
    await first.waitFor({state:'detached'});assert(await second.locator('input[type=checkbox]').first().isChecked());
    assert(await page.locator('[data-recovery-claim]').isChecked());
    await page.evaluate(async()=>{
      const entry=window.__syncDialogFixtures.animalDone;
      await window.__d4.call('put','operationOutbox',{...entry,state:'archived',archivedFrom:'conflict'});
      await window.__d4.call('refresh');
    });
    await second.waitFor({state:'detached'});
    await page.evaluate(async()=>{
      for(const entry of [window.__syncDialogFixtures.conflict,window.__syncDialogFixtures.animalDone])await window.__d4.call('put','operationOutbox',entry);
      await window.__d4.call('refresh');
    });
    assert(await page.locator('[data-recovery-claim]').isChecked());
  });
  await check('Archiving while a review save awaits the server cannot enqueue a late correction',async()=>{
    await row(fixtures.conflict).getByRole('button',{name:'Comparar y resolver',exact:true}).click();
    const panel=page.locator(`.sync-outbox-resolution[data-operation-id="${fixtures.conflict}"]`);
    await panel.locator('input[type=checkbox]').first().check();
    const before=await call('getAll','operationOutbox');
    let release,entered;
    const reached=new Promise(resolve=>{entered=resolve;});
    heldRead={entered,wait:new Promise(resolve=>{release=resolve;})};
    try{
      await panel.getByRole('button',{name:'Crear operación de resolución',exact:true}).click();
      await Promise.race([reached,new Promise((_,reject)=>setTimeout(()=>reject(Error('Review save did not reach its guarded server read')),4000))]);
      await page.evaluate(async id=>{
        const entry=await window.__d4.call('getOne','operationOutbox',id);
        await window.__d4.call('put','operationOutbox',{...entry,state:'archived',archivedFrom:'conflict'});
        await window.__d4.call('refresh');
      },fixtures.conflict);
      await panel.waitFor({state:'detached'});
      release();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('La operación cambió.'));
      const after=await call('getAll','operationOutbox'),archived=after.find(entry=>entry.id===fixtures.conflict);
      assert.equal(after.length,before.length);assert.equal(archived.state,'archived');assert.equal(archived.resolvedBy,undefined);
      assert(!after.some(entry=>entry.resolves===fixtures.conflict));
      assert(await page.locator('[data-recovery-claim]').isChecked());
    }finally{release();heldRead=null;}
    await page.evaluate(async()=>{
      await window.__d4.call('put','operationOutbox',window.__syncDialogFixtures.conflict);
      await window.__d4.call('refresh');
      document.querySelector('#toast').classList.remove('visible');
    });
  });
  await check('Desktop and 390px layouts keep header, close and sync actions within the viewport',async()=>{
    for(const viewport of [{width:1280,height:960},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      await page.evaluate(()=>{document.querySelector('.sync-outbox-body').scrollTop=0;});
      await page.locator('#event-outbox-dialog').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
      const geometry=await page.locator('#event-outbox-dialog').evaluate(node=>{
        const box=node.getBoundingClientRect(),body=node.querySelector('.sync-outbox-body');
        return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:innerWidth,height:innerHeight,overflow:body.scrollWidth-body.clientWidth,
          footer:[...node.querySelectorAll('.sync-outbox-footer button')].map(button=>{const rect=button.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};})};
      });
      assert(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.top>=0&&geometry.bottom<=geometry.height+1,JSON.stringify(geometry));
      assert(geometry.overflow<=1,JSON.stringify(geometry));
      assert(geometry.footer.every(rect=>rect.left>=0&&rect.right<=geometry.width+1&&rect.top>=0&&rect.bottom<=geometry.height+1));
      await page.screenshot({path:path.join(OUT,viewport.width===390?'sync-dialog-mobile.png':'sync-dialog-desktop.png')});
    }
  });
  await check('A role downgrade closes privileged review and removes the live listener',async()=>{
    await call('setRanchContext',{status:'active',owner_id:OWNER,role:'worker'},true);await call('refresh');
    await page.locator('#event-outbox-dialog').waitFor({state:'detached'});
    assert.equal(await page.locator('[data-legacy-recovery]').count(),0);assert.equal(await page.evaluate(()=>window.__syncDialogListenerCount()),0);
  });
  await check('Changing account and database closes the old scoped dialog',async()=>{
    await call('setRanchContext',{status:'active',owner_id:OWNER,role:'owner'},true);await call('refresh');
    await open();
    await page.evaluate(async({userId,ownerId})=>{await window.__d4.setup({userId,ownerId});window.__d4.state.syncing=true;},{userId:OTHER,ownerId:OTHER});
    await page.locator('#event-outbox-dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.__syncDialogListenerCount()),0);
  });
  assert.deepEqual(errors,[]);assert(network.every(request=>request.name==='sync_read_entity'));
}
(async()=>{let failure;try{await main();}catch(error){failure=error.stack;console.error(error.stack);process.exitCode=1;await page?.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});}finally{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.mkdir(OUT,{recursive:true});
  await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({status:failure?'failed':'passed',tests,errors,failure,sourceSha256,scope:'Production Web dialog and actual encrypted IndexedDB; synthetic read-only transport, all external origins blocked'},null,2));
}})();
