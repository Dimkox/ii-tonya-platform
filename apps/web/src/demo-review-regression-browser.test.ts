import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

// Distinct review regression budget. Never replay the exhausted walkthrough here.
it("keeps focused status visible and handles synthetic lifecycle resets and export exceptions", async () => {
  const server = await createServer({
    root: resolve("apps/web"),
    configFile: false,
    envDir: false,
    appType: "custom",
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "ii-tonya-demo-review-chrome-"));
    server.middlewares.use((req, res, next) => {
      if (req.url !== "/__demo-review") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">
        import '/src/styles.css';
        import {renderDemoWalkthrough, bindDemoWalkthrough} from '/src/demo-walkthrough.ts';
        const app = document.querySelector('#app');
        app.innerHTML = renderDemoWalkthrough(); bindDemoWalkthrough(app);
        const outcomes = [];
        const check = (condition, message) => {if (!condition) throw Error(message)};
        const query = name => app.querySelector('[data-demo-' + name + ']');
        const run = async (name, fn) => {try {await fn(); outcomes.push(name + ':PASS')} catch(error) {outcomes.push(name + ':FAIL:' + error.message)}};
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

        await run('visible-focus', async () => {
          const clear = query('clear'), status = query('status');
          clear.scrollIntoView({block:'center', behavior:'instant'});
          clear.focus({preventScroll:true});
          check(status.getBoundingClientRect().bottom < 0, 'fixture must put status above viewport');
          clear.click();
          await wait(700);
          const box = status.getBoundingClientRect(), banner = query('banner').getBoundingClientRect();
          check(document.activeElement === status, 'status lost keyboard focus');
          check(box.top >= banner.bottom && box.bottom <= innerHeight, 'focused status is outside unobscured viewport');
          check(status.getAttribute('role') === 'status' && status.tabIndex === -1, 'accessible announcement changed');
        });

        // Same live document/controller: dispatch lifecycle events, never navigate/reload.
        // This proves handlers, not actual BFCache eligibility or browser restoration.
        await run('synthetic-lifecycle', async () => {
          const status = query('status'), service = query('service');
          const seed = () => {
            for (const [name,value] of [['service','demo-1'],['time','example-morning']]) {
              query(name).value = value; query(name).dispatchEvent(new Event('change'));
            }
            query('reserve').click(); query('consent').click();
            check(query('booking').dataset.state === 'reserved' && query('consent').checked, 'seed missing');
          };
          const clean = () => {
            check(query('status') === status && query('service') === service, 'document was replaced');
            check(query('booking').dataset.state === 'none' && !query('consent').checked, 'lifecycle state retained');
            check(service.value === '' && query('time').value === '' && !service.disabled, 'lifecycle selections retained');
            check(query('pay').disabled && query('reserve').disabled, 'lifecycle action enabled');
          };
          seed(); window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})); clean();
          seed(); window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:false}));
          check(query('booking').dataset.state === 'reserved', 'ordinary pageshow reset state');
          window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})); clean();
        });

        await run('export-exception-cleanup', async () => {
          const create = URL.createObjectURL, revoke = URL.revokeObjectURL, click = HTMLAnchorElement.prototype.click;
          const created = [], revoked = [];
          try {
            URL.createObjectURL = () => {throw Error('synthetic allocation failure')};
            query('export').click();
            check(query('status').textContent.includes('не удалось скачать'), 'allocation failure not announced');
            check(!document.querySelector('a[download]'), 'anchor leaked before URL allocation');
            URL.createObjectURL = blob => {const url = create.call(URL, blob); created.push(url); return url};
            URL.revokeObjectURL = url => {revoked.push(url); revoke.call(URL, url)};
            HTMLAnchorElement.prototype.click = function() {throw Error('synthetic download failure')};
            query('export').click();
            check(query('status').textContent.includes('не удалось скачать'), 'download failure not announced');
            check(!document.querySelector('a[download]'), 'failed download anchor leaked');
            await wait(1200);
            check(created.length === 1 && revoked.length === 1 && created[0] === revoked[0], 'failed download URL leaked');
            check(!query('export').disabled, 'export unavailable after failure');
          } finally {
            URL.createObjectURL = create; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click;
          }
        });
        const result = document.createElement('pre'); result.id = 'review-result'; result.textContent = JSON.stringify(outcomes); document.body.append(result);
      </script></body></html>`);
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("listener");
    const result = await promisify(execFile)(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-component-update",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--window-size=390,844",
        `--user-data-dir=${directory}`,
        "--virtual-time-budget=6000",
        "--dump-dom",
        `http://127.0.0.1:${address.port}/__demo-review`,
      ],
      {
        timeout: 20000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      },
    );
    const summary = result.stdout.match(
      /<pre id="review-result">([^<]+)<\/pre>/u,
    )?.[1];
    expect(summary, "browser regression did not produce results").toBeDefined();
    expect(JSON.parse(summary!)).toEqual([
      "visible-focus:PASS",
      "synthetic-lifecycle:PASS",
      "export-exception-cleanup:PASS",
    ]);
  } finally {
    try {
      await server.close();
    } finally {
      if (directory)
        await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}, 30000);
