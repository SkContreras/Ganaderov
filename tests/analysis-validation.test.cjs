const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const extract=(a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const ctx=vm.createContext({state:{events:[]}});
vm.runInContext(extract('  function validAnalysisWeight','  function renderCalculatorAnimalOptions')+extract('  function isDateOnly','  function validateAnimalBackupRecords'),ctx);
test('missing weights are not zero',()=>{ctx.state.events=[null,'',false,300].map((weight,i)=>({id:String(i),animalId:'a',type:'weight',date:'2025-01-01',weight}));const p=ctx.weightHistory('a');assert.equal(p[0].count,1);assert.equal(p[0].weight,300);});
test('negative projection and invalid calendar date rejected',()=>{assert.equal(ctx.projectWeight(10,-2,10,'2025-01-01'),null);assert.equal(ctx.projectWeight(100,1,10,'2025-02-30'),null);});
test('zero forecast percentage undefined',()=>{const f=ctx.evaluateForecast({status:'pending',targetDate:'2025-01-01',predictedWeight:0},'2025-01-02',10);assert.equal(f.errorKg,10);assert.equal(f.absoluteErrorPercent,null);});
