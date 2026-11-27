// Validate a complete page before committing its records and cursor.
export function applyChangePage(snapshot, page, ownerId) {
  if (!snapshot || snapshot.ownerId!==ownerId || page?.protocolVersion!==1 || page.status!=="ok") throw Error("Reset or invalid scope");
  if (typeof page.epoch!=="string" || !page.epoch || (snapshot.epoch!==null&&snapshot.epoch!==page.epoch)) throw Error("Epoch mismatch");
  const cursor=snapshot.cursor;
  if (!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(page.head)||page.head<cursor||!Array.isArray(page.changes)||page.changes.length>100) throw Error("Invalid page");
  const records=new Map(snapshot.records.map(r=>[JSON.stringify([r.kind,r.entity_id]),r]));
  let next=cursor;
  for(const c of page.changes){
    if(c.revision!==next+1||!["animal","journey","config"].includes(c.kind)||typeof c.entity_id!=="string"||!c.entity_id||typeof c.deleted!=="boolean")throw Error("Invalid change");
    const key=JSON.stringify([c.kind,c.entity_id]);
    if(c.deleted){if(c.record!==null)throw Error("Invalid deletion");records.delete(key);}
    else{
      const idKey={animal:"animal_id",journey:"journey_id",config:"owner_id"}[c.kind];
      if(c.record?.owner_id!==ownerId||c.record[idKey]!==c.entity_id)throw Error("Invalid record scope");
      records.set(key,{kind:c.kind,entity_id:c.entity_id,record:c.record});
    }
    next=c.revision;
  }
  if(next!==page.nextCursor||next>page.head||page.hasMore!==(next<page.head)||(page.hasMore&&next===cursor))throw Error("Invalid cursor");
  return {ownerId,epoch:page.epoch,cursor:next,records:[...records.values()]};
}
