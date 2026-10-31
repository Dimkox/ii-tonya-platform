import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID } from "node:crypto";
import { PostgresEarlyBirdOwnerSnapshotPrepare } from "./early-bird-owner-snapshot-prepare.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { PostgresEarlyBirdReviewReconciliationReader } from "./early-bird-review-reconciliation-reader.js";
let db: ExpertReferralTestDatabase;
async function expectStatementTimeout(operation: Promise<unknown>) {
  const error: unknown = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  let current = error;
  const codes: unknown[] = [];
  for (
    let depth = 0;
    depth < 8 && current && typeof current === "object";
    depth += 1
  ) {
    const item = current as { code?: unknown; cause?: unknown };
    codes.push(item.code);
    current = item.cause;
  }
  expect(codes).toContain("57014");
}
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  await applyEarlyBirdDraftIfNeeded(
    db.db,
    "docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql",
  );
}, 120000);
afterAll(async () => {
  await db?.stop();
}, 120000);
it("cancels a blocked reader statement and reuses the connection afterwards", async () => {
  let ready!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = db.db.transaction(async (tx) => {
    await tx.execute(
      sql`lock table resident_review_events in access exclusive mode`,
    );
    ready();
    await gate;
  });
  await locked;
  const reader = new PostgresEarlyBirdReviewReconciliationReader(db.db, 1000);
  try {
    await expectStatementTimeout(reader.list(undefined, 10));
  } finally {
    release();
    await holder;
  }
  await expect(reader.list(undefined, 10)).resolves.toEqual([]);
}, 120000);

it("cancels a blocked preparation transaction without calling the sealer", async () => {
  let ready!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = db.db.transaction(async (tx) => {
    await tx.execute(
      sql`lock table consent_document_versions in access exclusive mode`,
    );
    ready();
    await gate;
  });
  await locked;
  const store = new PostgresEarlyBirdOwnerSnapshotPrepare(db.db, 1000);
  const input = {
    userId: randomUUID(),
    baseId: randomUUID(),
    choiceId: randomUUID(),
    grantId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    requestExpiresAt: new Date().toISOString(),
  };
  let called = false;
  const seal = Object.assign(
    () => {
      called = true;
      return { digest: "", ciphertext: "", keyReference: "" };
    },
    { fingerprint: () => ({ digest: "", keyReference: "" }) },
  );
  try {
    await expectStatementTimeout(store.prepare(input, seal));
  } finally {
    release();
    await holder;
  }
  expect(called).toBe(false);
  await expect(store.prepare(input, seal)).resolves.toEqual({
    kind: "unavailable",
  });
}, 120000);
