import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createPrivateObjectStore } from "../../../packages/integrations/dist/index.js";
const req = createRequire(new URL("../../../package.json", import.meta.url));
const { build } = createRequire(req.resolve("tsup"))("esbuild");
const baseline = process.env.PRIVATE_BROWSER_BASELINE_SHA;
const compiled = await build({
  stdin: {
    contents:
      (baseline
        ? execFileSync(
            "git",
            ["show", baseline + ":apps/web/src/expert-verification-view.ts"],
            { encoding: "utf8" },
          )
        : `import {renderExpertVerificationPage,bindExpertVerificationActions} from './expert-verification-view.ts';`) +
      `document.body.innerHTML=renderExpertVerificationPage();bindExpertVerificationActions(document.body);`,
    resolveDir: process.cwd() + "/apps/web/src",
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const id = "11111111-1111-4111-8111-111111111111";
const bId = "44444444-4444-4444-8444-444444444444";
let hold;
function defer(kind, error = false) {
  let arrived, release;
  const ready = new Promise((r) => (arrived = r)),
    gate = new Promise((r) => (release = r));
  hold = { kind, error, arrived, gate };
  return { ready, release };
}
const token = "synthetic-session-token-1234567890";
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
const server = createServer(async (q, s) => {
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
  if (
    hold &&
    ((hold.kind === "link" && q.url.includes("/documents/")) ||
      (hold.kind === "page" && q.url.includes("/private-evidence?")) ||
      (hold.kind === "evidence" && q.url.endsWith("/private-evidence")) ||
      (hold.kind === "recovery" && q.url.includes("/private-recovery")))
  ) {
    const h = hold;
    hold = undefined;
    h.arrived();
    await h.gate;
    if (h.error) {
      s.statusCode = 503;
      s.end(JSON.stringify({ error: "unavailable" }));
      return;
    }
  }
  let data;
  if (q.url.includes("/documents/")) {
    data = { item: { url, expiresIn: 120, bearerUntilExpiry: true } };
  } else if (q.url.includes("/private-evidence")) {
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
            observation: {
              result: "MATCH",
              authenticity: "unverified",
              institution: "A_PRIVATE_EVIDENCE",
            },
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
  } else if (q.url.includes("?limit="))
    data = { items: [base, { ...base, applicationId: bId }] };
  else
    data = {
      item: {
        ...base,
        applicationId: q.url.includes(bId) ? bId : id,
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
  const click = async (label) => {
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`,
    );
    await wait(100);
  };
  const connect = async () => {
    await evaluate(
      `document.querySelector('[data-verification-token]').value=${JSON.stringify(token)};document.querySelector('[data-verification-connect]').click()`,
    );
    await wait(120);
  };
  const open = async (index) => {
    await evaluate(
      `document.querySelectorAll('[data-verification-queue] button')[${index}].click()`,
    );
    await wait(120);
  };
  await connect();
  const outcomes = [];
  for (const kind of ["evidence", "page", "link", "recovery"])
    for (const error of [false, true]) {
      await open(0);
      if (kind === "link" || kind === "page")
        await click("Документы и наблюдения");
      const deferred = defer(kind, error);
      if (kind === "link") await click("Открыть документ на 120 секунд");
      else if (kind === "page") await click("Следующие документы");
      else if (kind === "recovery") {
        await evaluate(
          `document.querySelector('[data-verification-private-recovery]').click()`,
        );
      } else await click("Документы и наблюдения");
      await deferred.ready;
      await open(1);
      assert(
        await evaluate(
          `document.querySelector('[data-verification-detail]').textContent.includes(${JSON.stringify(bId)})`,
        ),
      );
      const before = await evaluate(
        `document.querySelector('[data-verification-status]').textContent`,
      );
      deferred.release();
      await wait(120);
      assert.equal(
        await evaluate(
          `document.querySelector('[data-verification-detail]').textContent.includes('A_PRIVATE_EVIDENCE')`,
        ),
        false,
      );
      assert.equal(
        await evaluate(
          `document.querySelectorAll('a[href*="X-Amz-Signature"]').length`,
        ),
        0,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[data-verification-detail]').textContent.includes('удаление не подтверждено')`,
        ),
        false,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[data-verification-status]').textContent`,
        ),
        before,
      );
      outcomes.push({ kind, error, selectedBPreserved: true });
    }
  for (const kind of ["evidence", "link"]) {
    await open(0);
    if (kind === "link") await click("Документы и наблюдения");
    const deferred = defer(kind);
    await click(
      kind === "link"
        ? "Открыть документ на 120 секунд"
        : "Документы и наблюдения",
    );
    await deferred.ready;
    await evaluate(
      `document.querySelector('[data-verification-logout]').click()`,
    );
    deferred.release();
    await wait(120);
    assert.equal(
      await evaluate(
        `document.querySelector('[data-verification-detail]').textContent`,
      ),
      "",
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('a[href*="X-Amz-Signature"]').length`,
      ),
      0,
    );
    outcomes.push({ kind, logoutPreserved: true });
    await connect();
  }
  console.log(JSON.stringify({ actualChrome: true, outcomes }));
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await new Promise((r) => chrome.once("exit", r));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
