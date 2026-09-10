const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');const assert=require('node:assert/strict');
const dir=process.env.TELEMETRY_RESULTS_DIR;
if(!dir || !process.env.KISMET_TEST_KJS_PATH) throw new Error('Set TELEMETRY_RESULTS_DIR and KISMET_TEST_KJS_PATH');
fs.mkdirSync(dir,{recursive:true});
const origin='http://telemetry.test:8499';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--host-resolver-rules=MAP telemetry.test 127.0.0.1','--no-proxy-server']});
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'});
 await context.tracing.start({screenshots:true,snapshots:true});
 const external=[];const failures=[];const checks=[];
 const routeHandler=async route=>{const u=new URL(route.request().url());if(!['telemetry.test','127.0.0.1','localhost'].includes(u.hostname)){external.push({url:u.origin+u.pathname,method:route.request().method(),body:route.request().postData()});return route.fulfill({status:200,contentType:'application/json',body:'{"success":true,"ok":true}'});}if(u.pathname==='/lab-k.js'){return route.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync(process.env.KISMET_TEST_KJS_PATH,'utf8')});}return route.continue();}; await context.route('**/*',routeHandler);
 const page=await context.newPage();page.on('pageerror',e=>failures.push(e.message));
 async function check(name,fn){try{await fn();checks.push({name,pass:true})}catch(e){checks.push({name,pass:false,error:e.message});}}
 async function visit(path){const response=await page.goto(origin+path,{waitUntil:'networkidle'});await page.waitForTimeout(250);assert.equal(new URL(page.url()).origin,origin);return response}
 const state=()=>page.evaluate(()=>({sid:window.Kismet?._kidSid,suppressed:window.Kismet?._sidSuppressed,cookie:document.cookie}));
 let sid; let cachedHtml;
 await check('WordPress cold visit without consent stays anonymous',async()=>{await visit('/');const s=await state();assert.equal(s.suppressed,1);assert.ok(!s.cookie.includes('_kid_sid='))});
 await context.addCookies([{name:'lab_consent',value:'yes',domain:'telemetry.test',path:'/'}]);
 await check('WordPress consented visit establishes a browser session',async()=>{const response=await visit('/stays/property-42?gclid=lab-click');cachedHtml=await response.text();fs.writeFileSync(dir+'/cache-fixture.html',cachedHtml);const s=await state();assert.match(s.sid,/^kid_[A-Za-z0-9]{8}$/);sid=s.sid;assert.ok(s.cookie.includes('_kid_sid='+sid))});
 await check('Next.js property page adopts the WordPress session',async()=>{await visit('/app/stays/property-42');const s=await state();assert.equal(s.sid,sid);assert.ok(s.cookie.includes('_kid_sid='+sid))});
 await check('Next.js simulated checkout confirms and bridges the session',async()=>{await visit('/app/checkout');await page.getByRole('button',{name:'Confirm test booking'}).click();await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('simulatedBookingConfirmed'));const result=JSON.parse(await page.locator('output').textContent());assert.equal(result.bridge.ok,true);const events=await (await fetch('http://127.0.0.1:8797/events')).json();assert.ok(events.some(e=>e.path==='/v1/booking-bridge'&&e.body.kidSid===sid));await page.screenshot({path:dir+'/mixed-checkout.png'})});
 await context.addCookies([{name:'lab_consent',value:'no',domain:'telemetry.test',path:'/'}]);
 await check('Next.js suppresses old session after consent withdrawal',async()=>{await visit('/app/stays/property-42');const s=await state();assert.equal(s.suppressed,1);assert.ok(!s.sid)});
 await check('WordPress suppresses old session after consent withdrawal',async()=>{await visit('/stays/property-42');const s=await state();assert.equal(s.suppressed,1);assert.ok(!s.sid)});
 await check('identical cached WordPress HTML gives separate visitors distinct sessions',async()=>{
 const ids=[];
 assert.ok(!cachedHtml.includes(sid));
 for(let i=0;i<2;i++){
 const c=await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'});await c.route('**/*',routeHandler);
 
 await c.addCookies([{name:'lab_consent',value:'yes',domain:'telemetry.test',path:'/'}]);
 const p=await c.newPage();p.on('response',async r=>{if(r.url().includes('admin-ajax'))console.log('cache anchor',r.status(),await r.text())});p.on('requestfailed',r=>console.log('cache request failure',r.url(),r.failure()));await p.goto(origin+'/cache-fixture',{waitUntil:'networkidle'});
 await p.waitForFunction(()=>window.Kismet?._kidSid,{},{timeout:5000}).catch(async e=>{throw new Error(JSON.stringify(await p.evaluate(()=>({url:location.href,cookie:document.cookie,k:window.Kismet,html:document.documentElement.outerHTML.slice(0,500)}))))});ids.push(await p.evaluate(()=>window.Kismet._kidSid));await c.close();
 }assert.notEqual(ids[0],ids[1]);assert.ok(ids.every(id=>id!==sid));
 });
 await check('anchor failure leaves WordPress usable and suppresses the tracker',async()=>{
 await context.addCookies([{name:'lab_consent',value:'yes',domain:'telemetry.test',path:'/'}]);
 await page.route('**/wp-admin/admin-ajax.php?**',route=>route.abort());
 const before=external.length;await visit('/');const s=await state();assert.equal(s.suppressed,1);assert.ok(!s.sid);assert.equal(external.length,before);await page.unroute('**/wp-admin/admin-ajax.php?**');
 });
 await context.tracing.stop({path:dir+'/mixed-browser-trace.zip'});
 const result={browser:await browser.version(),checks,pageErrors:failures,interceptedExternalRequests:external};fs.writeFileSync(dir+'/mixed-browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();if(checks.some(c=>!c.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
