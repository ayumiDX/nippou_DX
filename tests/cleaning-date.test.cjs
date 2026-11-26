const {test}=require('node:test');
const assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const s=fs.readFileSync('app.js','utf8');
const code=s.slice(s.indexOf('    function cleaningJapanDateTime'),s.indexOf('    const layoutData'));
test('Japan date at midnight regardless of browser timezone',()=>{
 const c=vm.createContext({Intl,Date,cleaningDateInput:{value:'2026-08-30'}});
 vm.runInContext(code,c);
 assert.equal(c.cleaningJapanDateTime(new Date('2026-11-26T14:59:00Z')).day,'2026-11-26');
 assert.equal(c.cleaningJapanDateTime(new Date('2026-11-26T15:00:00Z')).day,'2026-11-27');
 assert.equal(c.cleaningJapanDateTime(new Date('2026-11-26T15:00:00Z')).time,'00:00');
 const today=c.syncCleaningDate(true).day;assert.equal(c.cleaningDateInput.value,today);
 c.cleaningDateInput.value='2026-11-25';c.syncCleaningDate();assert.equal(c.cleaningDateInput.value,'2026-11-25');
 c.syncCleaningDate(true);assert.equal(c.cleaningDateInput.value,today);
 c.cleaningDateInput.value='2026-08-30';vm.runInContext("cleaningViewDay='2026-08-30'",c);
 c.syncCleaningDate();assert.equal(c.cleaningDateInput.value,today);
});


