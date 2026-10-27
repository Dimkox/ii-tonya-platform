import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

// New package-readout behavior, not a rerun of exhausted booking/login tests.
// Real DOM and controllers; only HTTP is synthetic. No real login or payments.
const script = `
const delay=()=>new Promise(resolve=>setTimeout(resolve,10));
const until=async (predicate,label)=>{for(let i=0;i<150;i++){if(predicate())return;await delay();}throw Error(label);};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const summary=units=>({asOf:'2026-10-10T12:00:00.000Z',totalRemainingUnits:String(units),hasMore:false,
  packages:units?[{id:'00000000-0000-4000-8000-000000000001',kind:'paid',grantedUnits:500,
  remainingUnits:String(units),expiresAt:'2026-12-09T12:00:00.000Z',status:'active'}]:[]});
let account='a', count=0, held, loggedIn=true, holdLogout=false, logoutHeld, bookingReads=0, exports=0;
const writes=[];
window.fetch=async (url,options)=>{
  if(options?.method && options.method!=='GET') writes.push(url);
  if(url==='/v1/browser/session' && options?.method==='DELETE') {loggedIn=false;return json({});}
  if(url==='/v1/browser/session') return json({available:true,authenticated:loggedIn,csrfToken:account.repeat(64),
    botUsername:'synthetic_bot',privacyAvailable:true,erasureAvailable:false,bookingAvailable:true,bookingReserveAvailable:false});
  if(url==='/v1/browser/privacy/consents') return json({consents:[]});
  if(url==='/v1/browser/privacy/export') {exports++;return json({synthetic:true});}
  if(url==='/v1/browser/bookings') {bookingReads++;return json({bookings:[],nextCursor:null});}
  if(url==='/v1/public/catalog') return json({items:[]});
  if(url==='/v1/browser/packages') {
    if(options.headers['x-csrf-token']!==account.repeat(64))throw Error('wrong session binding');
    count++;
    if(holdLogout)return new Promise(resolve=>{logoutHeld=resolve;});
    if(count===2)return json({error:'temporarily_unavailable'},503);
    if(count===3)return json(summary(0));
    if(count===4)return new Promise(resolve=>{held=resolve;});
    return json(summary(account==='a'?17:7));
  }
  throw Error('unexpected request '+url);
};
try {
  const {renderAccountPage,bindPrivacyActions}=await import('/src/consent-view.ts');
  history.replaceState(null,'','/account/');
  document.body.innerHTML=renderAccountPage();
  bindPrivacyActions(document);
  const total=()=>document.querySelector('[data-packages-total]')?.textContent??'';
  const retry=()=>document.querySelector('[data-packages-retry]');
  await until(()=>total().includes('17') && retry()?.disabled===false,'package balance did not render');
  if(!document.querySelector('[data-booking-area]') || !document.querySelector('[data-export-data]'))throw Error('existing account sections missing');
  if(!document.querySelector('[data-packages-area]').textContent.includes('Онлайн-оплата пока не подключена'))throw Error('payment deferral missing');
  const row=document.querySelector('[data-packages-list] li')?.textContent??'';
  for(const text of ['Оплаченный','17 из 500','Действует','09.12.2026','15:00','UTC+3'])if(!row.includes(text))throw Error('package detail missing: '+text);
  const snapshotTime=document.querySelector('[data-packages-as-of]')?.textContent??'';
  for(const text of ['10.10.2026','15:00:00','UTC+3'])if(!snapshotTime.includes(text))throw Error('snapshot time missing: '+text);
  retry().click();
  await until(()=>count===2 && retry()?.disabled===false,'error request incomplete');
  if(total().trim())throw Error('error exposed stale or fabricated total');
  if(!document.querySelector('[data-packages-status]').textContent.trim())throw Error('no error status');
  retry().click();
  await until(()=>count===3 && retry()?.disabled===false && total().includes('0'),'empty result not distinguished');
  if(document.querySelector('[data-packages-list]').textContent.includes('17'))throw Error('empty retained old package');
  retry().click();
  await until(()=>!!held,'pending request missing');
  const beforeBookings=bookingReads;
  await until(()=>document.querySelector('[data-reconcile]')?.disabled===false,'booking control unavailable');
  document.querySelector('[data-reconcile]').click();
  await until(()=>bookingReads>beforeBookings && document.querySelector('[data-reconcile]')?.disabled===false,'booking read broken during package request');
  await until(()=>document.querySelector('[data-export-data]')?.disabled===false,'export unavailable');
  document.querySelector('[data-export-data]').click();
  await until(()=>exports===1 && document.querySelector('[data-export-data]')?.disabled===false,'privacy export broken during package request');
  if(retry().disabled!==true)throw Error('privacy restored stale package lock');
  account='b';
  document.querySelector('[data-retry]').click();
  await until(()=>count===5 && total().includes('7'),'new account did not render');
  held(json(summary(999)));
  for(let i=0;i<30;i++)await delay();
  if(total().includes('999') || !total().includes('7'))throw Error('stale account response restored');
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
  if(document.querySelector('[data-packages-area]')?.textContent.trim())throw Error('private data survived pagehide');
  if(writes.length)throw Error('readout performed mutations');
  document.querySelector('[data-retry]').click();
  await until(()=>count===6 && total().includes('7') && retry()?.disabled===false,'explicit refresh failed to reload authenticated packages');
  holdLogout=true;
  retry().click();
  await until(()=>!!logoutHeld && document.querySelector('[data-logout]')?.disabled===false,'logout fixture not ready');
  document.querySelector('[data-logout]').click();
  if(total().trim())throw Error('logout did not clear packages immediately');
  await until(()=>!loggedIn && !document.querySelector('[data-logout]'),'logout did not finish');
  logoutHeld(json(summary(999)));
  for(let i=0;i<30;i++)await delay();
  if(document.querySelector('[data-packages-area]') || total().trim())throw Error('late logout response restored packages');
  if(writes.length!==1 || writes[0]!=='/v1/browser/session')throw Error('unexpected mutation; only explicit logout permitted');
  document.body.innerHTML='<p id="result">PASS</p>';
} catch(error) {document.body.textContent='FAIL: '+error.message;}
`;

it("shows actual package states and discards stale account reads without payments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ii-tonya-package-readout-"));
  const server = await createServer({
    root: resolve("apps/web"),
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/__package-readout-test") return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<html><body><script type="module">${script}</script></body></html>`,
    );
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("missing_listener");
    const result = await promisify(execFile)(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--disable-background-networking",
        `--user-data-dir=${directory}`,
        "--virtual-time-budget=12000",
        "--dump-dom",
        `http://127.0.0.1:${address.port}/__package-readout-test`,
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024 },
    );
    expect(result.stdout).toContain('<p id="result">PASS</p>');
  } finally {
    await server.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}, 30000);
