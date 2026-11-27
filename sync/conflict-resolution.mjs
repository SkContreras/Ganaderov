export const same=(a,b)=>{
 if(a===b)return true;
 if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
 return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
};
// Only edits with a reviewed existing entity can be rebased. Never replay
// creation, deletion, attendance or lifecycle transitions automatically.
export function resolutionFields(operation,remote){
 if(!remote||!Number.isSafeInteger(remote.revision)||remote.revision<1||!remote.data)throw Error("Entidad no disponible");
 const c=operation.changes;
 if(operation.action==="animal.update")return Object.keys(c.fields).map(key=>({key,local:c.fields[key],remote:remote.data[key]}));
 if(operation.action==="event.update"){
  if(remote.parentId!==c.animalId||remote.data.type!=="weight"||remote.data.journeyId)throw Error("Evento incompatible");
  return [{key:"weight",local:c.weight,remote:remote.data.weight}];
 }
 if(operation.action==="config.update")return [{key:"config",local:c.config,remote:remote.data}];
 throw Error("Esta acción debe revisarse desde su formulario original");
}
export function replacement(operation,reviewed,current,selected,newId,capturedAt){
 if(!same(reviewed,current))throw Error("La entidad volvió a cambiar. Revisa de nuevo.");
 const fields=resolutionFields(operation,current);
 if(!selected.length||new Set(selected).size!==selected.length||selected.some(k=>!fields.some(f=>f.key===k)))throw Error("Selección inválida");
 const changes=operation.action==="animal.update"?{fields:Object.fromEntries(fields.filter(f=>selected.includes(f.key)).map(f=>[f.key,f.local]))}:structuredClone(operation.changes);
 return {...operation,operationId:newId,capturedAt,baseRevision:current.revision,changes};
}
