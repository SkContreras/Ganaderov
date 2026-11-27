const encoder=new TextEncoder(),decoder=new TextDecoder();
export async function seal(key,scope,value){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const body=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(scope),tagLength:128},key,encoder.encode(JSON.stringify(value)));
  return {version:1,iv,body};
}
export async function unseal(key,scope,envelope){
  if(envelope?.version!==1||envelope.iv?.byteLength!==12)throw Error("Contenido cifrado inválido");
  return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:envelope.iv,additionalData:encoder.encode(scope),tagLength:128},key,envelope.body)));
}
// Key generation is outside the transaction; the winning key is selected in
// one readwrite transaction, preventing two tabs from replacing one another.
export async function localKey(database,scope){
  const id="local-key:"+scope;
  const generated=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  return new Promise((resolve,reject)=>{
    const tx=database.transaction("syncMeta","readwrite"),store=tx.objectStore("syncMeta");
    let key;
    const req=store.get(id);
    req.onsuccess=()=>{key=req.result?.key??generated;if(!req.result)store.add({id,key});};
    tx.oncomplete=()=>resolve(key);
    tx.onabort=()=>reject(tx.error??Error("No se pudo abrir la clave local"));
  });
}
