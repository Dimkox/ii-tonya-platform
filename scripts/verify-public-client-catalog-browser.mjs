// Real DOM and Window.fetch against loopback synthetic inventory only.
// Uses an existing Playwright installation; installs nothing. Build web first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!modulePath) throw new Error("PLAYWRIGHT_MODULE_PATH is required");
const { chromium } = await import(
  pathToFileURL(resolve(modulePath, "index.mjs")).href
);
const webRoot = resolve("apps/web/dist");
const items = [
  {
    displayName: '<img src=x onerror="window.executed=true">',
    serviceCode: "career",
    language: "ru",
  },
  { displayName: "Beta", serviceCode: "career", language: "en" },
  { displayName: "Gamma", serviceCode: "coaching", language: "en" },
  { displayName: "Delta", serviceCode: "<script>&", language: '<svg>"' },
];
const calls = [];
const held = [];
async function waitForHeld(count) {
  const deadline = Date.now() + 5_000;
  while (held.length < count) {
    if (Date.now() >= deadline)
      throw new Error("Expected request did not enter held list");
    await delay(10);
  }
}
let mode = "hold";
function json(response, value, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.startsWith("/v1/")) {
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
    });
    if (request.url !== "/v1/public/catalog") return json(response, {}, 404);
    if (mode === "hold" || mode === "body") {
      if (mode === "body") {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"items":');
      }
      held.push(response);
      return;
    }
    if (mode === "failure")
      return json(response, { error: "synthetic private error" }, 503);
    if (mode === "malformed")
      return json(response, { items: [{ displayName: "incomplete" }] });
    return json(response, { items: mode === "empty" ? [] : items });
  }
  const file = resolve(
    webRoot,
    ["/", "/catalog", "/account", "/consent", "/my-data"].includes(pathname)
      ? "index.html"
      : `.${pathname}`,
  );
  if (!file.startsWith(webRoot + "/")) return response.writeHead(404).end();
  try {
    response.setHeader(
      "content-type",
      { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
        extname(file)
      ] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  const unexpected = [];
  const observed = [];
  const assets = new Set(
    (await readdir(resolve(webRoot, "assets"))).map(
      (file) => `/assets/${file}`,
    ),
  );
  const allowed = (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== "GET") return false;
    if (request.isNavigationRequest() && url.pathname === "/catalog")
      return true;
    if (url.search || url.hash) return false;
    return url.pathname === "/v1/public/catalog" || assets.has(url.pathname);
  };
  page.on("pageerror", (error) => errors.push(error.message));
  // Observe every request, including same-origin traffic outside /v1/.
  page.on("request", (request) => {
    observed.push(request.url());
    if (!allowed(request)) unexpected.push(request.url());
  });
  await page.route("**/*", async (route) => {
    if (!allowed(route.request())) return route.abort();
    return route.continue();
  });
  await page
    .context()
    .addCookies([
      { name: "synthetic_session", value: "must-not-send", url: origin },
    ]);
  await page.addInitScript(() => {
    window.forbiddenAccess = [];
    for (const key of ["localStorage", "sessionStorage", "Telegram"]) {
      Object.defineProperty(window, key, {
        configurable: true,
        get() {
          window.forbiddenAccess.push(key);
          throw new Error(`forbidden access: ${key}`);
        },
      });
    }
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        window.forbiddenAccess.push("cookie read");
        throw new Error("forbidden cookie read");
      },
      set() {
        window.forbiddenAccess.push("cookie write");
        throw new Error("forbidden cookie write");
      },
    });
  });
  const status = page.locator("[data-catalog-status]");
  const results = page.locator("[data-catalog-results]");
  const service = page.locator("#catalog-service");
  const language = page.locator("#catalog-language");
  const retry = page.locator("[data-catalog-retry]");
  const waitForItems = () =>
    page.waitForFunction(
      () => document.querySelectorAll("[data-catalog-item]").length === 4,
    );
  const privacy = async () => {
    assert.deepEqual(await page.evaluate(() => window.forbiddenAccess), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    assert(observed.length > calls.length);
    for (const call of calls) {
      assert.equal(call.url, "/v1/public/catalog");
      assert.equal(call.method, "GET");
      assert.equal(call.headers.cookie, undefined);
      assert.equal(call.headers.authorization, undefined);
      assert.equal(call.headers.referer, undefined);
    }
  };
  await page.goto(
    `${origin}/catalog?ignored=synthetic-private#synthetic-private`,
  );
  await status.filter({ hasText: "Загружаем каталог…" }).waitFor();
  assert.equal(await results.getAttribute("aria-busy"), "true");
  await page.waitForFunction(
    () => document.title === "Каталог услуг — ии-Тоня",
  );
  await waitForHeld(1);
  mode = "success";
  // The loading indicator is visible before the server's first response.
  assert.equal(held.length, 1);
  json(held.shift(), { items });
  await waitForItems();
  assert.equal(
    await page.locator("[data-catalog-item] h2").first().textContent(),
    items[0].displayName,
  );
  assert.equal(
    await page
      .locator(
        "[data-catalog-results] img, [data-catalog-results] script, select svg",
      )
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.executed), undefined);
  assert.deepEqual(await service.locator("option").allTextContents(), [
    "Все услуги",
    "career",
    "coaching",
    "<script>&",
  ]);
  assert.deepEqual(await language.locator("option").allTextContents(), [
    "Все языки",
    "ru",
    "en",
    '<svg>"',
  ]);
  const beforeFiltering = calls.length;
  const location = page.url();
  await service.selectOption("career");
  await language.selectOption("en");
  assert.deepEqual(
    await page.locator("[data-catalog-item] h2").allTextContents(),
    ["Beta"],
  );
  await service.selectOption("coaching");
  await language.selectOption("ru");
  assert.match(
    await results.textContent(),
    /Среди загруженных услуг нет совпадений/u,
  );
  assert.doesNotMatch(await results.textContent(), /нет опубликованных/u);
  await page.locator("[data-catalog-clear]").click();
  await waitForItems();
  assert.equal(calls.length, beforeFiltering);
  assert.equal(page.url(), location);
  assert.equal(
    await service.evaluate((node) => node === document.activeElement),
    true,
  );
  await privacy();
  assert.equal(await page.locator("main").count(), 1);
  assert.equal(
    await page.locator('section[aria-labelledby="catalog-heading"]').count(),
    1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(await service.isVisible(), true);

  mode = "empty";
  await page.reload();
  await results
    .filter({ hasText: "В каталоге пока нет опубликованных услуг." })
    .waitFor();
  assert.equal(await page.locator("[data-catalog-filters]").isVisible(), false);
  await privacy();
  for (const failureMode of ["failure", "malformed", "hold", "body"]) {
    mode = failureMode;
    await page.reload();
    await status
      .filter({ hasText: "Не удалось загрузить каталог" })
      .waitFor({ timeout: 15_000 });
    assert.equal(await results.textContent(), "");
    assert.equal(await retry.isEnabled(), true);
    // Hold the retry so focus is observed when handling can start, not at click.
    const oldHeld = held.length;
    mode = "hold";
    await retry.click();
    await waitForHeld(oldHeld + 1);
    const ownsFocus = await retry.evaluate(
      (node) => node === document.activeElement,
    );
    const focusedBefore = await page.evaluateHandle(
      () => document.activeElement,
    );
    mode = "success";
    json(held.pop(), { items });
    await waitForItems();
    if (ownsFocus)
      assert.equal(
        await status.evaluate((node) => node === document.activeElement),
        true,
      );
    else
      assert.equal(
        await focusedBefore.evaluate((node) => node === document.activeElement),
        true,
      );
    await focusedBefore.dispose();
    // Late network completion of the timed-out operation cannot erase the retry.
    for (const response of held.splice(0)) response.end("[] }");
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    assert.equal(await page.locator("[data-catalog-item]").count(), 4);
    await privacy();
  }
  mode = "failure";
  await page.reload();
  await status.filter({ hasText: "Не удалось загрузить каталог" }).waitFor();
  mode = "hold";
  await retry.click();
  await waitForHeld(1);
  await page.keyboard.press("Tab");
  assert.equal(
    await retry.evaluate((node) => node === document.activeElement),
    false,
  );
  const focused = await page.evaluate(() => document.activeElement.outerHTML);
  mode = "success";
  json(held.shift(), { items });
  await waitForItems();
  assert.equal(
    await page.evaluate(() => document.activeElement.outerHTML),
    focused,
  );
  await privacy();
  console.log(
    "PASS: real browser loading, safe DOM/options, subset filters/clear, empty vs filtered-empty, error/malformed/request+body timeout/retry, retained/tabbed-away focus, single main landmark, mobile layout, full request allowlist, no private requests/storage/cookies/SDK/external calls.",
  );
} finally {
  await browser?.close();
  for (const response of held.splice(0)) response.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
