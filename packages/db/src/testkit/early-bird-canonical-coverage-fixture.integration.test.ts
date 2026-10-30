import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createEarlyBirdCanonicalCoverageFixture } from "./early-bird-canonical-coverage-fixture.js";

let fixture: Awaited<
  ReturnType<typeof createEarlyBirdCanonicalCoverageFixture>
>;
beforeAll(async () => {
  fixture = await createEarlyBirdCanonicalCoverageFixture();
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("keeps full canonical source guards through verified payment and refund instead of installing reduced tables", async () => {
  const query = fixture.db.db.$client.query.bind(fixture.db.db.$client);
  const journal = JSON.parse(
    readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: unknown[] };
  expect(
    (await query("select count(*)::int n from drizzle.__drizzle_migrations"))
      .rows[0]!.n,
  ).toBe(journal.entries.length);
  expect(
    (await query("show server_version_num")).rows[0]!.server_version_num,
  ).toBe("170005");
  expect(
    Math.abs(
      Number(
        (await query("select extract(epoch from clock_timestamp())*1000 n"))
          .rows[0]!.n,
      ) - Date.now(),
    ),
  ).toBeLessThan(1500);
  expect(
    (
      await query(
        "select status,base_id,choice_id,config_id from early_bird_composite_intents where id=$1",
        [fixture.intentId],
      )
    ).rows[0],
  ).toMatchObject({
    status: "unknown",
    base_id: fixture.owner.base,
    choice_id: fixture.owner.choice,
    config_id: expect.any(String),
  });
  expect(
    (await query("select count(*)::int n from early_bird_payment_successes"))
      .rows[0]!.n,
  ).toBe(0);
  await expect(
    query("select early_bird_private.bind_verified($1,$2,$3,$4,$5::jsonb)", [
      fixture.intentId,
      fixture.expert.userId,
      fixture.payment.id,
      fixture.candidateProof.evidenceDigest,
      JSON.stringify({ ...fixture.bindingSnapshot, totalMinor: "1" }),
    ]),
  ).rejects.toMatchObject({ message: "early_bird_binding_snapshot_conflict" });
  await expect(
    query(
      "select early_bird_commit_verified_payment($1::jsonb,$2,$3::timestamptz)",
      [
        JSON.stringify({ ...fixture.paymentSnapshot, userId: randomUUID() }),
        fixture.paymentProof.evidenceDigest,
        fixture.paymentProof.capturedAt,
      ],
    ),
  ).rejects.toMatchObject({
    message: "early_bird_settlement_binding_mismatch",
  });
  expect(
    (await query("select count(*)::int n from early_bird_payment_successes"))
      .rows[0]!.n,
  ).toBe(0);
  await fixture.recordWaveSuccess();
  await fixture.recordWaveSuccess();
  expect(
    (
      await query(
        "select disposition,starts_at,ends_at from early_bird_payment_successes where intent_id=$1",
        [fixture.intentId],
      )
    ).rows,
  ).toEqual([
    {
      disposition: "eligible",
      starts_at: new Date("2027-01-10T21:00:00Z"),
      ends_at: new Date("2027-02-09T21:00:00Z"),
    },
  ]);
  await expect(
    query("update early_bird_composite_intents set total_minor=1 where id=$1", [
      fixture.intentId,
    ]),
  ).rejects.toThrow();
  await fixture.recordFullRefund();
  expect(
    (
      await query(
        "select status from early_bird_composite_intents where id=$1",
        [fixture.intentId],
      )
    ).rows[0]!.status,
  ).toBe("refunded");
  expect(
    (
      await query(
        "select count(*)::int n from early_bird_effective_coverages where intent_id=$1",
        [fixture.intentId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await query(
        "select count(*)::int n from early_bird_payment_full_refunds where intent_id=$1",
        [fixture.intentId],
      )
    ).rows[0]!.n,
  ).toBe(1);
}, 120_000);
