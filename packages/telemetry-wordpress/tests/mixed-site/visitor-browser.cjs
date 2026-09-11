const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const output=process.env.VISITOR_RESULTS_PATH || '/private/tmp/visitor-browser-results.json';
const profile=fs.mkdtempSync('/private/tmp/visitor-chrome-');
const origin='http://telemetry.test:8599',checks=[];
let context;
async function launch(dir=profile){const c=await chromium.launchPersistentContext(dir,{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',args:['--host-resolver-rules=MAP telemetry.test 127.0.0.1, MAP www.telemetry.test 127.0.0.1','--no-proxy-server']});await c.route('**/*',async r=>{const u=new URL(r.request().url());if(u.pathname==='/lab-k.js')return r.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.KISMET_TEST_KJS_PATH,'utf8')});if(!['telemetry.test','www.telemetry.test','127.0.0.1'].includes(u.hostname))return r.fulfill({contentType:'application/json',body:'{"ok":true,"success":true}'});return r.continue()});return c;}
const cookies=async()=>Object.fromEntries((await context.cookies()).map(c=>[c.name,c.value]));
async function visit(path,base=origin){const p=context.pages()[0];const r=await p.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(r.status(),200);await p.waitForTimeout(1800);}
async function state(){return (await fetch('http://127.0.0.1:8798/lab/state')).json();}
async function check(name,fn){await fn();checks.push({name,pass:true});console.log('PASS',name);}
(async()=>{try{
context=await launch();
await context.addCookies([{name:'lab_consent',value:'yes',domain:'.telemetry.test',path:'/',expires:Math.floor(Date.now()/1000)+86400}]);
let first,second;
await check('WordPress issues long-lived visitor cookie',async()=>{await visit('/');first=await cookies();assert.match(first._kid_vid,/^vid_[a-f0-9]{64}$/);assert.match(first._kid_sid,/^kid_[A-Za-z0-9]{8}$/);});
await check('browser restart retains visitor cookie',async()=>{await context.close();context=await launch();assert.equal((await cookies())._kid_vid,first._kid_vid);});
await check('lost session cookie on Next.js recovers same stored visitor',async()=>{await context.clearCookies({name:'_kid_sid'});await visit('/app/stays/property-42');second=await cookies();assert.notEqual(second._kid_sid,first._kid_sid);assert.equal(second._kid_vid,first._kid_vid);const s=await state();assert.equal(s.links.find(x=>x.session_id===first._kid_sid)?.visitor_id,s.links.find(x=>x.session_id===second._kid_sid)?.visitor_id);assert.ok(s.links.find(x=>x.session_id===second._kid_sid));});
await check('Next.js to WordPress checkout keeps session and visitor',async()=>{await visit('/book-now/?id=property-42&dates=2026-10-05+to+2026-10-09&sleeps=1');assert.equal((await cookies())._kid_sid,second._kid_sid);assert.equal((await cookies())._kid_vid,first._kid_vid);});
await check('www/apex share scoped visitor cookie',async()=>{await visit('/app/stays/property-42','http://www.telemetry.test:8599');assert.equal((await cookies())._kid_vid,first._kid_vid);});
await check('emitted server events arrive with expected session',async()=>{const s=await state();assert.ok(s.events.some(e=>JSON.stringify(e.body).includes(second._kid_sid)));});
await check('authority outage leaves pages usable',async()=>{await fetch('http://127.0.0.1:8798/lab/outage',{method:'POST',body:'{"enabled":true}'});await visit('/app/stays/property-42');await visit('/');await fetch('http://127.0.0.1:8798/lab/outage',{method:'POST',body:'{"enabled":false}'});});
await check('consent withdrawal clears recognition and session cookies',async()=>{await context.addCookies([{name:'lab_consent',value:'no',domain:'.telemetry.test',path:'/'}]);await visit('/app/stays/property-42');assert.equal((await cookies())._kid_vid,undefined);assert.equal((await cookies())._kid_sid,undefined);await visit('/');assert.equal((await cookies())._kid_vid,undefined);});
await check('independent browser gets a distinct visitor',async()=>{await context.close();context=await launch(fs.mkdtempSync('/private/tmp/visitor-independent-'));await context.addCookies([{name:'lab_consent',value:'yes',domain:'.telemetry.test',path:'/'}]);await visit('/');assert.notEqual((await cookies())._kid_vid,first._kid_vid);assert.match((await cookies())._kid_vid,/^vid_/);});
fs.writeFileSync(output,JSON.stringify({checks,backend:'real recognition store on local PostgreSQL; lab HTTP/session/ingest shell',state:await state()},null,2));
}catch(e){console.error(e);fs.writeFileSync(output,JSON.stringify({checks,error:e.message},null,2));process.exitCode=1;}finally{await context?.close();}})();
