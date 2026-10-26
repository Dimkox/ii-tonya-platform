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
let holdPreview = false,
  releasePreview;
let terminal = false,
  recovered = false;
const historyCursor =
  "4:00000000-0000-0000-0000-000000000000:00000000-0000-0000-0000-000000000000";
const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  const pathname = requestUrl.pathname;
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
    if (pathname.endsWith("review-preview")) {
      if (holdPreview)
        await new Promise((resolve) => (releasePreview = resolve));
      return json({
        kind: "ok",
        item: { previewId: id, text, hash, expiresAt: "2030-01-01T00:00:00Z" },
      });
    }
    if (pathname.endsWith("review-recovery")) {
      recovered = true;
      return json({
        kind: "ok",
        item: { eventId: id, status: "closed_without_resend" },
      });
    }
    if (pathname.endsWith("review-confirm")) {
      confirms.push(JSON.parse(body));
      if (count === 1) terminal = true;
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
          status: terminal ? "approved" : entry.status,
          userId: id,
          contact: [],
          questionnaire: {
            status: "submitted",
            draft: {
              roles: ["OTHER"],
              motivation: '<img src=x onerror="window.privateExecuted=true">',
            },
            formVersion: 2,
            revision: 6,
            generation: 2,
            submittedRevision: 2,
            lifecycle: terminal ? "APPROVED_BASIC" : "UNDER_REVIEW",
            supplements: {
              answers: [
                {
                  requestId: id,
                  questionNumber: 1,
                  questions: ["Опыт?"],
                  revision: requestUrl.searchParams.has("historyCursor")
                    ? 5
                    : 4,
                  answers: {
                    answer: requestUrl.searchParams.has("historyCursor")
                      ? "ANSWER_LAST_PAGE"
                      : "ANSWER_FIRST_PAGE",
                  },
                },
              ],
              requests: [],
            },
            history: {
              nextCursor: requestUrl.searchParams.has("historyCursor")
                ? null
                : historyCursor,
            },
            messages:
              terminal && !recovered
                ? [{ eventId: id, status: "dispatched", receipt: null }]
                : [],
          },
        },
      });
    if (pathname === "/v1/admin/expert-verification")
      return json({
        kind: "ok",
        items: recovered
          ? []
          : terminal && !requestUrl.searchParams.has("afterApplication")
            ? Array.from({ length: 50 }, (_, i) => ({
                ...entry,
                applicationId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
                status: "approved",
              }))
            : [{ ...entry, status: terminal ? "approved" : entry.status }],
      });
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
  if (process.env.REVIEW_RECOVERY_HISTORY === "true") {
    assert.match(
      await page.locator("[data-verification-detail]").textContent(),
      /ANSWER_FIRST_PAGE/,
    );
    await page
      .getByRole("button", { name: "Следующая страница истории", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-verification-detail]")
        .textContent.includes("ANSWER_LAST_PAGE"),
    );
    assert.match(
      await page.locator("[data-verification-detail]").textContent(),
      /Опыт/,
    );
    await page
      .getByRole("button", { name: "Начало истории", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-verification-detail]")
        .textContent.includes("ANSWER_FIRST_PAGE"),
    );
  }

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
  if (process.env.REVIEW_DELAYED_PREVIEW === "true") {
    holdPreview = true;
    await page
      .getByRole("button", { name: "Предпросмотр", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector("[data-verification-connect]").disabled,
    );
    while (!releasePreview) await new Promise((r) => setTimeout(r, 10));
    await page.getByLabel("Решение по анкете").selectOption("REQ_INFO_GENERIC");
    await page.getByLabel("Тон сообщения").selectOption("warm");
    await page
      .getByLabel("Вопросы, по одному на строку")
      .fill("Changed while awaiting response");
    releasePreview();
    holdPreview = false;
    await page.waitForFunction(
      () => !document.querySelector("[data-verification-connect]").disabled,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Подтвердить точный текст", exact: true })
        .isDisabled(),
      true,
      "R4 stale preview cannot restore confirmability",
    );
    assert.equal(
      await page.getByLabel("Точный текст сообщения").inputValue(),
      "",
    );
    await page.getByLabel("Решение по анкете").selectOption("APPROVED_BASIC");
    await page.getByLabel("Тон сообщения").selectOption("standard");
  }
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
  if (process.env.REVIEW_RECOVERY_HISTORY === "true") {
    await page.reload();
    await page
      .locator("[data-verification-token]")
      .fill("synthetic-session-token-1234567890");
    await page.locator("[data-verification-connect]").click();
    await page
      .getByRole("button", { name: "Следующая страница очереди", exact: true })
      .click();
    await page.getByRole("button", { name: new RegExp(id + " ·") }).click();
    await page
      .getByRole("button", {
        name: "Закрыть неопределённую доставку без повтора",
        exact: true,
      })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-verification-status]")
        .textContent.includes("закрыта"),
    );
    assert.equal(recovered, true);
    assert.equal(confirms.length, 2);
    await page.locator("[data-verification-refresh]").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-verification-queue]").children.length ===
        0,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: "Chromium",
      submittedForm: true,
      escapedPrivateText: true,
      legacyActionsDisabled: true,
      exactPreview: true,
      delayedPreviewFenced: process.env.REVIEW_DELAYED_PREVIEW === "true",
      terminalRecoveryAfterReload: recovered,
      historyPaging: process.env.REVIEW_RECOVERY_HISTORY === "true",
      failedConfirmationRetry: true,
      confirmationHash: hash,
      requests: calls.length,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
