// Browser regression for D4 using real IndexedDB, WebCrypto, Web Locks and the
// production service worker. Auth/RPC/storage are synthetic; all external URLs
// are blocked, and neither user accounts nor production services are accessed.
// Run: node tests/browser/photo-d4.cjs
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE_PATH, D4_BROWSER_ARTIFACTS.
// D4_APP_SOURCE and D4_LEGACY_REGRESSION_ONLY support a before/after regression
// against an unchanged published source file without reverting the checkout.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const {isDeepStrictEqual}=require('node:util');
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
  catch(error){
    tests.push({name,status:'failed',milliseconds:Date.now()-start,error:error.stack});console.error('FAIL',name,error.stack);
    const pages=browser?.contexts().flatMap(context=>context.pages())||[];
    const current=pages.at(-1);
    if(current&&!current.isClosed()){
      await current.screenshot({path:path.join(OUT,`failure-${tests.length}.png`),timeout:3000}).catch(()=>{});
      const state=await current.evaluate(()=>({
        active:document.activeElement?.outerHTML,
        dialogs:Array.from(document.querySelectorAll('dialog[open]'),dialog=>dialog.id),
        framing:document.querySelector('#photo-crop-frame')?.dataset,
        toast:document.querySelector('#toast')?.textContent
      })).catch(()=>null);
      if(state)await fs.writeFile(path.join(OUT,`failure-${tests.length}.json`),JSON.stringify(state,null,2));
    }
  }
}
async function waitForAsync(page,predicate,arg,timeout=4000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await page.evaluate(predicate,arg))return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Timed out awaiting the actual asynchronous browser condition');
}
async function framingState(page){
  return page.locator('#photo-crop-frame').evaluate(frame=>{
    const image=frame.querySelector('img'),box=frame.getBoundingClientRect();
    const crop={x:Number(frame.dataset.cropX),y:Number(frame.dataset.cropY),zoom:Number(frame.dataset.cropZoom)};
    const scale=Math.max(frame.clientWidth/image.naturalWidth,frame.clientHeight/image.naturalHeight)*crop.zoom;
    const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
    return {...crop,width:frame.clientWidth,height:frame.clientHeight,imageWidth:image.naturalWidth,imageHeight:image.naturalHeight,
      renderedWidth:width,renderedHeight:height,overflowX:width-frame.clientWidth,overflowY:height-frame.clientHeight,
      left:(frame.clientWidth-width)*crop.x/100,top:(frame.clientHeight-height)*crop.y/100,
      box:{x:box.x,y:box.y,width:box.width,height:box.height}};
  });
}
async function openFraming(page){
  if(!await page.locator('#photo-crop-dialog[open]').count())await page.locator('[data-edit-photo-crop]').click();
  await page.locator('#photo-crop-dialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>{
    const image=document.querySelector('#photo-crop-frame img');
    return image?.complete&&image.naturalWidth>0&&Number.isFinite(Number(image.closest('#photo-crop-frame').dataset.cropZoom));
  });
  await page.locator('#photo-crop-dialog').evaluate(async dialog=>{
    await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));
  });
}
async function setFraming(page,{x=50,y=50,zoom=1}={}){
  const frame=page.locator('#photo-crop-frame');
  await frame.focus();await page.keyboard.press('Home');
  for(let i=0;i<Math.round((zoom-1)*10);i++)await page.locator('[data-photo-zoom="in"]').click();
  await frame.focus();
  // Clamp first to an exact endpoint. Center-preserving floating-point zoom can
  // otherwise leave 49.99999999999998, which is valid UI metadata but unsuitable
  // for the established exact 17/81 persistence/interoperability fixture.
  const geometry=await framingState(page);
  for(const [wanted,overflow,decrease,increase] of [[x,geometry.overflowX,'ArrowRight','ArrowLeft'],[y,geometry.overflowY,'ArrowDown','ArrowUp']]){
    if(overflow<=0.001)continue;
    const fromLow=wanted<=50,edge=fromLow?decrease:increase,move=fromLow?increase:decrease;
    for(let i=0;i<10;i++)await page.keyboard.press('Shift+'+edge);
    const distance=fromLow?wanted:100-wanted;
    for(let i=0;i<Math.floor(distance/10);i++)await page.keyboard.press('Shift+'+move);
    for(let i=0;i<distance%10;i++)await page.keyboard.press(move);
  }
  const actual=await framingState(page);
  assert.equal(actual.x,x);assert.equal(actual.y,y);assert.equal(actual.zoom,zoom);
}
async function closeFraming(page){
  if(await page.locator('#photo-crop-dialog[open]').count())await page.keyboard.press('Escape');
  await page.locator('#photo-crop-dialog').waitFor({state:'hidden'});
}
function closeNumber(actual,expected,message,tolerance=0.15){
  assert(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} != ${expected}`);
}
async function pickerRegression(page,bytes){
  await test('Decorated photo selectors are keyboard buttons and show removable original previews',async()=>{
    const before=await page.evaluate(()=>window.__d4.inspect());
    try{
    await page.locator('#detail-dialog [data-close="detail-dialog"]').click();
    await page.locator('#add-animal-button').click();
    await page.locator('#animal-dialog').evaluate(async dialog=>{
      await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));
    });
    const picker=page.locator('button[data-select-photos="initial-photos"]');
    assert.equal(await picker.getAttribute('type'),'button');
    assert.match(await picker.innerText(),/Seleccionar fotografías/);
    await picker.scrollIntoViewIfNeeded();await picker.focus();
    assert.equal(await picker.evaluate(el=>document.activeElement===el),true);
    const selected=page.waitForEvent('filechooser',{timeout:10000});await picker.press('Enter');
    const chooser=await selected;
    assert.equal(chooser.isMultiple(),true);
    await chooser.setFiles([
      {name:'synthetic-one.png',mimeType:'image/png',buffer:Buffer.from(bytes)},
      {name:'synthetic-two.png',mimeType:'image/png',buffer:Buffer.from(bytes)}
    ]);
    assert.equal(await page.locator('#initial-photos-preview img').count(),2);
    assert.match(await picker.innerText(),/Cambiar selección/);
    assert.deepEqual(await page.locator('#initial-photos').evaluate(input=>Array.from(input.files,file=>file.name)),['synthetic-one.png','synthetic-two.png']);
    await page.screenshot({path:path.join(OUT,'photo-picker-desktop.png'),fullPage:false});
    await page.locator('[data-remove-initial-photo="0"]').click();
    assert.equal(await page.locator('#initial-photos-preview img').count(),1);
    assert.deepEqual(await page.locator('#initial-photos').evaluate(input=>Array.from(input.files,file=>file.name)),['synthetic-two.png']);
    // The native picker can issue cancel without changing its FileList. This
    // event must not clear already selected originals or the preview count.
    await page.locator('#initial-photos').dispatchEvent('cancel');
    assert.equal(await page.locator('#initial-photos-preview img').count(),1);
    assert.deepEqual(await page.locator('#initial-photos').evaluate(input=>Array.from(input.files,file=>file.name)),['synthetic-two.png']);
    await page.keyboard.press('Escape');
    await page.locator('#animal-dialog').waitFor({state:'hidden'});
    await page.evaluate(id=>window.__d4.show(id),ANIMAL);
    const galleryPicker=page.locator('button[data-select-photos="photo-input"]');
    assert.match(await galleryPicker.innerText(),/Añadir fotos/);
    await galleryPicker.focus();
    const rejected=page.waitForEvent('filechooser',{timeout:10000});await galleryPicker.press('Space');
    await (await rejected).setFiles({name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('JPEG'));
    const after=await page.evaluate(()=>window.__d4.inspect());
    assert.deepEqual(after.outbox,before.outbox);assert.deepEqual(after.photos,before.photos);
    return {selected:2,removed:1,nativeChooserOpenedByKeyboard:true};
    }finally{
      if(await page.locator('#animal-dialog[open]').count())await page.keyboard.press('Escape');
      await page.evaluate(id=>window.__d4.show(id),ANIMAL);
    }
  });
}
async function framingGestureRegression(page,bytes){
  await test('Mouse drag moves the framing, captures outside the frame and preserves original bytes',async()=>{
    try{
      await openFraming(page);await setFraming(page,{zoom:2});
      const before=await framingState(page),box=before.box;
      const start={x:box.x+box.width/2,y:box.y+box.height/2};
      await page.mouse.move(start.x,start.y);await page.mouse.down();
      await page.mouse.move(start.x+40,start.y-15,{steps:6});await page.mouse.up();
      const after=await framingState(page);
      closeNumber(after.x,50-4000/before.overflowX,'drag x');
      closeNumber(after.y,50+1500/before.overflowY,'drag y');
      assert.equal(await page.locator('#photo-dialog[open]').count(),0,'Dragging opened the original-image viewer');
      await page.screenshot({path:path.join(OUT,'framing-desktop.png'),fullPage:false});
      await page.mouse.move(start.x,start.y);await page.mouse.down();
      await page.mouse.move(box.x+box.width+300,box.y-200,{steps:6});await page.mouse.up();
      const clamped=await framingState(page);
      assert.equal(clamped.x,0);assert.equal(clamped.y,100);
      const stored=await page.evaluate(()=>window.__d4.inspect());
      assert.equal(stored.outbox.length,0);
      assert.equal(stored.photos.find(photo=>photo.id===P1).cropX,50);
      assert.deepEqual(stored.photos.find(photo=>photo.id===P1).blob.bytes,bytes);
      return {drag:{x:after.x,y:after.y},clamped:{x:clamped.x,y:clamped.y}};
    }finally{await closeFraming(page);}
  });
  await test('Wheel zoom preserves the focal point, clamps at 1–3 and only handles the editor frame',async()=>{
    try{
      await openFraming(page);await setFraming(page,{zoom:1.6});
      const before=await framingState(page),anchor={x:before.width*0.37,y:before.height*0.48};
      const source={x:(anchor.x-before.left)/before.renderedWidth,y:(anchor.y-before.top)/before.renderedHeight};
      await page.mouse.move(before.box.x+anchor.x,before.box.y+anchor.y);
      await page.mouse.wheel(0,-120);
      await page.waitForFunction(zoom=>Number(document.querySelector('#photo-crop-frame').dataset.cropZoom)>zoom,before.zoom);
      const after=await framingState(page);
      closeNumber((anchor.x-after.left)/after.renderedWidth,source.x,'wheel source x',0.005);
      closeNumber((anchor.y-after.top)/after.renderedHeight,source.y,'wheel source y',0.005);
      for(let i=0;i<6;i++)await page.mouse.wheel(0,-100000);
      await page.waitForFunction(()=>Number(document.querySelector('#photo-crop-frame').dataset.cropZoom)===3);
      for(let i=0;i<6;i++)await page.mouse.wheel(0,100000);
      await page.waitForFunction(()=>Number(document.querySelector('#photo-crop-frame').dataset.cropZoom)===1);
      await page.locator('#photo-crop-dialog h2').hover();await page.mouse.wheel(0,-120);
      await page.waitForFunction(()=>Number(document.querySelector('#photo-crop-frame').dataset.cropZoom)===1);
      assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
      return {zoom:after.zoom,focalPoint:source};
    }finally{await closeFraming(page);}
  });
  await test('Keyboard controls, Reset, Cancel and Escape keep previews separate from saved framing',async()=>{
    const original=await page.evaluate(()=>window.__d4.inspect());
    await openFraming(page);await setFraming(page,{x:17,y:81,zoom:2.2});
    await page.locator('[data-reset-photo-crop]').click();
    let crop=await framingState(page);
    assert.deepEqual({x:crop.x,y:crop.y,zoom:crop.zoom},{x:50,y:50,zoom:1});
    await setFraming(page,{x:31,y:64,zoom:1.7});
    await page.locator('#photo-crop-dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.locator('#photo-crop-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-edit-photo-crop]').evaluate(el=>el===document.activeElement),true,'Cancel did not restore editor-button focus');
    await openFraming(page);crop=await framingState(page);
    assert.deepEqual({x:crop.x,y:crop.y,zoom:crop.zoom},{x:50,y:50,zoom:1});
    await setFraming(page,{x:45,y:55,zoom:1.8});await closeFraming(page);
    const after=await page.evaluate(()=>window.__d4.inspect());
    assert.deepEqual(after.outbox,original.outbox);assert.deepEqual(after.photos,original.photos);
    assert.equal(await page.locator('[data-edit-photo-crop]').evaluate(el=>el===document.activeElement),true,'Escape did not restore editor-button focus');
  });
}
async function touchFramingRegression(origin,animal,photos){
  const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  await touchContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await touchContext.exposeBinding('__d4rpc',(_,name,args)=>stubRpc(name,args));
  await touchContext.exposeBinding('__d4storage',()=>{throw Error('Touch framing must never access Storage');});
  const touchPage=await touchContext.newPage();
  touchPage.on('pageerror',error=>pageErrors.push(error.message));
  const cdp=await touchContext.newCDPSession(touchPage);
  const dispatch=async(type,touchPoints=[])=>{
    await cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
    // Touch moves may be coalesced until the next rendering frame. Observe the
    // controller after browser delivery, not immediately after the CDP ACK.
    await touchPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  try{
    await touchPage.goto(origin);await touchPage.waitForFunction(()=>!!window.__d4);
    await touchPage.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
    await touchPage.evaluate(seed=>window.__d4.seed(seed),{animal,photos});
    await touchPage.evaluate(id=>window.__d4.show(id),ANIMAL);
    await test('Real browser touch pinch continues as a one-finger drag and cancels without a stuck pointer',async()=>{
      await openFraming(touchPage);await setFraming(touchPage,{zoom:1.5});
      const before=await framingState(touchPage),box=before.box;
      const center={x:box.x+box.width/2,y:box.y+box.height/2};
      const distance=box.width*0.12;
      const initial=[{id:1,x:center.x-distance,y:center.y},{id:2,x:center.x+distance,y:center.y}];
      await dispatch('touchStart',initial);
      const widened=initial.map((point,index)=>({...point,x:center.x+(index===0?-1:1)*distance*1.35+6,y:point.y+2}));
      await dispatch('touchMove',widened);
      const pinched=await framingState(touchPage);
      assert(pinched.zoom>before.zoom&&pinched.zoom<=3,'Pinch did not zoom');
      closeNumber(pinched.zoom,1.5*1.35,'pinch scale',0.08);
      // Chromium ends the contacts explicitly listed in touchEnd. Omitting a
      // contact from touchMove does not lift it; ending an empty list lifts all.
      await dispatch('touchEnd',[widened[1]]);
      const released=await framingState(touchPage);
      closeNumber(released.zoom,pinched.zoom,'lifting one finger changed zoom',0.001);
      closeNumber(released.x,pinched.x,'lifting one finger jumped x',0.1);
      const dragged={...widened[0],x:widened[0].x+10};
      await dispatch('touchMove',[dragged]);
      const afterDrag=await framingState(touchPage);
      closeNumber(afterDrag.zoom,released.zoom,'one-finger drag changed zoom',0.001);
      closeNumber(afterDrag.x,released.x-1000/released.overflowX,'one-finger drag x',0.7);
      await dispatch('touchCancel');
      const cancelled=await framingState(touchPage);
      const fresh={id:7,x:center.x,y:center.y};
      await dispatch('touchStart',[fresh]);
      await dispatch('touchMove',[{...fresh,x:fresh.x-8}]);await dispatch('touchEnd');
      const restarted=await framingState(touchPage);
      closeNumber(restarted.zoom,cancelled.zoom,'cancelled pointer corrupted next gesture',0.001);
      assert(restarted.x>cancelled.x,'A fresh drag did not work after pointercancel');
      assert.equal(await touchPage.locator('#photo-dialog[open]').count(),0);
      const snapshot=await touchPage.evaluate(()=>window.__d4.inspect());
      assert.equal(snapshot.outbox.length,0);assert.deepEqual(snapshot.photos[0].blob.bytes,photos[0].bytes);
      await touchPage.screenshot({path:path.join(OUT,'framing-mobile.png'),fullPage:false});
      await closeFraming(touchPage);
      return {pinchZoom:pinched.zoom,oneFingerX:afterDrag.x,originalBytes:photos[0].bytes.length};
    });
  }finally{await dispatch('touchCancel').catch(()=>{});await touchContext.close();}
}
async function staleFramingRegression(page,animal,photos){
  await test('A changed confirmed photograph blocks an older preview until Cancel and reopen',async()=>{
    try{
      await openFraming(page);await setFraming(page,{x:17,y:81,zoom:2.2});
      const changed=photos.map(photo=>photo.id===P1?{...photo,cropX:64,cropY:20,cropZoom:1.5}:photo);
      await page.evaluate(seed=>window.__d4.seed(seed),{animal,photos:changed});
      await page.evaluate(id=>window.__d4.show(id),ANIMAL);
      assert.equal(await page.locator('#photo-crop-dialog').isVisible(),true,'A refresh silently discarded the active preview');
      const preview=await framingState(page);
      assert.deepEqual({x:preview.x,y:preview.y,zoom:preview.zoom},{x:17,y:81,zoom:2.2});
      assert.equal(await page.locator('[data-save-photo-crop]').isDisabled(),true,'A stale preview could overwrite a newer confirmed photo');
      assert.match(await page.locator('#photo-crop-message').innerText(),/cambió mientras editabas/);
      assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
      await page.locator('#photo-crop-dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
      await openFraming(page);
      const current=await framingState(page);
      assert.deepEqual({x:current.x,y:current.y,zoom:current.zoom},{x:64,y:20,zoom:1.5});
      assert.equal(await page.locator('[data-save-photo-crop]').isDisabled(),false);
      assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
    }finally{
      await closeFraming(page);
      await page.evaluate(seed=>window.__d4.seed(seed),{animal,photos});
      await page.evaluate(id=>window.__d4.show(id),ANIMAL);
    }
  });
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
      const source=process.env.D4_APP_SOURCE?await fs.readFile(process.env.D4_APP_SOURCE,'utf8'):body.toString();
      sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
      assert(source.match(/\s+initialize\(\);\s*\}\)\(\);?\s*$/),'App initialization hook not found');
      body=Buffer.from(source.replace(/\s+initialize\(\);(?=\s*\}\)\(\);?\s*$)/,'\n'+hooks+'\n'));
    }
    if(rel==='service-worker.js')body=Buffer.from(body.toString().replace(/const SUPABASE_SCRIPT = [^;]+;/,'const SUPABASE_SCRIPT = new URL("./supabase-stub.js",self.location.href).href;'));
    res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');res.end(body);
  }catch(error){res.writeHead(404);res.end('Local test asset unavailable');}
}
function photoData(photo){const {bytes,...data}=photo;return data;}
async function stubRpc(name,args,{ranchResponse,probe}={}) {
  rpcCalls.push({name,args:structuredClone(args),online,...(probe?{probe}:{})});
  if(!online)throw Error('Synthetic offline: RPC prohibited');
  if(name==='get_my_ranch_context'&&ranchResponse!==undefined)return structuredClone(ranchResponse);
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
async function ranchCacheRegression(origin,animal) {
  // A distinct browser profile keeps its actual localStorage/IndexedDB isolated
  // from the photo concurrency suite above. Only server responses are synthetic.
  const authContext=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'allow'});
  await authContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const verifiedResponse={status:200,error:null,data:{status:'active',owner_id:OWNER,role:'owner',display_name:'D4 authorization fixture',ranch_name:'Offline authorization'}};
  const transportResponse={status:0,data:null,error:{message:'TypeError: Failed to fetch',code:''}};
  let response=verifiedResponse;
  await authContext.exposeBinding('__d4rpc',(_,name,args)=>stubRpc(name,args,{ranchResponse:response,probe:'ranch-cache'}));
  await authContext.exposeBinding('__d4storage',(_,kind,bucket,name)=>{
    storageCalls.push({kind,bucket,path:name,probe:'ranch-cache'});
    throw Error('Authorization-cache tests must not access Storage');
  });
  const authPage=await authContext.newPage();
  authPage.on('pageerror',error=>pageErrors.push(error.message));
  authPage.on('dialog',dialog=>dialog.dismiss());
  const inspect=()=>authPage.evaluate(()=>window.__d4.authorization());
  const refreshContext=()=>authPage.evaluate(()=>window.__d4.call('refreshRanchContext'));
  const assertClosed=(value,{ready=false}={})=>{
    assert.equal(value.ready,ready);assert.equal(value.offline,false);assert.equal(value.legacy,false);
    assert.equal(value.ownerId,null);assert.equal(value.role,null);
    assert.equal(value.access,false);assert.equal(value.manage,false);
    assert.deepEqual(value.displayPhotoIds,[]);assert.deepEqual(value.animalIds,[]);
    assert.equal(value.detailOpen,false);assert.equal(value.photoUrls,0);
  };
  let verifiedCache,scopedName,pendingId;
  const coldStart=async(cache,userId=USER)=>{
    await authPage.reload();await authPage.waitForFunction(()=>!!window.__d4);
    await authPage.evaluate(({userId,ownerId,cacheOwner,cache})=>{
      const key=`ganadero-ranch-context:${cacheOwner}`;
      if(cache===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(cache));
      if(userId!==cacheOwner)localStorage.removeItem(`ganadero-ranch-context:${userId}`);
      return window.__d4.setup({userId,ownerId,coldStart:true});
    },{userId,ownerId:OWNER,cacheOwner:USER,cache});
    const initial=await inspect();
    assertClosed(initial);assert.equal(initial.scope,'ganadero-local');
    assert.deepEqual(initial.storedPhotoIds,[]);
  };
  try{
    await authPage.goto(origin);await authPage.waitForFunction(()=>!!window.__d4);
    await authPage.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
    await authPage.evaluate(()=>window.__d4.call('loadRanchContext'));
    await authPage.evaluate(seed=>window.__d4.seed(seed),{animal,photos:remotePhotos});
    await authPage.evaluate(()=>window.__d4.cacheRevisions());
    const verified=await inspect();
    verifiedCache=JSON.parse(verified.cache);scopedName=verified.scope;
    assert.equal(verifiedCache.userId,USER);assert.equal(verifiedCache.context.owner_id,OWNER);
    assert.equal(verified.offline,false);assert(verifiedCache.verifiedAt>0);

    await test('Transport status 0 restores verified ranch cache with onLine true without extending its age',async()=>{
      response=transportResponse;await coldStart(verifiedCache);
      assert.equal(await refreshContext(),true);
      const restored=await inspect();
      assert.equal(restored.online,true);assert.equal(restored.ready,true);assert.equal(restored.offline,true);
      assert.equal(restored.ownerId,OWNER);assert.equal(restored.role,'owner');assert.equal(restored.access,true);
      assert.equal(restored.scope,scopedName);assert.deepEqual(restored.storedPhotoIds.sort(),[P1,P2].sort());
      assert.deepEqual(restored.displayPhotoIds.sort(),restored.storedPhotoIds.sort());
      assert.equal(restored.cache,JSON.stringify(verifiedCache));
      assert.equal(await authPage.evaluate(()=>Date.now()>JSON.parse(localStorage.getItem(`ganadero-ranch-context:${window.__d4.scope().userId}`)).verifiedAt),true);
      await authPage.evaluate(id=>window.__d4.show(id),ANIMAL);
      await authPage.screenshot({path:path.join(OUT,'ranch-cache-restored.png')});
      return {status:0,navigatorOnline:restored.online,verifiedAt:verifiedCache.verifiedAt,scope:restored.scope,photoCount:restored.storedPhotoIds.length};
    });
    await test('Cached authorization permits durable local crop but blocks syncData and outbox network delivery',async()=>{
      const callsBefore=rpcCalls.length,storageBefore=storageCalls.length;
      await authPage.evaluate(id=>window.__d4.call('savePhotoCrop',id,64,27,2.1),P1);
      let saved=await authPage.evaluate(()=>window.__d4.inspect());
      const pending=saved.outbox.filter(entry=>entry.state==='pending');
      assert.equal(pending.length,1);pendingId=pending[0].id;
      assert.equal(saved.display.find(photo=>photo.id===P1).cropX,64);
      assert.equal(rpcCalls.length,callsBefore,'Cached crop attempted a remote revision read');
      await authPage.evaluate(()=>window.__d4.call('syncData'));
      await authPage.evaluate(()=>window.__d4.flush());
      const calls=rpcCalls.slice(callsBefore);
      assert(calls.length>=1&&calls.every(call=>call.name==='get_my_ranch_context'));
      assert.equal(storageCalls.length,storageBefore);
      const authorization=await inspect();
      assert.deepEqual(authorization.tableAccesses,[],'Cache-authorized sync accessed remote tables');
      assert.equal(authorization.offline,true);assert.equal(authorization.cache,JSON.stringify(verifiedCache));
      saved=await authPage.evaluate(()=>window.__d4.inspect());
      const retained=saved.outbox.find(entry=>entry.id===pendingId);
      assert.equal(retained.state,'pending');assert.equal(retained.attempts,0);
      assert.deepEqual(saved.photos.find(photo=>photo.id===P1).blob.bytes,remotePhotos.find(photo=>photo.id===P1).bytes);
      return {operationId:pendingId,attempts:retained.attempts,allowedCalls:calls.map(call=>call.name),tableAccesses:0,storageAccesses:0};
    });
    await test('Fresh successful membership verification clears cache-only mode and releases the same queued UUID',async()=>{
      response=verifiedResponse;assert.equal(await refreshContext(),true);
      const authorized=await inspect();
      assert.equal(authorized.ready,true);assert.equal(authorized.offline,false);
      const renewed=JSON.parse(authorized.cache);assert(renewed.verifiedAt>verifiedCache.verifiedAt);
      const callsBefore=rpcCalls.length;
      await authPage.evaluate(()=>window.__d4.flush());
      const sent=rpcCalls.slice(callsBefore).filter(call=>call.name==='sync_apply_operation');
      assert.equal(sent.length,1);assert.equal(sent[0].args.p_operation.operationId,pendingId);
      const saved=await authPage.evaluate(()=>window.__d4.inspect());
      assert.equal(saved.outbox.find(entry=>entry.id===pendingId).state,'confirmed');
      verifiedCache=renewed;
      return {operationId:pendingId,verifiedAt:renewed.verifiedAt,cacheOnly:false};
    });

    for(const {status,code,message} of [
      {status:401,code:'PGRST301',message:'JWT authorization rejected'},
      {status:403,code:'42501',message:'Permission denied'},
      {status:500,code:'PGRST202',message:'Could not find get_my_ranch_context in schema cache'},
      {status:502,code:'XX000',message:'Gateway response failed'},
      {status:503,code:'503',message:'Service unavailable'}
    ])await test(`HTTP ${status} never restores cached authorization or legacy access`,async()=>{
      response=transportResponse;await coldStart(verifiedCache);
      assert.equal(await refreshContext(),true);
      await authPage.evaluate(id=>window.__d4.show(id),ANIMAL);
      assert.equal((await inspect()).detailOpen,true);
      response={status,data:null,error:{code,message}};
      assert.equal(await refreshContext(),false);
      const denied=await inspect();assertClosed(denied);
      if(status===401||status===403){
        assert.equal(denied.cache,null,'Authorization rejection retained permission cache');
        response=transportResponse;await refreshContext();
        const retry=await inspect();assertClosed(retry);assert.equal(retry.cache,null);
      }else assert.equal(denied.cache,JSON.stringify(verifiedCache),'Server failure extended or changed cached verification');
      return {httpStatus:status,cacheRemoved:denied.cache===null,access:denied.access,legacy:denied.legacy,closedDetail:!denied.detailOpen};
    });
    await test('Unassigned membership clears cached authorization, closes the detail and cannot recover on later status 0',async()=>{
      response=transportResponse;await coldStart(verifiedCache);await refreshContext();
      await authPage.evaluate(id=>window.__d4.show(id),ANIMAL);
      assert.equal((await inspect()).detailOpen,true);
      response={status:200,error:null,data:{status:'unassigned'}};
      assert.equal(await refreshContext(),true);
      const denied=await inspect();assertClosed(denied,{ready:true});
      assert.equal(denied.context.status,'unassigned');assert.equal(denied.cache,null);
      assert.equal(denied.scope,'ganadero-local');assert.deepEqual(denied.storedPhotoIds,[]);
      response=transportResponse;await refreshContext();
      assertClosed(await inspect());
      await authPage.screenshot({path:path.join(OUT,'ranch-cache-revoked.png')});
      return {cacheRemoved:true,scope:denied.scope,closedDetail:true,access:false};
    });
    for(const {name,cache} of [
      {name:'expired over 24 hours',cache:{...verifiedCache,verifiedAt:Date.now()-25*60*60*1000}},
      {name:'dated in the future',cache:{...verifiedCache,verifiedAt:Date.now()+60*60*1000}},
      {name:'owned by another user',cache:{...verifiedCache,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}
    ])await test(`Transport status 0 rejects authorization cache ${name}`,async()=>{
      response=transportResponse;await coldStart(cache);await refreshContext();
      const rejected=await inspect();assertClosed(rejected);
      assert.equal(rejected.scope,'ganadero-local');assert.deepEqual(rejected.storedPhotoIds,[]);
      assert.equal(rejected.cache,JSON.stringify(cache),'Rejected fallback renewed or rewrote the cached verification');
      return {reason:name,access:false,storedPhotoCount:rejected.storedPhotoIds.length};
    });
    await test('Another signed-in user cannot select the previous user permission cache or scoped IndexedDB',async()=>{
      response=transportResponse;
      await coldStart(verifiedCache,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await refreshContext();
      const rejected=await inspect();assertClosed(rejected);
      assert.equal(rejected.cache,null);assert.equal(rejected.scope,'ganadero-local');assert.deepEqual(rejected.storedPhotoIds,[]);
      return {userId:rejected.userId,scope:rejected.scope,access:false};
    });
  }finally{await authContext.close();}
}

async function legacyBundlePhotoRegression(origin,animal,bytes) {
  const legacyContext=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'allow'});
  await legacyContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const rawPhotos=[P1,P2].map((id,i)=>({id,...(i===0?{animalId:ANIMAL}:{}),name:'omit-defaults-'+(i+1)+'.png',
    mime:'image/png',primary:i===0,createdAt:stamp,storagePath:`${OWNER}/${ANIMAL}/${id}`}));
  const remoteAnimal={...animal};delete remoteAnimal.internalId;
  let record={animal_id:ANIMAL,modified_at:stamp,deleted_at:null,
    payload:{animal:remoteAnimal,events:[],forecasts:[],photos:structuredClone(rawPhotos)}};
  const writes=[];
  remotePhotos=rawPhotos.map(photo=>({...photo,bytes}));
  revisions.set(P1,1);revisions.set(P2,1);online=true;receiptMode='applied';
  await legacyContext.exposeBinding('__d4rpc',(_,name,args)=>stubRpc(name,args,{probe:'legacy-bundle'}));
  await legacyContext.exposeBinding('__d4storage',(_,kind,bucket,name)=>{
    storageCalls.push({kind,bucket,path:name,probe:'legacy-bundle'});
    assert.equal(kind,'download','Updating animal metadata must not rewrite originals');
    const photo=remotePhotos.find(item=>item.storagePath===name);
    assert(photo);return {bytes:photo.bytes,mime:photo.mime};
  });
  await legacyContext.exposeBinding('__d4legacyWrite',(_,request)=>{
    assert.equal(request.table,'animal_sync_records');assert.equal(request.action,'update');
    assert.deepEqual(request.filters,[['owner_id',OWNER],['animal_id',ANIMAL],['modified_at',record.modified_at]]);
    assert.equal(request.columns,'modified_at');
    writes.push(structuredClone(request));
    // Model the server's JSONB child history rule: any raw metadata change gets
    // a new revision, even when its rendered crop still looks like the default.
    for(const photo of request.values.payload.photos){
      const previous=record.payload.photos.find(item=>item.id===photo.id);
      if(!isDeepStrictEqual(previous,photo))revisions.set(photo.id,(revisions.get(photo.id)||0)+1);
    }
    record={...record,...structuredClone(request.values),modified_at:new Date(Date.parse(stamp)+writes.length*1000).toISOString()};
    remotePhotos=record.payload.photos.map(photo=>({...photo,bytes}));
    return {error:null,data:{modified_at:record.modified_at}};
  });
  const legacyPage=await legacyContext.newPage();
  legacyPage.on('pageerror',error=>pageErrors.push(error.message));
  legacyPage.on('dialog',dialog=>dialog.dismiss());
  try{
    await legacyPage.goto(origin);await legacyPage.waitForFunction(()=>!!window.__d4);
    await legacyPage.evaluate(({userId,ownerId})=>window.__d4.setup({userId,ownerId}),{userId:USER,ownerId:OWNER});
    await legacyPage.evaluate(async record=>{
      window.GANADERO_CONFIG.syncEventRpcV1=false;
      await window.__d4.call('applyRemoteRecord',record,null,window.__d4.scope());
      await window.__d4.call('refresh');
      window.GANADERO_CONFIG.syncEventRpcV1=true;
    },record);
    await legacyPage.evaluate(()=>window.__d4.cacheRevisions());
    await legacyPage.evaluate(async({animalId,record})=>{
      const animal=await window.__d4.call('getOne','animals',animalId);
      await window.__d4.call('put','animals',{...animal,name:'Animal metadata changed; photograph unchanged'});
      const bundle=await window.__d4.call('getLocalBundle',animalId);
      return window.__d4.call('writeRemoteRecord',animalId,bundle,record,window.__d4.scope());
    },{animalId:ANIMAL,record});
    await test('Legacy animal upload preserves exact photo JSON without crop defaults or parent insertion',async()=>{
      assert.equal(writes.length,1);
      assert.equal(writes[0].values.payload.animal.name,'Animal metadata changed; photograph unchanged');
      assert.match(writes[0].values.payload.animal.internalId,/^ANM-\d{5,}$/);
      assert.deepEqual(writes[0].values.payload.photos,rawPhotos,'An animal-only change rewrote otherwise identical photo metadata');
      assert.equal(revisions.get(P1),1);assert.equal(revisions.get(P2),1);
      assert.equal(storageCalls.filter(call=>call.probe==='legacy-bundle'&&call.kind!=='download').length,0);
      return {animalUpdated:true,rawPhotosPreserved:true,photoRevisions:[revisions.get(P1),revisions.get(P2)]};
    });
    await test('Crop using revision 1 confirms after a legacy animal-only upload',async()=>{
      online=false;await legacyContext.setOffline(true);
      await legacyPage.evaluate(id=>window.__d4.call('savePhotoCrop',id,17,81,2.2),P1);
      let snapshot=await legacyPage.evaluate(()=>window.__d4.inspect());
      const pending=snapshot.outbox.find(row=>row.operation.action==='photo.crop'&&row.state==='pending');
      assert(pending);assert.equal(pending.operation.baseRevision,1);
      assert.deepEqual(snapshot.photos.find(photo=>photo.id===P1).blob.bytes,bytes);
      online=true;await legacyContext.setOffline(false);
      await legacyPage.evaluate(()=>window.__d4.flush());
      snapshot=await legacyPage.evaluate(()=>window.__d4.inspect());
      const confirmed=snapshot.outbox.find(row=>row.id===pending.id);
      assert.equal(confirmed.state,'confirmed','An animal-only upload invalidated a cached photo revision');
      assert.equal(confirmed.receipt.status,'applied');assert.equal(confirmed.receipt.revision,2);
      assert.equal(remotePhotos.find(photo=>photo.id===P1).cropX,17);
      assert.deepEqual(snapshot.photos.find(photo=>photo.id===P1).blob.bytes,bytes);
      return {operationId:pending.id,baseRevision:1,receiptRevision:confirmed.receipt.revision,originalBytesPreserved:true};
    });
    await test('Legacy serialization still publishes a real crop reset and primary change with its version filter',async()=>{
      // Independent positive control: preserving unchanged rows must not discard
      // an intentional reset to the default crop or a changed primary image.
      record={...record,payload:{...record.payload,photos:remotePhotos.map(photo=>photo.id===P1?
        {...photoData(photo),cropX:17,cropY:81,cropZoom:2.2}:photoData(photo))}};
      remotePhotos=record.payload.photos.map(photo=>({...photo,bytes}));
      await legacyPage.evaluate(async({record,animalId,first,second})=>{
        for(const id of [first,second]){
          const photo=await window.__d4.call('getOne','photos',id);
          await window.__d4.call('put','photos',{...photo,primary:id===second,...(id===first?{cropX:50,cropY:50,cropZoom:1}:{})});
        }
        const bundle=await window.__d4.call('getLocalBundle',animalId);
        await window.__d4.call('writeRemoteRecord',animalId,bundle,record,window.__d4.scope());
      },{record,animalId:ANIMAL,first:P1,second:P2});
      const payload=writes[writes.length-1].values.payload;
      const first=payload.photos.find(photo=>photo.id===P1),second=payload.photos.find(photo=>photo.id===P2);
      assert.equal(first.cropX,50);assert.equal(first.cropY,50);assert.equal(first.cropZoom,1);
      assert.equal(first.primary,false);assert.equal(second.primary,true);
      assert.equal(writes.length,2);
      return {defaultResetPublished:true,primaryChanged:true,modifiedAtFilterChecked:true};
    });
  }finally{online=true;await legacyContext.close();}
}

async function writeReport(){
  await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify({browserVersion:browser.version(),sourceSha256,tests,pageErrors,rpcCalls,storageCalls},null,2));
  console.log(JSON.stringify({passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length,pageErrors,report:path.join(OUT,'report.json')}));
  if(tests.some(t=>t.status==='failed')||pageErrors.length)process.exitCode=1;
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
    await navigator.serviceWorker.register('./service-worker.js', {type:'module'});
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
  if(process.env.D4_LEGACY_REGRESSION_ONLY==='1'){
    await legacyBundlePhotoRegression(origin,animal,bytes);await writeReport();return;
  }
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
  await pickerRegression(page,bytes);
  await framingGestureRegression(page,bytes);
  await touchFramingRegression(origin,animal,remotePhotos);
  await staleFramingRegression(page,animal,remotePhotos);
  await test('Framing preview/reset do not enqueue until explicit Save; zoom enables both axes',async()=>{
    await openFraming(page);await setFraming(page,{x:49,y:51,zoom:2.2});
    const zoomed=await framingState(page);
    assert(zoomed.overflowX>0&&zoomed.overflowY>0);
    assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
    await page.locator('[data-reset-photo-crop]').click();
    const reset=await framingState(page);
    assert.deepEqual({x:reset.x,y:reset.y,zoom:reset.zoom},{x:50,y:50,zoom:1});
    assert(reset.overflowX<0.001||reset.overflowY<0.001,'Cover must have a fitting axis at zoom 1');
    await page.locator('#photo-crop-frame').focus();
    if(reset.overflowX<0.001){await page.keyboard.press('ArrowRight');assert.equal((await framingState(page)).x,50);}
    if(reset.overflowY<0.001){await page.keyboard.press('ArrowDown');assert.equal((await framingState(page)).y,50);}
    assert.equal((await page.evaluate(()=>window.__d4.inspect())).outbox.length,0);
  });
  online=false;await context.setOffline(true);
  const callCount=rpcCalls.length;
  await page.evaluate(()=>window.__d4.holdOldRefresh());
  await test('Offline framing queues without network and keeps source bytes',async()=>{
    await setFraming(page,{x:17,y:81,zoom:2.2});
    await page.locator('[data-save-photo-crop]').click();
    await page.locator('#photo-crop-dialog').waitFor({state:'hidden'});
    await waitForAsync(page,async id=>{const s=await window.__d4.inspect();return s.outbox.some(r=>r.state==='pending')&&s.display.find(p=>p.id===id)?.cropX===17;},P1);
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(rpcCalls.length,callCount,'offline save attempted a server read');
    const pending=inspect.outbox.filter(r=>r.state==='pending'&&r.operation.action==='photo.crop');
    assert.equal(pending.length,1);
    assert.equal(pending[0].operation.baseRevision,7);
    assert.equal(inspect.display.find(p=>p.id===P1).cropX,17);
    assert.equal(inspect.photos.find(p=>p.id===P1).cropX,50,'unconfirmed crop leaked into confirmed legacy photo');
    assert.deepEqual(inspect.photos.find(p=>p.id===P1).blob.bytes,bytes);
    assert.equal(await page.locator('[data-edit-photo-crop]').isDisabled(),true,'Pending Save must block reopening the editor');
    return {operationId:pending[0].id};
  });
  await test('A slower old refresh cannot replace the newly queued photo overlay',async()=>{
    await page.evaluate(()=>window.__d4.finishOldRefresh());
    const inspect=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(inspect.display.find(p=>p.id===P1).cropX,17);
    assert.equal(inspect.display.find(p=>p.id===P1).cropZoom,2.2);
    assert.equal(inspect.outbox.filter(r=>r.state==='pending').length,1);
    assert.equal(await page.locator(`[data-primary-photo="${P2}"]`).isDisabled(),true);
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
    assert.equal(await page.locator('[data-edit-photo-crop]').isDisabled(),false);
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
    assert.equal(await page.locator('[data-edit-photo-crop]').isDisabled(),true);
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
    assert.equal(await page.locator('[data-edit-photo-crop]').isDisabled(),false);
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
  await test('Unpublished photo stays in the encrypted upload outbox and never invents a revision',async()=>{
    online=false;await context.setOffline(true);
    const before=await page.evaluate(()=>window.__d4.inspect());
    await page.evaluate(bytes=>window.__d4.call('addPhotos',[new File([Uint8Array.from(bytes)],'new-offline.png',{type:'image/png'})]),bytes);
    let snapshot=await page.evaluate(()=>window.__d4.inspect());
    const added=snapshot.display.find(p=>!before.photos.some(old=>old.id===p.id));
    assert(added);assert.deepEqual(added.blob.bytes,bytes);
    const create=snapshot.outbox.find(entry=>entry.operation.action==='photo.create'&&entry.operation.entityId===added.id);
    assert(create);assert.equal(create.operation.baseRevision,null);
    assert.equal(snapshot.photos.some(photo=>photo.id===added.id),false);
    const originals=await page.evaluate(()=>window.__d4.raw('photoUploads'));
    assert(originals.some(row=>row.id===create.id&&row.encrypted));
    const callsBefore=rpcCalls.length;
    await page.evaluate(id=>window.__d4.call('savePhotoCrop',id,12,24,1.9),added.id);
    snapshot=await page.evaluate(()=>window.__d4.inspect());
    assert.equal(snapshot.outbox.length,before.outbox.length+1);
    assert.equal(snapshot.display.find(p=>p.id===added.id).cropX,50);
    assert.equal(rpcCalls.length,callsBefore);
    assert.match(await page.locator('#toast').innerText(),/pendiente/);
    await page.evaluate(async id=>{await window.__d4.call('remove','operationOutbox',id);await window.__d4.call('remove','photoUploads',id);},create.id);
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
      await waitForAsync(page,async()=>{
        const locks=await navigator.locks.query();
        return locks.pending.filter(lock=>lock.name==='ganaderov-protected:'+window.__d4.scope().database.name).length>=1;
      });
      remoteInstall=page.evaluate(record=>window.__d4.importRemote(record),{animal_id:ANIMAL,modified_at:new Date().toISOString(),payload:{animal:{...animal,name:'Remote snapshot'},events:[],photos:remotePhotos.map(photoData),forecasts:[]},deleted_at:null});
      await waitForAsync(page,async()=>{
        const locks=await navigator.locks.query();
        return locks.pending.filter(lock=>lock.name==='ganaderov-protected:'+window.__d4.scope().database.name).length>=2;
      });
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
  await ranchCacheRegression(origin,animal);
  await legacyBundlePhotoRegression(origin,animal,bytes);
  await writeReport();
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
