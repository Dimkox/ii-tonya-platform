import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("renders confirmed erasure and private receipt status in real mobile Chrome without browser storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ii-tonya-erasure-browser-"));
  const server = await createServer({
    root: resolve("apps/web"),
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  const script = `
    const check = (value, label) => { if (!value) throw Error(label); };
    try {
      const { PrivacyClient } = await import('/src/privacy-client.ts');
      const { erasureMarkup, bindErasureActions } = await import('/src/erasure-view.ts');
      let sent = 0; let first; let downloads = 0;
      const json = value => new Response(JSON.stringify(value));
      const view = {requestId:'r',requestedAt:'2026-10-09T00:00:00.000Z',stage:'awaiting_execution',retainedFacts:null};
      const client = new PrivacyClient(async (url, init) => {
        if (url.includes('er1.')) throw Error('credential URL');
        if (url.endsWith('/session')) return json({authenticated:true,csrfToken:'csrf',erasureAvailable:true});
        const body = JSON.parse(init.body);
        if (url.endsWith('/erasure-requests')) {
          sent++; check(body.confirmed === true, 'explicit confirmation');
          if (!first) { first = body.receiptToken; throw Error('lost response'); }
          check(first === body.receiptToken, 'retry rotated receipt');
        } else check(init.credentials === 'omit', 'status depends on session');
        return json(view);
      });
      document.body.innerHTML = erasureMarkup();
      const update = bindErasureActions(document,client);
      await client.probe(); update(true);
      const q = key => document.querySelector('[data-erasure-'+key+']');
      const delay = () => new Promise(resolve=>setTimeout(resolve,20));
      HTMLAnchorElement.prototype.click = function() { downloads++; };
      q('prepare').focus(); q('prepare').click();
      check(sent === 0 && q('send').disabled,'premature deletion');
      q('download').click(); check(downloads === 1,'receipt download');
      q('saved').checked = true; q('saved').dispatchEvent(new Event('change'));
      q('send').click(); await delay(); q('send').click(); await delay();
      check(sent === 2 && q('progress').textContent.includes('Запрос принят'), 'retry failed: '+sent+' '+q('progress').textContent);
      check(localStorage.length === 0 && sessionStorage.length === 0, 'stored secret');
      client.authenticated = false; update(false);
      q('token').value = first; q('read').click(); await delay();
      check(q('token').value === '' && q('progress').textContent.includes('ещё не завершено'), 'status unavailable');
      check(document.documentElement.scrollWidth <= innerWidth, 'mobile overflow');
      document.body.innerHTML = '<p id="result">PASS</p>';
    } catch(error) { document.body.innerHTML = '<p id="result">FAIL: '+error.message+'</p>'; }
  `;
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/__erasure-test") return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script type="module">${script}</script></body></html>`,
    );
  });
  try {
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
        "--window-size=390,844",
        `--user-data-dir=${directory}`,
        "--virtual-time-budget=5000",
        "--dump-dom",
        `http://127.0.0.1:${address.port}/__erasure-test`,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    expect(result.stdout).toContain('<p id="result">PASS</p>');
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
