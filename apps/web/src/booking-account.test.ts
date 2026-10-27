import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

// Real browser integration: no DOM dependency or substitute event/disabled model.
const script = `
let csrf = 'a'.repeat(64), blocked = false;
let finishCatalog, finishDocument;
const json = (v, status=200) => new Response(JSON.stringify(v), {status});
window.fetch = async (url, init={}) => {
  if(url === '/v1/browser/session') return json({available:true,authenticated:true,csrfToken:csrf,privacyAvailable:true,bookingAvailable:true,bookingReserveAvailable:true});
  if(url === '/v1/public/catalog') return json({items:[]});
  if(url === '/v1/browser/privacy/consents') return json({consents:[{purpose:'client_profile',inForce:true,policyVersion:csrf[0]}]});
  if(url === '/v1/browser/bookings') return init.headers['x-csrf-token'] === csrf ? json({bookings:[],nextCursor:null}) : json({},403);
  if(url === '/v1/browser/catalog-requests') return json({catalogRequestId:'00000000-0000-4000-8000-000000000101',state:'pending'},202);
  if(String(url).includes('/catalog-requests/')) return new Promise(r => {finishCatalog = () => r(json({state:'ready',cards:[]}));});
  if(url === '/v1/browser/privacy/presentations') return new Promise(r => {finishDocument = () => r(json({token:'fixture',policyVersion:'a',document:{id:'fixture',documentKey:'consent.client_profile',title:'Fixture',body:'Fixture',version:1,textSha256:'a'.repeat(64)}}));});
  return json({},500);
};
const { renderAccountPage, bindPrivacyActions } = await import('/src/consent-view.ts');
history.replaceState(null,'','/account');
document.body.innerHTML = renderAccountPage();
bindPrivacyActions(document);
const wait = async predicate => {for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('fixture timeout');};
await wait(()=>document.querySelector('[data-withdraw]') && !document.querySelector('[data-find]')?.disabled);
const scenario = SCENARIO;
if(scenario === 'switch') {
  csrf = 'b'.repeat(64);
  document.querySelector('[data-reconcile]').click();
  await new Promise(r=>setTimeout(r,100));
  blocked = document.querySelector('[data-withdraw]') === null;
} else {
  document.querySelector('[data-find]').click();
  await wait(()=>finishCatalog);
  document.querySelector('[data-open-document]').click();
  await wait(()=>finishDocument);
  finishCatalog();
  await new Promise(r=>setTimeout(r,100));
  finishDocument();
  await new Promise(r=>setTimeout(r,100));
  blocked = document.querySelector('[data-find]')?.disabled === false && document.querySelector('[data-reconcile]')?.disabled === false;
}
document.body.innerHTML = '<p id="result">'+(blocked?'PASS':'FAIL')+'</p>';
`;

it.each(["switch", "buttons"])(
  "isolates shared account %s state in real Chrome",
  async (scenario) => {
    const directory = await mkdtemp(
      join(tmpdir(), "ii-tonya-booking-browser-"),
    );
    const server = await createServer({
      root: resolve("apps/web"),
      appType: "custom",
      configFile: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__booking-test", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><body><script type="module">${script.replace("SCENARIO", JSON.stringify(scenario))}</script></body></html>`,
      );
    });
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === "string")
        throw new Error("missing listener");
      const result = await promisify(execFile)(
        "google-chrome",
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--no-first-run",
          "--disable-background-networking",
          `--user-data-dir=${directory}`,
          "--virtual-time-budget=5000",
          "--dump-dom",
          `http://127.0.0.1:${address.port}/__booking-test`,
        ],
        { timeout: 20000, maxBuffer: 1024 * 1024 },
      );
      expect(result.stdout).toContain('<p id="result">PASS</p>');
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
