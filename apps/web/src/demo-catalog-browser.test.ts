import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("keeps labelled non-bookable demo cards distinct from real catalogue failure in mobile Chrome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ii-tonya-demo-catalog-"));
  const server = await createServer({
    root: resolve("apps/web"),
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/__demo-test") return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script type="module">
      import '/src/styles.css';
      import {renderCatalogPage, bindCatalogActions} from '/src/catalog-view.ts';
      const check = (value, message) => {if (!value) throw Error(message)};
      try {
        document.body.innerHTML = renderCatalogPage();
        bindCatalogActions(document, {list: async () => {throw Error('synthetic outage')}});
        await new Promise(resolve => setTimeout(resolve, 50));
        const demo = document.querySelector('[data-demo-catalog]');
        check(demo.querySelectorAll('[data-demo-card]').length === 6, 'missing cards');
        for (const card of demo.querySelectorAll('[data-demo-card]')) {
          check(card.textContent.includes('Демо · вымышленный профиль'), 'missing demo label');
          check(card.textContent.includes('Запись и оплата недоступны'), 'missing disabled explanation');
        }
        check(!demo.querySelector('a,button,form,input,img'), 'demo external/action authority');
        check(document.querySelector('[data-catalog-status]').textContent.includes('Не удалось'), 'hidden real API outage');
        check(document.querySelector('[data-catalog-results]').children.length === 0, 'mixed real inventory');
        check(document.documentElement.scrollWidth <= innerWidth, 'overflow');
        check(localStorage.length === 0 && sessionStorage.length === 0, 'browser storage');
        document.body.innerHTML = '<p id="result">PASS</p>';
      } catch(error) {document.body.textContent = 'FAIL: ' + error.message}
    </script></body></html>`);
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
        `http://127.0.0.1:${address.port}/__demo-test`,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    expect(result.stdout).toContain('<p id="result">PASS</p>');
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
