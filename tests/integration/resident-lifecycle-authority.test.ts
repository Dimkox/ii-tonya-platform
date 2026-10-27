import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  database,
  tariffId,
  workScope,
  event,
  hash,
  secondRichFixture,
  nativeFixture,
  normalFormOnboarding,
  startAuthorityFixture,
  stopAuthorityFixture,
} from "../support/resident-lifecycle-authority-fixtures.js";
import { PostgresResidentLifecycleCompletionRepository } from "../../packages/db/src/repositories/resident-lifecycle-completion-repository.js";
import { PostgresExpertPersonalOfferRepository } from "../../packages/db/src/repositories/expert-personal-offer-repository.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { lockClientConsentSubject } from "../../packages/db/src/repositories/client-consent-authority.js";
import { expireLockedExpertResidencyOrder } from "../../packages/db/src/repositories/expert-residency-repository.js";
import type { DrizzleDb } from "../../packages/db/src/client.js";
const policy = {
  workBotId: workScope.botId,
  workBotKey: workScope.botKey,
  messagingConsentPolicyVersion: "client-messaging-v1",
};
const notices = async (userId: string) =>
  (
    await database.db.execute<{ id: string; state: string; attempts: number }>(
      sql`select id,state,attempt_count attempts from resident_work_notices where user_id=${userId}::uuid order by created_at,id`,
    )
  ).rows;
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
beforeAll(startAuthorityFixture, 120000);
afterAll(stopAuthorityFixture, 120000);
it("suppresses a genuinely superseded review and refuses a changed original recipient without rerouting", async () => {
  const f = await secondRichFixture();
  await f.approve();
  const original = (await notices(f.userId))[0]!;
  await f.approve();
  const current = (await notices(f.userId)).at(-1)!;
  expect(current.id).not.toBe(original.id);
  const wire: string[] = [];
  const worker = new PostgresResidentLifecycleCompletionRepository(
    database.db,
    {
      ...policy,
      transport: {
        send: async (input) => {
          wire.push(input.chatId);
          return {
            kind: "applied",
            receipt: {
              botKey: input.botKey,
              chatId: input.chatId,
              messageId: 1,
            },
          };
        },
      },
    },
  );
  expect(await worker.deliverNotice(original.id)).toBe("deferred_or_terminal");
  expect((await notices(f.userId))[0]).toMatchObject({
    state: "cancelled",
    attempts: 0,
  });
  await database.db.execute(
    sql`update channel_identities set external_chat_id='999999777' where user_id=${f.userId}::uuid and bot_key=${workScope.botKey}`,
  );
  expect(await worker.deliverNotice(current.id)).toBe("deferred_or_terminal");
  expect((await notices(f.userId)).at(-1)).toMatchObject({
    state: "cancelled",
    attempts: 0,
  });
  expect(wire).toEqual([]);
}, 60000);
it("rechecks identity after an observed real PostgreSQL wait between durable claim and wire dispatch", async () => {
  const f = await secondRichFixture();
  await f.approve();
  const notice = (await notices(f.userId))[0]!;
  const reached = latch(),
    allow = latch(),
    held = latch(),
    release = latch();
  let transactions = 0,
    blockerPid = 0,
    calls = 0;
  const wrapped = new Proxy(database.db, {
    get(target, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(target, property, receiver);
      return async (...args: Parameters<DrizzleDb["transaction"]>) => {
        if (++transactions === 2) {
          reached.resolve();
          await allow.promise;
        }
        return target.transaction(...args);
      };
    },
  }) as DrizzleDb;
  const worker = new PostgresResidentLifecycleCompletionRepository(wrapped, {
    ...policy,
    transport: {
      send: async (input) => {
        calls++;
        return {
          kind: "applied",
          receipt: { botKey: input.botKey, chatId: input.chatId, messageId: 1 },
        };
      },
    },
  });
  const outcome = worker.deliverNotice(notice.id);
  await reached.promise;
  expect((await notices(f.userId))[0]).toMatchObject({
    state: "unknown",
    attempts: 1,
  });
  const blocker = database.db.transaction(async (tx) => {
    await lockClientConsentSubject(tx, f.userId);
    blockerPid = (
      await tx.execute<{ pid: number }>(sql`select pg_backend_pid() pid`)
    ).rows[0]!.pid;
    await tx.execute(
      sql`update channel_identities set status='blocked' where user_id=${f.userId}::uuid and bot_key=${workScope.botKey}`,
    );
    held.resolve();
    await release.promise;
  });
  try {
    await held.promise;
    allow.resolve();
    const deadline = Date.now() + 750;
    let observed = false;
    do {
      observed = (
        await database.db.execute<{ blocked: boolean }>(
          sql`select exists(select 1 from pg_stat_activity where ${blockerPid}::integer=any(pg_blocking_pids(pid))) blocked`,
        )
      ).rows[0]!.blocked;
      if (!observed) await new Promise((r) => setTimeout(r, 2));
    } while (!observed && Date.now() < deadline);
    expect(observed).toBe(true);
  } finally {
    release.resolve();
    allow.resolve();
    await blocker;
  }
  expect(await outcome).toBe("cancelled");
  expect(calls).toBe(0);
  expect((await notices(f.userId))[0]).toMatchObject({
    state: "cancelled",
    attempts: 1,
  });
  expect(
    (
      await database.db.execute(
        sql`select state from resident_work_notice_attempts where notice_id=${notice.id}::uuid`,
      )
    ).rows,
  ).toEqual([{ state: "cancelled" }]);
}, 60000);
it("expires a real paid-lock link and issues a different main order without resetting first usable invoice deadline", async () => {
  const f = await nativeFixture({
    prepared: await normalFormOnboarding(),
    pendingMain: true,
  });
  const offers = new PostgresExpertPersonalOfferRepository(database.db, policy);
  const first = (
    await database.db.execute(
      sql`select first_main_invoice_order_id,first_main_invoice_at from resident_lifecycle_subjects where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!;
  const locked = (await offers.read(f.work))!;
  expect(locked.readiness).toBe("ready");
  const triggerState = async () =>
    (
      await database.db.execute(
        sql`select t.tgenabled,pg_get_triggerdef(t.oid,true) definition from pg_trigger t where t.tgrelid='expert_residency_orders'::regclass and t.tgname='expert_campaign_order_snapshot_immutable'`,
      )
    ).rows[0]!;
  const originalTrigger = await triggerState();
  expect(originalTrigger.tgenabled).toBe("O");
  const financialSnapshot = (
    await database.db.execute(
      sql`select to_jsonb(o)-'payment_deadline' snapshot from expert_residency_orders o where id=${f.orderId}::uuid`,
    )
  ).rows[0]!;
  // Simulated elapsed-time fixture in this disposable DB, not a naturally elapsed
  // provider window. Restore and verify the exact named guard before tested work.
  await database.db.execute(
    sql.raw(
      "alter table expert_residency_orders disable trigger expert_campaign_order_snapshot_immutable",
    ),
  );
  try {
    await database.db.execute(
      sql`update expert_residency_orders set payment_deadline=clock_timestamp()+interval '100 milliseconds' where id=${f.orderId}::uuid`,
    );
  } finally {
    await database.db.execute(
      sql.raw(
        "alter table expert_residency_orders enable trigger expert_campaign_order_snapshot_immutable",
      ),
    );
  }
  expect(await triggerState()).toEqual(originalTrigger);
  expect(
    (
      await database.db.execute(
        sql`select to_jsonb(o)-'payment_deadline' snapshot from expert_residency_orders o where id=${f.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual(financialSnapshot);
  expect(
    (
      await database.db.execute(
        sql`select o.payment_deadline>o.created_at and o.payment_deadline<=o.provider_deadline and o.payment_deadline<=q.expires_at and s.first_main_invoice_at<o.payment_deadline consistent from expert_residency_orders o join expert_campaign_quotes q on q.id=o.campaign_quote_id join resident_lifecycle_subjects s on s.first_main_invoice_order_id=o.id where o.id=${f.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ consistent: true });
  await database.db.execute(
    sql`select pg_sleep(greatest(0,extract(epoch from payment_deadline-clock_timestamp()))+0.02) from expert_residency_orders where id=${f.orderId}::uuid`,
  );
  expect(await offers.read(f.work)).toMatchObject({
    readiness: "pending_gates",
    payment_url: null,
    selected_locked_total: locked.selected_locked_total,
  });
  await database.db.transaction(async (tx) => {
    await lockClientConsentSubject(tx, f.userId);
    await tx.execute(
      sql`select id from expert_residency_orders where id=${f.orderId}::uuid for update`,
    );
    expect(
      await expireLockedExpertResidencyOrder(
        tx,
        { id: f.orderId, expertId: f.expertId },
        sql`clock_timestamp()`,
      ),
    ).toBe(true);
  });
  const revision = await f.revision(),
    quote = await f.financial.quoteMain({
      ...event(f.work),
      tariffVersionId: tariffId,
      termMonths: 1,
      revision,
    });
  await f.financial.acceptMain({
    ...event(f.work),
    quoteId: quote.id,
    revision,
  });
  const replacement = await f.financial.createMainInvoice({
    ...event(f.work),
    revision,
  });
  expect(replacement.orderId).not.toBe(f.orderId);
  const operations = new PostgresYooKassaOperationRepository(database.db),
    claim = await operations.claim({
      commandId: randomUUID(),
      orderId: replacement.orderId,
      kind: "create_payment",
      mode: "test",
      amountMinor: replacement.cashMinor,
      currency: "RUB",
      requestDigest: "sha256:" + hash(replacement.orderId),
    }),
    paymentId = "synthetic_" + randomUUID();
  await operations.bindProviderObject(claim.id, paymentId);
  expect(
    await f.financial.verifyMainCheckoutForOwner(
      { ...event(f.work), revision },
      replacement.orderId,
      paymentId,
      "https://yookassa.ru/checkout/replacement",
    ),
  ).toBe(true);
  await database.db.execute(
    sql`update expert_personal_offer_state set next_refresh_at='epoch' where user_id=${f.userId}::uuid`,
  );
  await offers.refreshDue(50);
  expect(await offers.read(f.work)).toMatchObject({
    readiness: "ready",
    payment_url: "https://yookassa.ru/checkout/replacement",
    selected_locked_total: locked.selected_locked_total,
  });
  expect(
    (
      await database.db.execute(
        sql`select first_main_invoice_order_id,first_main_invoice_at from resident_lifecycle_subjects where user_id=${f.userId}::uuid`,
      )
    ).rows[0],
  ).toEqual(first);
  await expect(
    database.db.execute(
      sql`update resident_lifecycle_subjects set first_main_invoice_order_id=${replacement.orderId}::uuid where user_id=${f.userId}::uuid`,
    ),
  ).rejects.toThrow();
  await f.http?.close();
}, 60000);
it("preserves the last approved version during edits, suppresses a changed promo gate and hides private terms after withdrawal", async () => {
  const f = await nativeFixture({
      prepared: await normalFormOnboarding(),
      pendingMain: true,
    }),
    offers = new PostgresExpertPersonalOfferRepository(database.db, policy);
  const before = (await offers.read(f.work))!;
  expect(before.readiness).toBe("ready");
  const orderCount = async () =>
    (
      await database.db.execute<{ n: number }>(
        sql`select count(*)::integer n from expert_card_main_orders where user_id=${f.userId}::uuid`,
      )
    ).rows[0]!.n;
  const count = await orderCount();
  await f.repo.richAction({
    ...event(f.work),
    expectedRevision: await f.revision(),
    action: "patch",
    value: { services: [{ ...f.service, title: "Уточнённая консультация" }] },
  });
  // An incomplete draft must preserve the last immutable approval. Only an
  // actually changed acquisition proof revokes this never-published checkout.
  expect(await offers.read(f.work)).toMatchObject({
    readiness: "ready",
    payment_url: before.payment_url,
    selected_locked_total: before.selected_locked_total,
  });
  await f.repo.submitPromoProof({
    ...event(f.work),
    expectedRevision: await f.revision(),
    proof: { kind: "link", reference: "https://example.com/updated-proof" },
  });
  expect(
    (
      await database.db.execute(
        sql`select expert_card_activation_gate_valid(m.user_id,m.review_id) valid from expert_card_main_orders m where m.order_id=${f.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ valid: false });
  expect(await offers.read(f.work)).toMatchObject({
    readiness: "pending_gates",
    payment_url: null,
    selected_locked_total: before.selected_locked_total,
  });
  expect(await orderCount()).toBe(count);
  const privacy = new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () => [],
      verifyEnvelope: () => true,
    },
  });
  await privacy.withdrawConsentAtomically({
    targetUserId: f.userId,
    purpose: "client_messaging",
    policyVersion: "client-messaging-v1",
    correlationId: randomUUID(),
  });
  expect(await offers.read(f.work)).toBeNull();
  expect(await orderCount()).toBe(count);
  await f.http?.close();
}, 60000);
