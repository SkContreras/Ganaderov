import {localKey,seal,unseal} from "./local-crypto.mjs";
const reserved=id=>typeof id==="string"&&(id.startsWith("local-key:")||id.startsWith('["incremental-v1",'));
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const complete=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error("Transacción cancelada"));tx.onerror=()=>reject(tx.error);});
const keys=new WeakMap();
const scope=(db,store,id)=>JSON.stringify([db.name,store,id]);
async function keyFor(db){
 if(!keys.has(db))keys.set(db,localKey(db,"records:"+db.name));
 return keys.get(db);
}
async function encode(db,key,store,value){
 if(store==="syncMeta"&&reserved(value.id))throw Error("Identificador reservado");
 const copy={...value};
 if(copy.blob instanceof Blob){
  copy.__photo={mime:copy.blob.type,bytes:Array.from(new Uint8Array(await copy.blob.arrayBuffer()))};
  delete copy.blob;
 }
 const encrypted=await seal(key,scope(db,store,value.id),copy);
 // Only the existing index fields remain visible.
 return {id:value.id,animalId:value.animalId,date:value.date,targetDate:value.targetDate,updatedAt:value.updatedAt,encryptedRecord:encrypted};
}
async function decode(db,key,store,row){
 if(!row?.encryptedRecord)return row;
 const value=await unseal(key,scope(db,store,row.id),row.encryptedRecord);
 if(value.id!==row.id)throw Error("Identidad local inválida");
 for(const field of ["animalId","date","targetDate","updatedAt"])if(value[field]!==row[field])throw Error("Índice local inválido");
 if(value.__photo){value.blob=new Blob([Uint8Array.from(value.__photo.bytes)],{type:value.__photo.mime});delete value.__photo;}
 return value;
}
async function rawRead(db,names,selections={}){
 const tx=db.transaction(names,"readonly");
 const done=complete(tx);
 const entries=await Promise.all(names.map(async name=>[name,selections[name]
  ? (await Promise.all(selections[name].map(id=>request(tx.objectStore(name).get(id))))).filter(Boolean)
  : await request(tx.objectStore(name).getAll())]));
 await done;return new Map(entries);
}
function lock(db,fn){
 if(!globalThis.navigator?.locks?.request)throw Error("Este navegador no admite almacenamiento protegido concurrente.");
 return navigator.locks.request("ganaderov-protected:"+db.name,fn);
}
export async function readProtected(db,store){
 const key=await keyFor(db),rows=(await rawRead(db,[store])).get(store);
 return Promise.all(rows.filter(row=>store!=="syncMeta"||!reserved(row.id)).map(row=>decode(db,key,store,row)));
}
// Pending originals are read individually so draining a photo queue does not
// decrypt every attachment into memory at once.
export async function readProtectedRecord(db,store,id){
 const key=await keyFor(db),rows=(await rawRead(db,[store],{[store]:[id]})).get(store);
 return rows.length?decode(db,key,store,rows[0]):undefined;
}
// Existing synchronous transaction callbacks operate on an isolated snapshot.
// All protected writes are serialized under a cross-tab Web Lock, encrypted
// before opening the final native transaction, and committed atomically.
export async function protectedTransaction(db,names,mode,operation,verify=()=>{},selections={}){
 return lock(db,async()=>{
  verify();
  const key=await keyFor(db),raw=await rawRead(db,names,selections),maps=new Map(),dirty=new Map(),jobs=[];
  for(const name of names){
   const rows=await Promise.all(raw.get(name).filter(r=>name!=="syncMeta"||!reserved(r.id)).map(r=>decode(db,key,name,r)));
   maps.set(name,new Map(rows.map(r=>[r.id,r])));
   dirty.set(name,new Map());
  }
  const api={objectStore(name){
   if(!maps.has(name))throw Error("Almacén fuera de transacción");
   const map=maps.get(name),changes=dirty.get(name);
   const put=value=>{if(mode!=="readwrite")throw Error("Solo lectura");if(typeof value?.id!=="string"||!value.id)throw Error("ID inválido");const copy=structuredClone(value);map.set(copy.id,copy);changes.set(copy.id,copy);};
   const remove=id=>{if(mode!=="readwrite")throw Error("Solo lectura");map.delete(id);changes.set(id,null);};
   const get=id=>{const req={result:undefined,onsuccess:null};jobs.push(()=>{req.result=map.get(id);req.onsuccess?.();});return req;};
   const getAll=()=>{const req={result:undefined,onsuccess:null};jobs.push(()=>{req.result=[...map.values()];req.onsuccess?.();});return req;};
   return {put,add(value){if(map.has(value.id))throw Error("ID duplicado");put(value);},delete:remove,get,getAll,clear(){for(const id of map.keys())remove(id);},index(field){
    return {openCursor(range){
     const req={result:null,onsuccess:null};
     // Snapshot matching keys at cursor creation, so later puts are not deleted.
     const ids=[...map.values()].filter(row=>range.includes(row[field])).map(row=>[row.id,row]);
     let at=0;
     const next=()=>{const entry=ids[at++];req.result=entry===undefined?null:{delete:()=>{if(map.get(entry[0])===entry[1])remove(entry[0]);},continue:()=>jobs.push(next)};req.onsuccess?.();};
     jobs.push(next);return req;
    }};
   }};
  }};
  // Cursor deletions must precede subsequent replacements of the same key.
  const result=operation(api);
  for(let i=0;i<jobs.length;i++)jobs[i]();
  verify();
  const writes=await Promise.all([...dirty].map(async ([name,changes])=>[name,await Promise.all([...changes].map(async ([id,value])=>[id,value===null?null:await encode(db,key,name,value)]))]));
  verify();
  if(writes.some(([,rows])=>rows.length)){
   const tx=db.transaction(names,"readwrite"),done=complete(tx);
   for(const [name,rows] of writes)for(const [id,value] of rows){const s=tx.objectStore(name);value===null?s.delete(id):s.put(value);}
   await done;
  }
  return result;
 });
}
export async function migrateProtected(db,stores,verify){
 return lock(db,async()=>{
  const key=await keyFor(db),raw=await rawRead(db,stores),writes=[];
  for(const [name,rows] of raw)for(const row of rows){
   if(name==="syncMeta"&&reserved(row.id))continue;
   if(row.encryptedRecord){await decode(db,key,name,row);continue;}
   writes.push([name,await encode(db,key,name,row)]);
  }
  verify();
  if(writes.length){const tx=db.transaction(stores,"readwrite"),done=complete(tx);for(const [name,row] of writes)tx.objectStore(name).put(row);await done;}
 });
}
