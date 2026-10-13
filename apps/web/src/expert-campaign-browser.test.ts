import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";

// Actual Chrome DOM + production account/client modules; only HTTP is controlled.
const harness = String.raw`
import { renderExpertAccountPage, bindExpertAccountActions } from '/src/expert-account-view.ts';
const scenario = new URL(location.href).searchParams.get('case');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const wait = async (predicate) => { for(let i=0;i<300;i++){if(predicate())return; await new Promise(r=>setTimeout(r,10));} throw Error('render_timeout'); };
const id='33333333-3333-4333-8333-333333333333', qid='44444444-4444-4444-8444-444444444444';
const receiptId='66666666-6666-4666-8666-666666666666';
const tariff={tariffVersionId:id,displayName:'<img src=x onerror=alert(1)>Про',baseMonthlyMinor:'100001',priceKind:'base',currency:'RUB',durationSeconds:2592000,commercialPolicyVersion:'expert_residency_v2',creditCapBps:3000,individualServicesEnabled:true,groupEventLimit:5,statisticsLevel:'expanded',supportPriority:'priority'};
const quote={...tariff,id:qid,userId:'11111111-1111-4111-8111-111111111111',ruleVersion:'expert_energy_start_v1',calculationTimestamp:'2026-10-12T00:00:00.000Z',quotedAt:'2026-10-12T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',termMonths:3,discountedMonthlyMinor:'90001',monthlyPriceMinor:'80001',priceMinor:'240003',energyDiscountBps:1000,startDiscountBps:1000,floorApplied:false};
const response=(body,status=200)=>new Response(status===204?null:JSON.stringify(body),{status});
let authenticated=true, quoteCalls=[], captureCalls=[], checkoutCalls=[], release, checkoutCount=0, probeCount=0;
window.fetch=async (url,init={})=>{
 assert(!init.headers?.authorization && init.credentials==='same-origin' && init.redirect==='error','request_security');
 if(url.endsWith('/session')){if(init.method==='DELETE'){authenticated=false;return response(null,204);}probeCount++;return response({available:true,authenticated:authenticated && !(scenario==='pending-probe-unauthorized' && probeCount>1),csrfToken:'a'.repeat(64),userId:scenario==='pending-probe-identity-change' && probeCount>1?'55555555-5555-4555-8555-555555555555':'11111111-1111-4111-8111-111111111111',expertId:'22222222-2222-4222-8222-222222222222'});}
 if(url.endsWith('/tariffs'))return response(scenario==='malformed-tariff'?[{...tariff,baseMonthlyMinor:1.1}]:[tariff]);
 assert(init.headers['x-csrf-token']==='a'.repeat(64),'missing_csrf');
 const body=JSON.parse(init.body);
 if(url.endsWith('/quotes')){
   quoteCalls.push(body);
   if(scenario==='logout-quote')return new Promise(r=>{release=()=>r(response(quote));});
   return response(scenario==='malformed-quote'?{...quote,priceMinor:'1.5'}:{...quote,termMonths:body.termMonths,...(scenario==='expired-quote'?{expiresAt:'2026-10-12T00:10:00.000Z'}:{})});
 }
 if(url.endsWith('/receipt-contacts')){
   captureCalls.push(body);
   assert(Object.keys(body).sort().join(',')==='email,idempotencyKey,quoteId' && body.quoteId===qid && body.email==='payer@example.test','capture_authority');
   return response({receiptContactId:receiptId,quoteId:qid,expiresAt:'2099-01-01T00:00:00.000Z'});
 }
 if(url.endsWith('/checkouts')){
   checkoutCalls.push(body);checkoutCount++;
   if(scenario==='logout-checkout')return new Promise(r=>{release=()=>r(response({id:qid,status:'payment_pending',payment:{kind:'created',paymentId:'synthetic',checkoutUrl:'https://checkout.example/pay'}}));});
   if((scenario.startsWith('pending-') || scenario==='same-session-probe-then401') && checkoutCount===1)return new Promise((resolve,reject)=>{release=()=>scenario==='pending-same-session-probe'?reject(Error('committed but response lost')):resolve(scenario==='same-session-probe-then401'?response({error:'unauthorized'},401):response({id:qid,status:'payment_pending',payment:{kind:'created',paymentId:'synthetic',checkoutUrl:'https://checkout.example/pay'}}));});
   if((scenario==='retry' || scenario==='retry-after-expiry') && checkoutCount===1)throw Error('network uncertain');
   if(scenario==='disabled')return response({error:'payment_unavailable'},503);
   if(scenario==='session-expired')return response({error:'unauthorized'},401);
   if(scenario==='rejected')return response({error:'command_rejected'},409);
   return response({id:qid,status:'payment_pending',payment:{kind:'created',paymentId:'synthetic',checkoutUrl:scenario==='unsafe-url'?'javascript:alert(1)':'https://checkout.example/pay'}});
 }
 throw Error('unexpected_request');
};
const root=document.querySelector('#app');root.innerHTML=renderExpertAccountPage();bindExpertAccountActions(root);
const get=(name)=>root.querySelector('[data-campaign-'+name+']');
try {
 await wait(()=>root.querySelector('[data-expert-status]').textContent.includes('Вход выполнен'));
 assert(get('tariff'),'campaign_controls_missing');
 if(scenario==='malformed-tariff'){
   await wait(()=>!get('status').textContent.includes('Загружаем'));
   assert(get('quote').disabled && !root.querySelector('img'),'bad_tariff_accepted');
 }else{
 await wait(()=>!get('quote').disabled);
 assert(get('tariff').options[0].textContent.includes('<img') && !root.querySelector('img'),'unsafe_tariff_render');
 assert(root.textContent.includes('1000,01'),'base_price');
 assert(get('term').options.length===2 && get('term').options[0].value==='1' && get('term').options[1].value==='3','terms');
 get('term').value=scenario==='one-month'?'1':'3';get('term').dispatchEvent(new Event('change'));get('quote').click();get('quote').click();
 await wait(()=>quoteCalls.length===1);
 assert(Object.keys(quoteCalls[0]).sort().join(',')==='idempotencyKey,tariffVersionId,termMonths' && quoteCalls[0].termMonths===(scenario==='one-month'?1:3),'quote_authority');
 if(scenario==='logout-quote'){
   root.querySelector('[data-expert-logout]').click();release();await new Promise(r=>setTimeout(r,80));
   assert(!root.textContent.includes('2400,03') && !root.textContent.includes('<img') && !root.querySelector('[data-campaign-link]'),'late_quote_leak');
 }else if(scenario==='malformed-quote' || scenario==='expired-quote'){
   await wait(()=>!get('quote').disabled);assert(get('checkout').disabled && !root.textContent.includes('2400,03'),'bad_quote_accepted');
 }else{
 await wait(()=>!get('checkout').disabled);
 assert(root.textContent.includes('800,01') && root.textContent.includes('2400,03') && root.textContent.includes('2099') && root.textContent.includes('10'),'server_quote_missing');
 get('email').value='payer@example.test';get('checkout').click();get('checkout').click();await wait(()=>checkoutCalls.length===1);
 assert(captureCalls.length===1 && Object.keys(checkoutCalls[0]).sort().join(',')==='idempotencyKey,quoteId,receiptContactId' && checkoutCalls[0].quoteId===qid && checkoutCalls[0].receiptContactId===receiptId,'checkout_authority');
 if(scenario.startsWith('pending-') || scenario==='same-session-probe-then401'){
   const before=get('checkout');
   root.querySelector('[data-expert-retry]').click();
   await wait(()=>probeCount===2 && !root.querySelector('[data-expert-status]').textContent.includes('Проверяем'));
   if(scenario==='pending-same-session-probe' || scenario==='same-session-probe-then401')assert(get('checkout')===before && root.textContent.includes('2400,03'),'same_probe_lost_command');
   release();
   if(scenario==='pending-same-session-probe'){
     await wait(()=>!get('checkout').disabled);get('checkout').click();
     await wait(()=>root.querySelector('[data-campaign-link]'));
     assert(checkoutCalls.length===2 && JSON.stringify(checkoutCalls[0])===JSON.stringify(checkoutCalls[1]) && quoteCalls.length===1,'probe_repriced_or_rekeyed');
   }else{
     await new Promise(r=>setTimeout(r,80));
     assert(!root.textContent.includes('2400,03') && !root.querySelector('[data-campaign-link]'),'probe_invalidation_late_leak');
     if(scenario!=='pending-probe-identity-change')assert(!get('tariff'),'auth_invalidation_ignored_after_probe');
   }
 }else if(scenario==='logout-checkout'){
   root.querySelector('[data-expert-logout]').click();release();await new Promise(r=>setTimeout(r,80));
   assert(!root.textContent.includes('2400,03') && !root.querySelector('[data-campaign-link]') && location.pathname==='/','late_checkout_leak');
 }else if(scenario==='session-expired'){
   await wait(()=>!get('tariff'));assert(!root.textContent.includes('2400,03') && !root.querySelector('[data-campaign-link]'),'expired_session_leak');
 }else if(scenario==='retry' || scenario==='retry-after-expiry' || scenario==='one-month'){
   if(scenario==='retry' || scenario==='retry-after-expiry'){
     await wait(()=>!get('checkout').disabled);
     if(scenario==='retry-after-expiry')Date.now=()=>Date.parse('2099-01-01T00:00:01.000Z');
     get('checkout').click();
     await wait(()=>checkoutCalls.length===2);
     assert(JSON.stringify(checkoutCalls[0])===JSON.stringify(checkoutCalls[1]) && quoteCalls.length===1,'unstable_retry');
   }
   await wait(()=>root.querySelector('[data-campaign-link]'));
   assert(root.querySelector('[data-campaign-link]').href==='https://checkout.example/pay' && location.pathname==='/' && !root.textContent.includes('Оплачено'),'redirect_or_false_paid');
 }else if(scenario==='rejected'){
   await wait(()=>!get('quote').disabled);assert(get('checkout').disabled,'rejected_quote_reused');get('checkout').click();assert(checkoutCalls.length===1,'rejected_auto_retry');
   get('quote').click();await wait(()=>quoteCalls.length===2);assert(quoteCalls[0].idempotencyKey!==quoteCalls[1].idempotencyKey,'new_quote_key');
 }else{
   await wait(()=>!get('checkout').disabled);
   assert(get('quote').disabled && captureCalls.length===1,'uncertain_purchase_not_frozen');
   assert(!root.querySelector('[data-campaign-link]') && !root.textContent.includes('Оплачено'),'unsafe_or_disabled_payment');
 }
 }
 }
 document.body.dataset.result='PASS';
}catch(error){document.body.dataset.result='FAIL:'+error.message;}
`;
let server: ViteDevServer;
let chrome: ChildProcess;
let directory: string;
let socket: WebSocket;
let origin: string;
let sequence = 0;
const pending = new Map<
  number,
  (value: { result?: Record<string, unknown>; error?: unknown }) => void
