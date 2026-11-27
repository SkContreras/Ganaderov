import test from "node:test";import assert from "node:assert/strict";import {replacement,resolutionFields} from "../sync/conflict-resolution.mjs";
const op={action:"animal.update",operationId:"old",changes:{fields:{name:"Luna",color:"negro"}},baseRevision:1};
const remote={revision:2,data:{name:"Sol",color:"blanco"}};
test("only chosen fields with fresh revision and new ID",()=>{const result=replacement(op,remote,remote,["name"],"new","2026-01-01T00:00:00Z");assert.deepEqual(result.changes,{fields:{name:"Luna"}});assert.equal(result.baseRevision,2);assert.equal(op.operationId,"old");});
test("reject stale review or create replay",()=>{assert.throws(()=>replacement(op,remote,{...remote,revision:3},["name"],"new","now"));assert.throws(()=>resolutionFields({...op,action:"animal.create"},remote));});
