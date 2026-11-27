// Injected only into the locally served test copy; never used by production.
window.__d4 = {
  state,
  async call(name,...args) {
    try{return await eval(name)(...args);}
    finally {clearTimeout(state.syncTimer);state.syncRequested=false;}
  },
  async setup({userId,ownerId,role='owner'}={}) {
    db?.close();
    sessionGeneration++;
    currentUser={id:userId,email:'synthetic-d4@example.invalid',user_metadata:{full_name:'D4 synthetic'}};
    state.ranchOwnerId=ownerId;
    state.ranchRole=role;
    state.ranchReady=true;
    state.legacyAccount=false;
    state.syncing=false;
    clearTimeout(state.syncTimer);
    state.syncRequested=false;
    state.ranchContext={status:'active',role,owner_id:ownerId,display_name:'D4 synthetic'};
    db=await openDatabase(localScopeName(ownerId,userId));
    await (await protectedModule()).migrateProtected(db,protectedStores,()=>{});
    cloud={
      rpc(name,args) {
        const result=window.__d4rpc(name,args);
        result.abortSignal=()=>result;
        return result;
      },
      storage:{from(bucket){return {
        async download(path) {
          const result=await window.__d4storage('download',bucket,path);
          return {error:result.error??null,data:result.error?null:new Blob([Uint8Array.from(result.bytes)],{type:result.mime})};
        },
        async upload(path,blob,options) {
          return window.__d4storage('upload',bucket,path,{bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),mime:blob.type,options});
        },
        async remove(paths) {throw Error('Physical deletion prohibited in D4 test');}
      };}},
      from(table){throw Error('Unexpected table access in isolated D4 test: '+table);}
    };
    if(!this.eventsRegistered){registerEvents();this.eventsRegistered=true;}
    await refresh();
    document.querySelector('#auth-gate')?.remove();
    return db.name;
  },
  async seed({animal,photos}) {
    await transaction(['animals','photos'],'readwrite',tx=>{
      tx.objectStore('animals').put(animal);
      for(const photo of photos){
        const {bytes,...rest}=photo;
        tx.objectStore('photos').put({...rest,blob:new Blob([Uint8Array.from(bytes)],{type:rest.mime})});
      }
    });
    const bundle=await getLocalBundle(animal.id);
    await put('syncMeta',{id:'animal:'+animal.id,fingerprint:bundleFingerprint(bundle),remoteVersion:'2026-11-27T10:00:00Z'});
    await refresh();
    return {photos:state.photos.length};
  },
  async inspect() {
    const serial=async p=>({...p,blob:p.blob?{type:p.blob.type,size:p.blob.size,bytes:Array.from(new Uint8Array(await p.blob.arrayBuffer()))}:undefined});
    const photos=await getAll('photos');
    return {scope:db.name,photos:await Promise.all(photos.map(serial)),display:await Promise.all(state.photos.map(serial)),outbox:await getAll('operationOutbox'),meta:await getAll('syncMeta')};
  },
  async raw(store) {
    return new Promise((resolve,reject)=>{
      const r=db.transaction(store,'readonly').objectStore(store).getAll();
      r.onsuccess=()=>resolve(r.result.map(row=>({id:row.id,encrypted:!!row.encryptedRecord,plainKeys:Object.keys(row),bodyLength:row.encryptedRecord?.body?.byteLength})));
      r.onerror=()=>reject(r.error);
    });
  },
  scope(){return {userId:currentUser.id,ownerId:state.ranchOwnerId,database:db};},
  async show(animalId) {state.currentAnimalId=animalId;state.detailView='full';await refresh();openDetail(animalId,true);},
  async flush() {return flushEventOutbox(this.scope());},
  async flushAfter(milliseconds) {
    const now=Date.now;
    Date.now=()=>now()+milliseconds;
    try{return await flushEventOutbox(this.scope());}
    finally{Date.now=now;}
  },
  async importRemote(record) {
    const before=await getLocalBundle(record.animal_id);
    const result=await applyRemoteRecord(record,before?bundleFingerprint(before):null,this.scope());
    if(result)await saveSyncMeta(record.animal_id,remoteVersion(record),record.modified_at,remoteFingerprint(record));
    await refresh();
    if(state.currentAnimalId)openDetail(state.currentAnimalId,true);
    return result;
  },
  async cacheRevisions(){
    await cachePhotoRevisions(this.scope());
    await refresh();
    if(state.currentAnimalId)openDetail(state.currentAnimalId,true);
  },
  async archive(id){
    const entry=(await getAll('operationOutbox')).find(r=>r.id===id);
    await setConflictArchive(this.scope(),entry,true);
    await refresh();
    if(state.currentAnimalId)openDetail(state.currentAnimalId,true);
  },
  async blockWrites(){
    let acquired;
    const ready=new Promise(resolve=>{acquired=resolve;});
    this.writeBarrier=navigator.locks.request('ganaderov-protected:'+db.name,async()=>{
      acquired();
      await new Promise(resolve=>{this.releaseWrites=resolve;});
    });
    await ready;
  },
  async unblockWrites(){this.releaseWrites?.();await this.writeBarrier;}
};
