// Maintained DOM/real-Window.fetch regression. No dependency installation, no
// external services, real credentials or project data. Point PLAYWRIGHT_MODULE_PATH
// at an existing Playwright installation; build apps/web first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!modulePath)
  throw new Error(
    "PLAYWRIGHT_MODULE_PATH is required (existing installation only)",
  );
const { chromium } = await import(
  pathToFileURL(resolve(modulePath, "index.mjs")).href
);
const webRoot = resolve("apps/web/dist");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const file = resolve(
    webRoot,
    pathname === "/account" ? "index.html" : `.${pathname}`,
  );
  if (!file.startsWith(webRoot + "/")) {
    response.writeHead(404).end();
    return;
  }
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
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.Telegram = { WebApp: { initData: "synthetic-DOM-proof" } };
  });
  let authenticated = false,
    firstProbe = true,
    grantStatus = 409,
    failReads = false;
  let grantCalls = 0,
    presentationCalls = 0,
    probeCalls = 0;
  const heldProbe = Promise.withResolvers();
  const requestedProbe = Promise.withResolvers();
  let states = [
    { purpose: "client_profile", inForce: true, policyVersion: "profile-v1" },
  ];
  const documentBody =
    '<img src=x onerror="window.executed=true">\n<script>window.executed=true</script> & exact text';
  await page.route("**/v1/browser/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let status = 200,
      body = {};
    if (path.endsWith("/session")) {
      if (request.method() === "GET") {
        probeCalls++;
        if (firstProbe) {
          firstProbe = false;
          requestedProbe.resolve();
          await heldProbe.promise;
        }
      }
      if (request.method() === "POST") {
        authenticated = true;
        status = 201;
      }
      if (request.method() === "DELETE") authenticated = false;
      body = {
        available: true,
        authenticated,
        csrfToken: "synthetic-csrf",
        botUsername: "synthetic_bot",
        privacyAvailable: true,
        widgetEnabled: false,
        erasureAvailable: false,
      };
    } else if (path.endsWith("/consents")) {
      status = failReads ? 503 : 200;
      body = { consents: states };
    } else if (path.endsWith("/presentations")) {
      presentationCalls++;
      body = {
        token: `presentation-${presentationCalls}`,
        policyVersion: "profile-v2",
        document: {
          id: "synthetic",
          documentKey: "consent.client_profile",
          title: "Synthetic <title>",
          body: documentBody,
          version: 2,
          textSha256: "a".repeat(64),
        },
      };
      status = 201;
    } else if (path.endsWith("/decisions")) {
      grantCalls++;
      status = grantStatus;
      if (status === 201) {
        states[0].policyVersion = "profile-v2";
        failReads = true;
      }
    } else if (path.endsWith("/withdraw")) {
      const { purpose } = request.postDataJSON();
      status = purpose === "client_profile" ? 200 : 503;
      if (status === 200)
        states = states.filter((state) => state.purpose !== purpose);
      else failReads = true;
    } else if (path.endsWith("/export")) body = { synthetic: true };
    else status = 404;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/account`);
  await requestedProbe.promise;
  assert.equal(
    await page.locator("[data-retry]").isDisabled(),
    true,
    "initial refresh serializes all actions",
  );
  assert.equal(await page.locator("[data-login]").isDisabled(), true);
  heldProbe.resolve();
  await page.waitForFunction(
    () => !document.querySelector("[data-login]").disabled,
  );
  await page.locator("[data-login]").click();
  const open = page.locator('[data-open-document="client_profile"]');
  await open.click();
  assert.equal(
    await page.locator(".consent-document").textContent(),
    documentBody,
  );
  assert.equal(
    await page.locator("[data-document] img, [data-document] script").count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.executed), undefined);
  assert.equal(grantCalls, 0, "opening never grants");
  assert.equal(
    await page.locator('[data-decision="granted"]').count(),
    1,
    "newer-version grant remains available",
  );
  assert.equal(
    await page.locator('[data-decision="denied"]').count(),
    0,
    "denial cannot withdraw an active grant",
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать документ", exact: true })
    .click();
  assert.equal(
    await readFile(await (await downloaded).path(), "utf8"),
    documentBody,
  );
  await page.locator('[data-decision="granted"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-account-status]")
      .textContent.includes("изменились"),
  );
  assert.equal(
    await page.locator("[data-decision]").count(),
    0,
    "uncertain/failed decisions invalidate visible controls",
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-open-document"),
    ),
    "client_profile",
  );
  // A 403 refreshes session/CSRF/state, but never retries the mutation.
  grantStatus = 403;
  await open.click();
  const priorProbes = probeCalls;
  await page.locator('[data-decision="granted"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-account-status]")
      .textContent.includes("не повторён"),
  );
  assert.equal(grantCalls, 2);
  assert.ok(probeCalls > priorProbes);
  grantStatus = 201;
  await open.click();
  await page.locator('[data-decision="granted"]').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-account-status]")
        .textContent.includes("Решение сохранено.") &&
      document
        .querySelector("[data-account-status]")
        .textContent.includes("Не удалось обновить"),
  );
  assert.equal(grantCalls, 3);
  failReads = false;
  states.push({
    purpose: "follow_up",
    inForce: true,
    policyVersion: "follow-up-v1",
  });
  await page.locator("[data-retry]").click();
  await page.locator("[data-withdraw-all]").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-account-status]")
        .textContent.includes("Подтверждено отзывов: 1") &&
      document
        .querySelector("[data-account-status]")
        .textContent.includes("не подтверждён"),
  );
  assert.match(
    await page.locator("[data-account-status]").textContent(),
    /Необязательное сопровождение/,
  );
  failReads = false;
  await page.locator("[data-retry]").click();
  const exported = page.waitForEvent("download");
  await page.locator("[data-export-data]").click();
  assert.deepEqual(
    JSON.parse(await readFile(await (await exported).path(), "utf8")),
    { synthetic: true },
  );
  await page.locator("[data-logout]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-account-status]")
      .textContent.includes("Ты вышел"),
  );
  assert.equal(await page.locator("[data-open-document]").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS real-browser account DOM regression: initial serialization, literal document/download, new-version grant, 409/403 recovery without replay, truthful confirmed/partial outcomes, focus, export, logout",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
