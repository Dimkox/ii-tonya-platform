import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJournal, safeEnvironment } from "./journal-validation.mjs";

const old = [
  { hash: "a".repeat(64), created_at: "1" },
  { hash: "b".repeat(64), created_at: "2" },
];
const candidate = [...old, { hash: "c".repeat(64), created_at: "3" }];
test("only exact complete reviewed histories pass", () => {
  for (const rows of [old, candidate])
    assert.equal(validateJournal(rows, old, candidate), true);
  for (const rows of [
    [],
    old.slice(0, 1),
    [...candidate, { hash: "d".repeat(64), created_at: "4" }],
    [candidate[1], candidate[0], candidate[2]],
    [...old, { ...candidate[2], created_at: "4" }],
  ])
    assert.equal(validateJournal(rows, old, candidate), false);
  assert.equal(
    validateJournal(old, old, [
      { ...candidate[0], hash: "e".repeat(64) },
      ...candidate.slice(1),
    ]),
    false,
  );
});
test("payment and provider flags are disabled and gateway mode is removed", () => {
  const out = safeEnvironment({
    PAYMENTS_ENABLED: "true",
    YOOKASSA_ENABLED: "true",
    EXPERT_TELEGRAM_CHECKOUT_ENABLED: "true",
    YOOKASSA_GATEWAY_CONFIG_FILE: "/fake",
    KEEP: "yes",
  });
  assert.equal(out.PAYMENTS_ENABLED, "false");
  assert.equal(out.YOOKASSA_ENABLED, "false");
  assert.equal(out.PAYMENT_PROVIDER, "disabled");
  assert.equal(out.EXPERT_RESIDENCY_BILLING_ENABLED, "false");
  assert.equal(out.EXPERT_TELEGRAM_CHECKOUT_ENABLED, "false");
  assert.equal(out.YOOKASSA_GATEWAY_CONFIG_FILE, undefined);
  assert.equal(out.KEEP, "yes");
});

test("history check is read-only and rejects mismatched rows", async () => {
  const { assertDatabaseHistory } = await import("./journal-validation.mjs");
  const statements = [];
  const db = {
    $client: {
      query: async (sql) => {
        statements.push(sql);
        return { rows: candidate };
      },
    },
  };
  await assertDatabaseHistory(db, { old, candidate });
  assert.deepEqual(statements, [
    "select hash, created_at::text from drizzle.__drizzle_migrations order by id",
  ]);
  await assert.rejects(
    assertDatabaseHistory(
      { $client: { query: async () => ({ rows: candidate.slice(1) }) } },
      { old, candidate },
    ),
  );
});

test("worker never starts when its independent journal check fails", async () => {
  const { startValidatedWorker } = await import("./journal-validation.mjs");
  const events = [];
  const db = { $client: { query: async () => ({ rows: old.slice(0, 1) }) } };
  await assert.rejects(
    startValidatedWorker(
      {
        createDb: () => db,
        closeDb: async () => {
          events.push("closed");
        },
        start: async () => {
          events.push("started");
        },
      },
      "synthetic",
      { old, candidate },
    ),
  );
  assert.deepEqual(events, ["closed"]);
});

test("worker closes validation connection before start", async () => {
  const { startValidatedWorker } = await import("./journal-validation.mjs");
  const events = [];
  const db = { $client: { query: async () => ({ rows: candidate }) } };
  await startValidatedWorker(
    {
      createDb: () => db,
      closeDb: async () => {
        events.push("closed");
      },
      start: async () => {
        events.push("started");
      },
    },
    "synthetic",
    { old, candidate },
  );
  assert.deepEqual(events, ["closed", "started"]);
});
