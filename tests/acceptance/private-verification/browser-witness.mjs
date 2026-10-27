import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createPrivateObjectStore } from "../../../packages/integrations/dist/index.js";
const req = createRequire(new URL("../../../package.json", import.meta.url));
const { build } = createRequire(req.resolve("tsup"))("esbuild");
const compiled = await build({
  stdin: {
    contents: `import {renderExpertVerificationPage,bindExpertVerificationActions} from './apps/web/src/expert-verification-view.ts';document.body.innerHTML=renderExpertVerificationPage();bindExpertVerificationActions(document.body);`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const id = "11111111-1111-4111-8111-111111111111";
const token = "synthetic-session-token-1234567890";
let grants = 0,
  reads = 0,
  recoveries = 0;
const store = createPrivateObjectStore({
  bucket: "browser-fixture",
  region: "test-1",
  endpoint: "https://private-storage.example.test",
  credentials: { accessKeyId: "local-access", secretAccessKey: "local-secret" },
  dedicatedNonVersionedVerified: true,
});
const url = await store.presign({
  key: "custody/" + id,
  custodyId: id,
  sha256: "a".repeat(64),
  size: 32,
  mimeType: "application/pdf",
});
const base = {
  applicationId: id,
  status: "pending",
  maskedContact: "telegram:***",
  quoteId: id,
  termMonths: 1,
  priceMinor: "999000",
  currency: "RUB",
};
const server = createServer((q, s) => {
  if (q.url === "/") {
    s.setHeader("content-type", "text/html");
    s.end(
      '<!doctype html><meta charset="utf-8"><script src="/bundle.js" defer></script><body></body>',
    );
    return;
  }
  if (q.url === "/bundle.js") {
    s.setHeader("content-type", "text/javascript");
    s.end(compiled.outputFiles[0].text);
    return;
  }
  if (!q.url.startsWith("/v1/")) {
    s.statusCode = 404;
    s.end();
    return;
  }
  assert.equal(q.headers.authorization, "Bearer " + token);
  s.setHeader("cache-control", "no-store");
  s.setHeader("content-type", "application/json");
  let data;
  if (q.url.includes("/documents/")) {
    grants++;
    data = { item: { url, expiresIn: 120, bearerUntilExpiry: true } };
  } else if (q.url.includes("/private-evidence")) {
    reads++;
    data = {
      item: {
        documents: Array.from(
          { length: q.url.includes("?after=") ? 1 : 30 },
          (_, n) => ({
            id:
              n === 0
                ? id
                : `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`,
            purpose: "education",
            state: "verified",
            observation: { result: "MATCH", authenticity: "unverified" },
          }),
        ),
        evidence: {
          status: "complete",
          current: false,
          result: { scorePolicy: "not_configured" },
        },
      },
    };
  } else if (q.url.includes("/private-recovery")) {
    recoveries++;
    data = {
      item:
        q.method === "GET"
          ? Array.from(
              { length: q.url.includes("?after=") ? 1 : 50 },
              (_, n) => ({
                id:
                  n === 0
                    ? id
                    : `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
                writeState: "unknown",
                deleteState: "unknown",
                attempts: 3,
              }),
            )
          : { queued: true },
    };
  } else if (q.url.includes("?limit=")) data = { items: [base] };
  else
    data = {
      item: {
        ...base,
        userId: id,
        contact: [],
        questionnaire: {
          status: "submitted",
          draft: { city: "Казань" },
          submittedRevision: 2,
          formVersion: 2,
          revision: 2,
          generation: 1,
          lifecycle: "UNDER_REVIEW",
          supplements: [],
          messages: [],
        },
      },
    };
  s.end(JSON.stringify({ kind: "ok", ...data }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const profile = await mkdtemp(tmpdir() + "/private-browser-");
const chrome = spawn(
  "/usr/bin/google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = (await readFile(profile + "/DevToolsActivePort", "utf8")).split(
        "\n",
      )[0];
      break;
    } catch {
      await wait(50);
    }
  }
  assert(port);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const r = JSON.parse(e.data);
    if (r.id) {
      pending.get(r.id)?.(r);
      pending.delete(r.id);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++n;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result.exceptionDetails)
      throw Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  await wait(500);
  await evaluate(
    `document.querySelector('[data-verification-token]').value=${JSON.stringify(token)};document.querySelector('[data-verification-connect]').click();`,
  );
  await wait(200);
  await evaluate(
    `document.querySelector('[data-verification-queue] button').click()`,
  );
  await wait(200);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Документы и наблюдения').click()`,
  );
  await wait(200);
  assert.equal(reads, 1);
  assert.equal(grants, 0);
  assert(
    await evaluate(`document.body.textContent.includes("Наблюдения устарели")`),
  );
  await evaluate(
    `[...document.querySelectorAll("button")].find(b=>b.textContent==="Следующие документы").click()`,
  );
  await wait(200);
  assert.equal(reads, 2);
  assert.equal(grants, 0);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Открыть документ на 120 секунд').click()`,
  );
  await wait(200);
  assert.equal(grants, 1);
  const actual = await evaluate(
    `document.querySelector('a[href*="X-Amz-Signature"]').href`,
  );
  assert.equal(new URL(actual).searchParams.get("X-Amz-Expires"), "120");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const screenshot = await call("Page.captureScreenshot");
  await writeFile(
    ".superpowers/sdd/verification-private-jobs-20261026/manager-browser.png",
    Buffer.from(screenshot.result.data, "base64"),
  );
  await evaluate(
    `document.querySelector('[data-verification-private-recovery]').click()`,
  );
  await wait(200);
  assert(recoveries > 0);
  assert(
    await evaluate(
      `document.body.textContent.includes('удаление не подтверждено')`,
    ),
  );
  await evaluate(
    `document.querySelector('[data-verification-private-recovery]').click()`,
  );
  await wait(200);
  assert.equal(recoveries, 2);
  await evaluate(
    `document.querySelector('[data-verification-logout]').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('a[href*="X-Amz-Signature"]').length`,
    ),
    0,
  );
  console.log(
    JSON.stringify({
      actualChrome: true,
      managerReadRequests: reads,
      linkOnlyOnClick: grants === 1,
      actualSigned120SecondLink: true,
      orphanRecoveryVisible: true,
      documentAndRecoveryPaging: true,
      expiredObservationsMarked: true,
      logoutClearsDom: true,
    }),
  );
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await new Promise((r) => chrome.once("exit", r));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