>();
function cdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, (value) =>
      value.error
        ? reject(new Error(JSON.stringify(value.error)))
        : resolve(value.result ?? {}),
    );
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "ii-tonya-campaign-browser-"));
  server = await createServer({
    root: resolve("apps/web"),
    configFile: false,
    envDir: false,
    appType: "custom",
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  server.middlewares.use((req, res, next) => {
    if (req.url === "/campaign-harness.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(harness);
      return;
    }
    if (!req.url?.startsWith("/?case=")) return next();
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><body><div id="app"></div><script type="module" src="/campaign-harness.js"></script></body></html>',
    );
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw Error("missing_listener");
  origin = `http://127.0.0.1:${address.port}`;
  chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-debugging-port=0",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      `--user-data-dir=${directory}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("chrome_start_timeout")),
      10000,
    );
    chrome.once("error", reject);
    chrome.stderr!.on("data", (chunk) => {
      const match = String(chunk).match(
        /DevTools listening on (ws:\/\/[^\s]+)/u,
      );
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
  });
  socket = new WebSocket(endpoint);
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data)) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: unknown;
    };
    if (value.id) {
      pending.get(value.id)?.(value);
      pending.delete(value.id);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(Error("chrome_connection"));
  });
});
afterAll(async () => {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exit = new Promise<void>((resolve) =>
      chrome.once("exit", () => resolve()),
    );
    chrome.kill("SIGTERM");
    await exit;
  }
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it.each([
  "retry",
  "disabled",
  "rejected",
  "unsafe-url",
  "malformed-tariff",
  "malformed-quote",
  "logout-quote",
  "logout-checkout",
  "one-month",
  "expired-quote",
  "session-expired",
  "retry-after-expiry",
  "pending-same-session-probe",
  "pending-probe-unauthorized",
  "pending-probe-identity-change",
  "same-session-probe-then401",
])(
  "actual browser campaign journey: %s",
  async (scenario) => {
    const { targetId } = await cdp("Target.createTarget", {
      url: "about:blank",
    });
    try {
      const { sessionId } = await cdp("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await cdp(
        "Page.navigate",
        { url: `${origin}/?case=${scenario}` },
        sessionId as string,
      );
      let result: string | undefined;
      for (let i = 0; i < 200; i++) {
        const value = await cdp(
          "Runtime.evaluate",
          { expression: "document.body?.dataset.result", returnByValue: true },
          sessionId as string,
        );
        result = (value.result as { value?: string } | undefined)?.value;
        if (result) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(result).toBe("PASS");
    } finally {
      await cdp("Target.closeTarget", { targetId });
    }
  },
  15000,
);
