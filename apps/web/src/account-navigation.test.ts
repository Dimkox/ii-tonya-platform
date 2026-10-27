import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

// New navigation regressions, not repeats of the exhausted account concurrency
// cases. Real DOM/controllers; synthetic HTTP and browser lifecycle event.
const script = `
const scenario = SCENARIO;
const restored = sessionStorage.getItem('restore') === 'yes';
const json = value => new Response(JSON.stringify(value));
window.fetch = async url => {
  if(url === '/v1/browser/session') return json({available:true,authenticated:true,csrfToken:'a'.repeat(64),privacyAvailable:true,bookingAvailable:true,bookingReserveAvailable:true});
  if(url === '/v1/public/catalog') return json({items:[]});
  if(url === '/v1/browser/privacy/consents') return json({consents:[]});
  if(url === '/v1/browser/bookings') return json({bookings:[],nextCursor:null});
  throw Error('unexpected request');
};
const {renderAccountPage, bindPrivacyActions} = await import('/src/consent-view.ts');
history.replaceState(null,'',scenario === 'slash' ? '/account/' : '/account');
document.body.innerHTML = renderAccountPage();
bindPrivacyActions(document);
const delay = () => new Promise(resolve=>setTimeout(resolve,10));
for(let i=0;i<100 && !document.querySelector('[data-export-data]');i++) await delay();
if(scenario === 'restore' && !restored) {
  sessionStorage.setItem('restore','yes');
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
  window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  // A fresh document must recheck session authority instead of retaining old
  // asynchronous actions or automatically repeating a write.
  for(let i=0;i<100;i++) await delay();
  document.body.innerHTML = '<p id="result">FAIL: retained cached document</p>';
} else {
  for(let i=0;i<100 && document.querySelector('[data-reconcile]')?.disabled;i++) await delay();
  const ready = document.querySelector('[data-reconcile]')?.disabled === false;
  document.body.innerHTML = '<p id="result">'+(ready?'PASS':'FAIL: booking absent')+'</p>';
}
`;

it.each(["slash", "restore"])(
  "recovers account navigation: %s",
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), "ii-tonya-navigation-"));
    const server = await createServer({
      root: resolve("apps/web"),
      appType: "custom",
      configFile: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use((req, res, next) => {
      if (
        !["/__navigation-test", "/account", "/account/"].includes(req.url ?? "")
      )
        return next();
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
          `http://127.0.0.1:${address.port}/__navigation-test`,
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
