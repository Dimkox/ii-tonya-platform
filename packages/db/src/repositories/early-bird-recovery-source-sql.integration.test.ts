import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import { PostgresEarlyBirdRecoveryFingerprintRepository } from "./early-bird-recovery-fingerprint-repository.js";
import { PostgresDeferredRecoverySource } from "../../../../apps/api/src/expert-early-bird-deferred-recovery-source.js";
let f: Awaited<ReturnType<typeof createEarlyBirdOwnerJourney>> | undefined;
afterAll(async () => {
  await f?.db.stop();
}, 120000);
it("executes unknown discovery SELECT against canonical SQL including intent hash tombstones", async () => {
  f = await createEarlyBirdOwnerJourney();
  const db = f.db.db,
    id = f.identity.operationId;
  expect(
    await new PostgresEarlyBirdRecoveryFingerprintRepository(db).read(id),
  ).toBeNull();
  await db.execute(
    sql`update early_bird_composite_intents set status='unknown' where id=${id}::uuid`,
  );
  // Every intent has a hash tombstone already; it is an idempotency guard, not erasure.
  const tombstones = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from early_bird_intent_tombstones`,
  );
  expect(Number(tombstones.rows[0]!.count)).toBeGreaterThan(0);
  const fingerprint = await new PostgresEarlyBirdRecoveryFingerprintRepository(
    db,
  ).read(id);
  expect(fingerprint).toMatchObject({
    operationId: id,
    invoiceId: f.identity.invoiceId,
    totalMinor: "3000",
    mode: "live",
  });
  // Compile and execute every deferred SELECT identifier on the same canonical DB;
  // no matching scoped deferred account may be inferred from a composite invoice.
  const deferred = new PostgresDeferredRecoverySource(db);
  expect(
    await deferred.read(
      { ...f.scope, accountId: crypto.randomUUID() },
      f.identity.invoiceId,
      f.user,
    ),
  ).toEqual({ kind: "unavailable" });
  await db.execute(sql`update users set active=false where id=${f.user}::uuid`);
  expect(
    await new PostgresEarlyBirdRecoveryFingerprintRepository(db).read(id),
  ).toBeNull();
}, 120000);
