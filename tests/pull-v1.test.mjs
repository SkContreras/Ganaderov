import test from "node:test";
import assert from "node:assert/strict";
import {pullSnapshot} from "../sync/pull-v1.mjs";
const snapshot = (epoch,cursor) => ({ownerId:"r",epoch,cursor,records:[]});
const page = (epoch,head,rev) => ({protocolVersion:1,status:"ok",epoch,head,nextCursor:rev,hasMore:rev<head,
  changes:[{revision:rev,kind:"animal",entity_id:"animal"+rev,deleted:false,record:{owner_id:"r",animal_id:"animal"+rev}}]});

test("retoma una página confirmada después de perder la red",async () => {
  let saved=null,fail=true;
  const adapter={read:async()=>saved,verify(){},commit:async (old,next)=>{assert.equal(old,saved);saved=next;return true;},
    fetchPage:async after=>{if(after===1&&fail)throw Error("sin red");return page("a",2,after+1);}};
  await assert.rejects(pullSnapshot("r",adapter),/sin red/);
  assert.equal(saved.cursor,1);
  fail=false;
  assert.equal((await pullSnapshot("r",adapter)).records.length,2);
});
test("rechaza una página inicial incompleta después de un cambio de época",async () => {
  const old=snapshot("antigua",25);
  const adapter={read:async()=>old,verify(){},commit:()=>assert.fail("No debe escribir"),
    fetchPage:async after=>after?{protocolVersion:1,status:"reset_required",epoch:"nueva"}:page("nueva",2,2)};
  await assert.rejects(pullSnapshot("r",adapter),/Invalid change/);
});
test("una pestaña tardía continúa desde el cursor confirmado por la otra",async()=>{
  let saved=null;
  const calls=[];
  const first=page("e",2,1);
  const other={...snapshot("e",1),records:[{kind:"animal",entity_id:"animal1",record:first.changes[0].record}]};
  const next=await pullSnapshot("r",{
    read:async()=>saved,verify(){},fetchPage:async(after)=>{calls.push(after);return page("e",2,after+1);},
    commit:async(expected,value)=>{
      if(!saved){saved=other;return false;}
      assert.equal(expected,other);saved=value;return true;
    }
  });
  assert.deepEqual(calls,[0,1]);assert.equal(next.cursor,2);assert.equal(next.records.length,2);
});
