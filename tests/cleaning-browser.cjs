const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('playwright');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
for(const width of [390,320,1280]){
 const context=await browser.newContext({viewport:{width,height:844}});
 const page=await context.newPage(); const errors=[];let fail=false,posts=0;
 let rows=Array.from({length:440},(_,i)=>({machineId:i+1,status:i===164?'済':'未',executor:'',timestamp:''}));
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.hostname==='app.test'){
 const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(fs.existsSync(file))return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 return route.fulfill({status:404,body:''});
 }
 if(url.hostname==='script.google.com'){
 if(req.method()==='POST'){
 const p=new URLSearchParams(req.postData());posts++;
 if(fail)return route.fulfill({json:{success:false,message:'test failure'}});
 if(p.get('action')==='updateCassetteCleaning')rows[Number(p.get('machineId'))-1]={machineId:Number(p.get('machineId')),status:p.get('status'),executor:p.get('executor'),timestamp:p.get('timestamp')};
 return route.fulfill({json:{success:true}});
 }
 return route.fulfill({json:url.searchParams.get('action')==='getCassetteCleanings'?rows:[]});
 }return route.abort();
 });
 await page.addInitScript(()=>{localStorage.setItem('arena_cassette_cleaning_date','2026-08-30');sessionStorage.setItem('arena_is_unlocked','true');sessionStorage.setItem('arena_unlocked_at',String(Date.now()));sessionStorage.setItem('arena_passcode','test');});
 await page.goto('https://app.test/');
 await page.locator('#btn-trigger-cleaning-canvas').click();
 const today=await page.evaluate(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date()));
 assert.equal(await page.locator('#cleaning-date-input').inputValue(),today);
 await page.locator('#layout-mach-161').click();
 await page.locator('[name=cell]').check();
 await page.locator('#machine-cleaning-dialog button[value=save]').click();
 await page.waitForFunction(()=>document.querySelector('#layout-mach-161').classList.contains('cleaned-cell'));
 assert.equal(rows[160].status,'セル');
 assert(rows[160].timestamp.startsWith(today.replaceAll('-','/')));
 await page.locator('#layout-mach-161').click();
 assert(await page.locator('[name=cell]').isChecked());
 await page.locator('[name=cassette]').check();
 await page.locator('#machine-cleaning-dialog button[value=save]').click();
 await page.waitForFunction(()=>document.querySelector('#layout-mach-161').classList.contains('cleaned-cassette'));
 assert.equal(rows[160].status,'セル・カセット');
 await page.locator('#layout-mach-162').click();await page.locator('[name=cassette]').check();await page.locator('#machine-cleaning-dialog button[value=save]').click();
 await page.waitForFunction(()=>document.querySelector('#layout-mach-162').classList.contains('cleaned-cassette'));
 await page.locator('#layout-mach-163').click();await page.locator('[name=cell]').check();await page.locator('#machine-cleaning-dialog button[value=save]').click();
 await page.waitForFunction(()=>document.querySelector('#layout-mach-163').classList.contains('cleaned-cell'));
 await page.screenshot({path:'browser-'+width+'.png'});
 await page.locator('#layout-mach-161').click();await page.screenshot({path:'dialog-'+width+'.png'});
 let before=posts;await page.locator('[name=cell]').uncheck();await page.locator('#machine-cleaning-dialog button[value=cancel]').click();
 assert.equal(posts,before);
 await page.locator('#layout-mach-161').click();assert(await page.locator('[name=cell]').isChecked());
 await page.locator('[name=cell]').uncheck();await page.locator('[name=cassette]').uncheck();fail=true;
 await page.locator('#machine-cleaning-dialog button[value=save]').click();
 await page.waitForFunction(()=>!document.querySelector('#btn-cleaning-reset').disabled);
 assert.equal(rows[160].status,'セル・カセット');fail=false;
 await page.locator('#layout-mach-161').click();await page.locator('[name=cell]').uncheck();await page.locator('[name=cassette]').uncheck();await page.locator('#machine-cleaning-dialog button[value=save]').click();
 await page.waitForFunction(()=>!document.querySelector('#layout-mach-161').classList.contains('cleaned-cell'));
 assert.equal(rows[160].status,'未');
 await page.reload();await page.locator('#btn-trigger-cleaning-canvas').click();
 await page.waitForFunction(()=>document.querySelector('#layout-mach-162')?.classList.contains('cleaned-cassette'));
 assert.equal(await page.locator('#layout-mach-165 .machine-cleaning-label').textContent(),'従来済');
 assert.deepEqual(errors,[]);
 console.log('PASS viewport '+width+': all states, reopen, cancel, server failure, reset to unclean, reload');
 await context.close();
}
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});


