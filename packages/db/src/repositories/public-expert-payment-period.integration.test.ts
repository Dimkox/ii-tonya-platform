import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";

import {
  publicFinancialOwner,
  publicFinancialPrepared,
  publicFinancialTerminal,
} from "../testkit/public-expert-payment-financial.js";
const owner = () => publicFinancialOwner(db);
const prepared = (f: Awaited<ReturnType<typeof owner>>) =>
  publicFinancialPrepared(db, f);
const terminal = (f: Awaited<ReturnType<typeof prepared>>, at?: string) =>
  publicFinancialTerminal(db, f, at);

let db: ExpertReferralTestDatabase;
const capture = "2027-01-11T21:00:00.123456Z";
const q = (text: string, values: unknown[] = []) =>
  db.db.$client.query(text, values);
async function call(name: string, args: unknown[]) {
  return (
    await q(
      `select ${name.includes(".") ? name : `early_bird_private.${name}`}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    )
  ).rows[0]!.value;
}
async function clock(at: string) {
  await q(
    `create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$select '${at}'::timestamptz$$`,
  );
}
beforeAll(async () => {
  db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  await db.enableExpertReferralCommands();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
}, 120000);
afterAll(async () => db?.stop(), 120000);

it("posts delayed public capture at Moscow midnight through the canonical engine without truncating microseconds; repairs completion and replay", async () => {
  const f = await prepared(await owner());
  await clock("2027-01-12T12:00:00Z");
  const t = await terminal(f);
  expect(t.action.kind).toBe("ready_to_apply");
  const repo = new PostgresExpertResidencyProviderInboxRepository(db.db);
  const result = await repo.applyPublic(
    f.d.requestId,
    t.observationId,
    t.action.applyAttemptId,
  );
  expect(result).toMatchObject({
    kind: "settled",
    residencyStartsAt: capture,
    residencyEndsAt: "2027-02-10T21:00:00.123456Z",
  });
  expect(
    (
      await q(
        `select early_bird_private.public_time(settled_at) settled,early_bird_private.public_time(residency_starts_at) starts,(residency_starts_at at time zone 'Europe/Moscow')::date::text as "day" from expert_residency_orders where id=$1`,
        [f.order.orderId],
      )
    ).rows[0],
  ).toEqual({ settled: capture, starts: capture, day: "2027-01-12" });
  expect(
    await call("public_payment_complete", [
      f.d.requestId,
      t.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    await repo.applyPublic(
      f.d.requestId,
      t.observationId,
      t.action.applyAttemptId,
    ),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await q(
        "select count(*)::int n from expert_residency_provider_event_inbox where order_id=$1",
        [f.order.orderId],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it("queues a second independently accepted public order after committed coverage with exact capture equality at deadline", async () => {
  const f = await owner();
  const first = await prepared(f),
    a = await terminal(first);
  const repo = new PostgresExpertResidencyProviderInboxRepository(db.db);
  await repo.applyPublic(
    first.d.requestId,
    a.observationId,
    a.action.applyAttemptId,
  );
  expect(
    await call("public_payment_complete", [
      first.d.requestId,
      a.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  const second = await prepared(f),
    b = await terminal(second, "2027-01-11T21:10:00Z");
  expect(b.action.kind).toBe("ready_to_apply");
  const result = await repo.applyPublic(
    second.d.requestId,
    b.observationId,
    b.action.applyAttemptId,
  );
  expect(result).toMatchObject({
    kind: "settled",
    residencyStartsAt: "2027-02-10T21:00:00.123456Z",
    residencyEndsAt: "2027-03-12T21:00:00.123456Z",
  });
  expect(
    await call("public_payment_complete", [
      second.d.requestId,
      b.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
});
it("refuses IDs for a different request without creating any canonical inbox fact", async () => {
  const f = await prepared(await owner()),
    t = await terminal(f);
  await expect(
    new PostgresExpertResidencyProviderInboxRepository(db.db).applyPublic(
      randomUUID(),
      t.observationId,
      t.action.applyAttemptId,
    ),
  ).rejects.toThrow("PUBLIC_PAYMENT_APPLY_UNAVAILABLE");
  expect(
    (
      await q(
        "select count(*)::int n from expert_residency_provider_event_inbox where order_id=$1",
        [f.order.orderId],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
