// Run: node --test tests/conflict-review.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const context=vm.createContext({});
vm.runInContext(extract('  function stableValue(value)','  function photoFingerprint')+extract('  function compareConflict(base','  async function rememberSyncConflict'),context);
const compare=(b,l,r)=>JSON.parse(JSON.stringify(context.compareConflict(b,l,r)));
test('independent fields combine',()=>{assert.deepEqual(compare({name:'A',color:'B'},{name:'C',color:'B'},{name:'A',color:'D'}).merged,{name:'C',color:'D'});});
test('different same-field edits conflict',()=>{assert.equal(compare({weight:300},{weight:310},{weight:320}).merged,null);});
test('distinct events combine',()=>{assert.deepEqual(compare({events:[]},{events:[{id:'a'}]},{events:[{id:'b'}]}).merged.events,[{id:'a'},{id:'b'}]);});
test('delete versus edit conflicts',()=>{assert.equal(compare({events:[{id:'a',weight:1}]},{events:[]},{events:[{id:'a',weight:2}]}).merged,null);});
test('missing baseline fails closed',()=>{assert.equal(compare(null,{name:'A'},{name:'B'}).merged,null);});
