import test from 'node:test';
import assert from 'node:assert/strict';
import {applyChangePage} from '../sync/incremental-v1.mjs';
const snapshot={ownerId:'r',epoch:null,cursor:0,records:[]};
const page={protocolVersion:1,status:'ok',epoch:'e',head:1,nextCursor:1,hasMore:false,changes:[{revision:1,kind:'animal',entity_id:'a',deleted:false,record:{owner_id:'r',animal_id:'a'}}]};
test('apply page without mutating prior snapshot',()=>{const next=applyChangePage(snapshot,page,'r');assert.equal(next.cursor,1);assert.equal(next.records.length,1);assert.equal(snapshot.records.length,0);});
test('reject gaps and cross ranch payload',()=>{assert.throws(()=>applyChangePage(snapshot,{...page,changes:[{...page.changes[0],revision:2}]},'r'));assert.throws(()=>applyChangePage(snapshot,{...page,changes:[{...page.changes[0],record:{owner_id:'other',animal_id:'a'}}]},'r'));});
test('physical deletion and epoch mismatch',()=>{const next=applyChangePage(snapshot,page,'r');assert.throws(()=>applyChangePage(next,{...page,epoch:'other'},'r'));const result=applyChangePage(next,{...page,head:2,nextCursor:2,changes:[{revision:2,kind:'animal',entity_id:'a',deleted:true,record:null}]},'r');assert.equal(result.records.length,0);});
