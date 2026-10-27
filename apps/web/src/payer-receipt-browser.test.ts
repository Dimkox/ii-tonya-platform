import { beforeAll, afterAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { ExpertCampaignClient } from "./expert-campaign-client.js";
type Capture = { quoteId: string; email: string; idempotencyKey: string };
const quoteId = "11111111-1111-4111-8111-111111111111",
  receiptContactId = "22222222-2222-4222-8222-222222222222";
function captureClient(client: ExpertCampaignClient) {
  return client as unknown as {
    capture(input: Capture): Promise<{
      receiptContactId: string;
      quoteId: string;
      expiresAt: string;
    }>;
  };
}
it("posts plaintext only to the protected capture body and returns opaque selection", async () => {
  const input = {
    quoteId,
    email: "payer@example.test",
    idempotencyKey: "capture-one",
  };
  const client = new ExpertCampaignClient("csrf", async (url, init) => {
    expect(url).toBe("/v1/expert/browser/residency/receipt-contacts");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "x-csrf-token": "csrf" },
      body: JSON.stringify(input),
    });
    return new Response(
      JSON.stringify({
        receiptContactId,
        quoteId,
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    );
  });
  expect(captureClient(client).capture).toBeTypeOf("function");
  expect(await captureClient(client).capture(input)).toEqual({
    receiptContactId,
    quoteId,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
});
it("disposal fences a late capture response", async () => {
  let release!: (response: Response) => void;
  const client = new ExpertCampaignClient(
    "csrf",
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  expect(captureClient(client).capture).toBeTypeOf("function");
  const result = captureClient(client).capture({
    quoteId,
    email: "payer@example.test",
    idempotencyKey: "capture-one",
  });
  client.dispose();
  release(
    new Response(
      JSON.stringify({
        receiptContactId,
        quoteId,
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ),
  );
  await expect(result).rejects.toThrow("stale_response");
});

const harness = String.raw`
import {renderExpertAccountPage,bindExpertAccountActions} from '/src/expert-account-view.ts';
const scenario=new URL(location.href).searchParams.get('case');
const assert=(v,m)=>{if(!v)throw Error(m);};
const wait=async(p)=>{for(let i=0;i<400;i++){if(p())return;await new Promise(r=>setTimeout(r,10));}throw Error('render_timeout');};
const qid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',uid='33333333-3333-4333-8333-333333333333';
const nextQuoteId='44444444-4444-4444-8444-444444444444',nextContactId='55555555-5555-4555-8555-555555555555';
const tariff={tariffVersionId:cid,displayName:'Про',baseMonthlyMinor:'999000',currency:'RUB',durationSeconds:2592000,creditCapBps:3000,individualServicesEnabled:true,groupEventLimit:5,statisticsLevel:'expanded',supportPriority:'priority',priceKind:'base',commercialPolicyVersion:'expert_residency_v2'};
const quote={...tariff,id:qid,userId:uid,termMonths:1,ruleVersion:'expert_energy_start_v1',calculationTimestamp:'2026-10-12T00:00:00.000Z',quotedAt:'2026-10-12T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',discountedMonthlyMinor:'599400',monthlyPriceMinor:'599400',priceMinor:'599400',energyDiscountBps:4000,startDiscountBps:0,floorApplied:false};
const reply=(v,status=200)=>new Response(status===204?null:JSON.stringify(v),{status});
let captures=[],checkouts=[],quotes=[],release,authenticated=true;
Storage.prototype.setItem=function(){throw Error('plaintext_persistence');};
window.fetch=async(url,init={})=>{
 assert(!String(url).includes('payer@'),'contact_in_url');
 if(url.endsWith('/session')){if(init.method==='DELETE'){authenticated=false;return reply(null,204);}return reply({available:true,authenticated,csrfToken:'a'.repeat(64),userId:uid,expertId:cid});}
 if(url.endsWith('/tariffs'))return reply([tariff]);
 assert(init.credentials==='same-origin' && init.cache==='no-store' && init.headers['x-csrf-token']==='a'.repeat(64),'request_security');
 const body=JSON.parse(init.body);
 if(url.endsWith('/quotes')){quotes.push(body);return reply({...quote,id:quotes.length>1?nextQuoteId:qid});}
 if(url.endsWith('/receipt-contacts')){
  captures.push(body);
  if(scenario==='logout-capture')return new Promise(r=>{release=()=>r(reply({receiptContactId:cid,quoteId:qid,expiresAt:'2099-01-01T00:00:00.000Z'}));});
  if(scenario==='missing')return reply({error:'receipt_capture_unavailable'},503);
  if(scenario==='retry-capture' && captures.length===1)throw Error('capture_response_lost');
  return reply({receiptContactId:quotes.length>1?nextContactId:cid,quoteId:body.quoteId,expiresAt:'2099-01-01T00:00:00.000Z'});
 }
 if(url.endsWith('/checkouts')){
  checkouts.push(body);assert(!('email' in body) && body.receiptContactId===(quotes.length>1?nextContactId:cid),'checkout_contact');
  if(scenario.startsWith('terminal-') && checkouts.length===1)return reply({id:qid,status:scenario.slice('terminal-'.length)});
  if(scenario==='retry-checkout' && checkouts.length===1)throw Error('checkout_response_lost');
  return reply({id:qid,status:'payment_pending',payment:{kind:'created',paymentId:'synthetic',checkoutUrl:'https://checkout.example/pay'}});
 }
 throw Error('unexpected_request');
};
const root=document.querySelector('#app');root.innerHTML=renderExpertAccountPage();bindExpertAccountActions(root);
const get=n=>root.querySelector('[data-campaign-'+n+']');
try{
 await wait(()=>get('quote') && !get('quote').disabled);get('quote').click();await wait(()=>get('checkout') && !get('checkout').disabled);
 const email=get('email');assert(email && root.textContent.includes('Email для чека'),'receipt_input_missing');
 assert(!root.querySelector('input[type=checkbox]'),'consent_gate');email.value='payer@example.test';get('checkout').click();await wait(()=>captures.length===1);
 assert(Object.keys(captures[0]).sort().join(',')==='email,idempotencyKey,quoteId','capture_authority');
 if(scenario==='logout-capture'){
  root.querySelector('[data-expert-logout]').click();await wait(()=>!get('email'));release();await new Promise(r=>setTimeout(r,80));
  assert(email.value==='' && checkouts.length===0 && !root.querySelector('[data-campaign-link]'),'logout_private_state');
 }else if(scenario.startsWith('terminal-')){
  await wait(()=>!get('quote').disabled);
  assert(get('checkout').disabled && !get('load').disabled && !get('tariff').disabled && !get('term').disabled,'terminal_controls');
  get('quote').click();await wait(()=>quotes.length===2 && !get('checkout').disabled);
  assert(get('email').value==='' && !get('email').disabled,'fresh_contact_not_reset');
  get('email').value='new-payer@example.test';get('checkout').click();await wait(()=>root.querySelector('[data-campaign-link]'));
  assert(captures.length===2 && checkouts.length===2 && quotes[0].idempotencyKey!==quotes[1].idempotencyKey,'fresh_purchase_missing');
  assert(captures[1].quoteId===nextQuoteId && captures[1].email==='new-payer@example.test' && captures[0].idempotencyKey!==captures[1].idempotencyKey,'capture_reused_after_terminal');
  assert(checkouts[1].quoteId===nextQuoteId && checkouts[1].receiptContactId===nextContactId && checkouts[0].idempotencyKey!==checkouts[1].idempotencyKey,'checkout_reused_after_terminal');
 }else if(scenario==='missing'){
  await wait(()=>!get('checkout').disabled);assert(checkouts.length===0 && get('status').textContent.includes('недоступен'),'missing_capability_lie');
 }else{
  if(scenario==='retry-capture' || scenario==='retry-checkout'){
   await wait(()=>!get('checkout').disabled);assert(get('email').disabled && get('quote').disabled && get('load').disabled,'uncertain_command_not_frozen');get('checkout').click();
  }
  await wait(()=>root.querySelector('[data-campaign-link]'));
  assert(email.value==='','plaintext_not_cleared');
  if(scenario==='retry-capture')assert(captures.length===2 && JSON.stringify(captures[0])===JSON.stringify(captures[1]) && checkouts.length===1,'capture_rekeyed');
  if(scenario==='retry-checkout')assert(captures.length===1 && checkouts.length===2 && JSON.stringify(checkouts[0])===JSON.stringify(checkouts[1]),'checkout_rebound');
 }
 document.body.dataset.result='PASS';
}catch(e){document.body.dataset.result='FAIL:'+e.message;}
`;
let server: ViteDevServer,
  chrome: ChildProcess,
  directory: string,
  socket: WebSocket,
  origin: string,
  sequence = 0;
const pending = new Map<
  number,
  (v: { result?: Record<string, unknown>; error?: unknown }) => void
>();
function cdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, (v) =>
      v.error
        ? reject(Error(JSON.stringify(v.error)))
        : resolve(v.result ?? {}),
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
  directory = await mkdtemp(join(tmpdir(), "ii-tonya-payer-browser-"));
  server = await createServer({
    root: resolve("apps/web"),
    configFile: false,
    envDir: false,
    appType: "custom",
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  server.middlewares.use((req, res, next) => {
    if (req.url === "/receipt-harness.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(harness);
      return;
    }
    if (!req.url?.startsWith("/?case=")) return next();
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><body><div id="app"></div><script type="module" src="/receipt-harness.js"></script></body></html>',
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
      const m = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/u);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
  });
  socket = new WebSocket(endpoint);
  socket.addEventListener("message", (event) => {
    const v = JSON.parse(String(event.data)) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: unknown;
    };
    if (v.id) {
      pending.get(v.id)?.(v);
      pending.delete(v.id);
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
  "retry-capture",
  "retry-checkout",
  "logout-capture",
  "missing",
  "terminal-expired",
  "terminal-failed",
  "terminal-settled",
])(
  "Chrome receipt journey: %s",
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
      let result: unknown;
      for (let i = 0; i < 240; i++) {
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
