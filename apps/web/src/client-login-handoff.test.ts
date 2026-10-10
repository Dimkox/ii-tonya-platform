import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

// Exercises the real view/controller. Only HTTP and external navigation are
// replaced: no Telegram request, login proof or production identity is created.
const script = `
const scenarios = ['ii_tonya_assistant_bot', undefined, 'evil.example/evilbot'];
const failures = [];
for (const botUsername of scenarios) {
  const opened = [], writes = [];
  window.open = (...args) => { opened.push(args); return null; };
  window.fetch = async (url, options) => {
    if (options?.method && options.method !== 'GET') writes.push(url);
    if (url !== '/v1/browser/session') throw Error('unexpected request');
    return new Response(JSON.stringify({available:true,authenticated:false,
      csrfToken:'a'.repeat(64),botUsername,widgetEnabled:false,
      privacyAvailable:true,erasureAvailable:false,bookingAvailable:false,
      bookingReserveAvailable:false}));
  };
  const {renderAccountPage,bindPrivacyActions} = await import('/src/consent-view.ts');
  document.body.innerHTML = renderAccountPage();
  bindPrivacyActions(document);
  const delay = () => new Promise(resolve=>setTimeout(resolve,10));
  for(let i=0;i<100 && document.querySelector('[data-login]').disabled;i++) await delay();
  if(opened.length) failures.push('automatic navigation');
  document.querySelector('[data-login]').click();
  for(let i=0;i<20;i++) await delay();
  if(botUsername === 'ii_tonya_assistant_bot') {
    if(JSON.stringify(opened) !== JSON.stringify([
      ['https://t.me/ii_tonya_assistant_bot','_self','noopener,noreferrer']
    ])) failures.push('valid login did not open the client bot');
  } else if(opened.length) failures.push('invalid bot navigation');
  if(writes.length) failures.push('handoff wrote client state');
}
document.body.innerHTML = '<p id="result">'+(failures.length?failures.join(';'):'PASS')+'</p>';
`;

it("opens only the server-selected client bot on an explicit browser login click", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ii-tonya-login-handoff-"));
  const server = await createServer({
    root: resolve("apps/web"),
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/__login-handoff-test") return next();
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<html><body><script type="module">${script}</script></body></html>`,
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
        `http://127.0.0.1:${address.port}/__login-handoff-test`,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    expect(result.stdout).toContain('<p id="result">PASS</p>');
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
