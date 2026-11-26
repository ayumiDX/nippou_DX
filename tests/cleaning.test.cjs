const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
const state=source.slice(source.indexOf('    function cleaningState('),source.indexOf('    function createMachineCell('));
test('four cleaning states and legacy remain distinct',()=>{
 const c=vm.createContext({}); vm.runInContext(state,c);
 for(const [status,a,b,legacy] of [['未',false,false,false],['セル',true,false,false],['カセット',false,true,false],['セル・カセット',true,true,false],['済',false,false,true]]){
 const s=c.cleaningState(status);assert.equal(s.cell,a);assert.equal(s.cassette,b);assert.equal(s.legacy,legacy);
 }
});
test('save persists dual status; failure retains previous record',async()=>{
 const save=source.slice(source.indexOf('    async function saveMachineCleaning('),source.indexOf('    function updateCleaningProgressUI('));
 const records=[{machineId:161,status:'セル',executor:'旧担当',timestamp:'2026/11/25 10:00'}];
 let fail=false,posted,alerted=false;
 const c=vm.createContext({cleaningSavePending:false,btnCleaningReset:{},globalCassetteCleanings:records,
 sessionStorage:{getItem:()=> '担当'},localStorage:{setItem:()=>{}},cleaningDateInput:{value:'2026-11-26'},
 syncCleaningDate:()=>({day:'2026-11-26',time:'12:00'}), GAS_API_URL:'mock', URLSearchParams,Date,console,renderStoreLayout:()=>{},updateCleaningProgressUI:()=>{},
 alert:()=>{alerted=true},fetch:async(u,o)=>{posted=o.body;return {ok:!fail,json:async()=>({success:true})}}});
 vm.runInContext(save,c);
 await c.saveMachineCleaning(161,'セル・カセット');
 assert.equal(posted.get('status'),'セル・カセット');assert.equal(records[0].status,'セル・カセット');
 fail=true;await c.saveMachineCleaning(161,'未');
 assert.equal(records[0].status,'セル・カセット');assert.equal(alerted,true);assert.equal(c.cleaningSavePending,false);
});


