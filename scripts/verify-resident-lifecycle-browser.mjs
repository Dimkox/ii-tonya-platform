// Shipped staff UI/client in real Chromium; local synthetic responses, no provider.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.env.PLAYWRIGHT_MODULE_PATH)
  throw Error("PLAYWRIGHT_MODULE_PATH required");
const { chromium } = await import(
  pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE_PATH, "index.mjs")).href
);
const id = "11111111-1111-4111-8111-111111111111";
let item = {
  id,
  applicationId: null,
  residentId: id,
  sourceId: "2026-10-27",
  kind: "quality_window",
  status: "open",
  revision: 0,
  createdAt: "2026-10-27T00:00:00.000Z",
  dueAt: null,
  windowStart: "2026-09-27T00:00:00.000Z",
  windowEnd: "2026-10-27T00:00:00.000Z",
  numerator: 2,
  denominator: 6,
  missingProvenance: 1,
  resolution: null,
  resolvedAt: null,
};
const closes = [],
  calls = [];
let hold = false,
  release;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const json = (body, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  if (path.startsWith("/v1/")) {
    calls.push({ path, method: req.method });
    assert.equal(
      req.headers.authorization,
      "Bearer synthetic-session-token-1234567890",
    );
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (path.endsWith("/close")) {
      const command = JSON.parse(raw);
      closes.push(command);
      assert.deepEqual(Object.keys(command).sort(), [
        "expectedRevision",
        "idempotencyKey",
        "resolution",
      ]);
      if (closes.length === 1) return json({ error: "unavailable" }, 503);
      assert.deepEqual(closes[0], command);
      item = {
        ...item,
        status: "resolved",
        revision: 1,
        resolution: command.resolution,
        resolvedAt: "2026-10-27T01:00:00.000Z",
      };
      return json({ kind: "ok", item });
    }
    if (path.endsWith("/lifecycle/" + id)) {
      if (hold)
        await new Promise((r) => {
          release = r;
        });
      return json({ kind: "ok", item });
    }
    if (path.endsWith("/lifecycle")) return json({ kind: "ok", items: [item] });
    if (
      path === "/v1/admin/expert-verification" ||
      path === "/v1/admin/expert-cards"
    )
      return json({ kind: "ok", items: [] });
    return json({ error: "unexpected" }, 404);
  }
  try {
    const file = path.startsWith("/assets/")
      ? resolve("apps/web/dist", path.slice(1))
      : resolve("apps/web/dist/index.html");
    res.writeHead(200, {
      "content-type":
        extname(file) === ".js"
          ? "text/javascript"
          : extname(file) === ".css"
            ? "text/css"
            : "text/html",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE ?? "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + "/admin/expert-verification");
  assert.equal(
    await page.locator("[data-lifecycle-refresh]").isDisabled(),
    true,
  );
  await page
    .locator("[data-verification-token]")
    .fill("synthetic-session-token-1234567890");
  await page.locator("[data-verification-connect]").click();
  await page.locator("[data-lifecycle-refresh]").click();
  await page.locator("[data-lifecycle-list] button").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-lifecycle-detail]")
      .textContent.includes("Отказы эксперта: 2"),
  );
  assert.match(
    await page.locator("[data-lifecycle-detail]").textContent(),
    /Без подтверждённого происхождения: 1/,
  );
  await page
    .locator("[data-lifecycle-resolution]")
    .fill("Расписание проверено <img src=x onerror=alert(1)>");
  await page.locator("[data-lifecycle-close]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-lifecycle-status]")
      .textContent.includes("Можно повторить"),
  );
  await page.locator("[data-lifecycle-close]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-lifecycle-status]")
      .textContent.includes("сохранён"),
  );
  assert.equal(closes.length, 2);
  assert.equal(await page.locator("[data-lifecycle-close]").isDisabled(), true);
  hold = true;
  await page.locator("[data-lifecycle-refresh]").click();
  await page.locator("[data-lifecycle-list] button").click();
  while (!release) await new Promise((r) => setTimeout(r, 10));
  await page.locator("[data-verification-logout]").click();
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("[data-lifecycle-detail]").textContent(), "");
  assert.equal(
    await page.locator("[data-lifecycle-resolution]").inputValue(),
    "",
  );
  assert.equal(
    await page.locator("[data-lifecycle-refresh]").isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      realChromium: true,
      shippedStaffPanel: true,
      protectedClientRequests: calls.length,
      closeRetrySameCommand: true,
      qualityCounts: true,
      logoutClearsDelayedDetail: true,
      providerCalls: 0,
    }),
  );
} finally {
  release?.();
  await browser?.close();
  await new Promise((r) => server.close(r));
}
