// Real Chromium DOM + the shipped browser client, synthetic loopback responses only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!modulePath) throw Error("PLAYWRIGHT_MODULE_PATH is required");
const { chromium } = await import(
  pathToFileURL(resolve(modulePath, "index.mjs")).href
);
const id = "11111111-1111-4111-8111-111111111111",
  text = "Здравствуйте! Анкета одобрена. Оплата ещё не подтверждена.",
  hash = createHash("sha256").update(text).digest("hex");
const entry = {
  applicationId: id,
  status: "pending",
  maskedContact: "telegram:***",
  quoteId: id,
  termMonths: 1,
  priceMinor: "999000",
  currency: "RUB",
};
const confirms = [],
  calls = [];
let count = 0;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const json = (value, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  if (pathname.startsWith("/v1/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ pathname, method: req.method });
    if (pathname.endsWith("review-preview"))
      return json({
        kind: "ok",
        item: { previewId: id, text, hash, expiresAt: "2030-01-01T00:00:00Z" },
      });
    if (pathname.endsWith("review-confirm")) {
      confirms.push(JSON.parse(body));
      return ++count === 1
        ? json({ error: "unavailable" }, 503)
        : json({
            kind: "ok",
            item: { eventId: id, action: "APPROVED_BASIC", replay: true },
          });
    }
    if (pathname.endsWith(id))
      return json({
        kind: "ok",
        item: {
          ...entry,
          userId: id,
          contact: [],
          questionnaire: {
            status: "submitted",
            draft: {
              roles: ["OTHER"],
              motivation: '<img src=x onerror="window.privateExecuted=true">',
            },
            formVersion: 2,
            revision: 2,
            generation: 1,
            submittedRevision: 2,
            lifecycle: "UNDER_REVIEW",
            supplements: null,
            messages: [],
          },
        },
      });
    if (pathname === "/v1/admin/expert-verification")
      return json({ kind: "ok", items: [entry] });
    return json({ error: "unexpected_request" }, 404);
  }
  try {
    const file = pathname.startsWith("/assets/")
      ? resolve("apps/web/dist", pathname.slice(1))
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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${origin}/admin/expert-verification`);
  await page
    .locator("[data-verification-token]")
    .fill("synthetic-session-token-1234567890");
  await page.locator("[data-verification-connect]").click();
  await page.locator("[data-verification-queue] button").click();
  await page.getByLabel("Решение по анкете").waitFor();
  assert.equal(
    await page.locator("[data-verification-approve]").isDisabled(),
    true,
  );
  assert.equal(
    await page.locator("[data-verification-reject]").isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => window.privateExecuted), undefined);
  assert.match(
    await page.locator("[data-verification-detail]").textContent(),
    /<img src=x/,
  );
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Точный текст сообщения"]').value
        .length > 0,
  );
  assert.equal(
    await page.getByLabel("Точный текст сообщения").inputValue(),
    text,
  );
  assert.equal(
    await page.getByLabel("Точный текст сообщения").getAttribute("readonly"),
    "",
  );
  await page
    .getByRole("button", { name: "Подтвердить точный текст", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-verification-status]")
      .textContent.includes("не подтверждён"),
  );
  await page
    .getByRole("button", { name: "Подтвердить точный текст", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-verification-status]")
      .textContent.includes("Решение записано"),
  );
  assert.deepEqual(confirms, [
    { previewId: id, finalHash: hash },
    { previewId: id, finalHash: hash },
  ]);
  assert.equal(
    calls.some((c) => c.pathname.endsWith("/decision")),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: "Chromium",
      submittedForm: true,
      escapedPrivateText: true,
      legacyActionsDisabled: true,
      exactPreview: true,
      failedConfirmationRetry: true,
      confirmationHash: hash,
      requests: calls.length,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
