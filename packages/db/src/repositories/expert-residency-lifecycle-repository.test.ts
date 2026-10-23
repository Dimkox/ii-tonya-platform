import { describe, expect, it } from "vitest";
import {
  parseResidencyReturnDate,
  validateResidencyNoticeReceipt,
  lifecycleBatchLimit,
} from "./expert-residency-lifecycle-repository.js";
describe("residency calendar lifecycle boundaries", () => {
  it.each(["2028-02-29", "2026-12-31"])(
    "accepts exact valid calendar dates %s",
    (date) => expect(parseResidencyReturnDate(date)).toBe(date),
  );
  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
    "Infinity",
    "2026-01-01\n",
  ])("rejects invalid or ambiguous calendar date %s", (date) =>
    expect(() => parseResidencyReturnDate(date)).toThrow(
      "residency_invalid_return_date",
    ),
  );
  it.each([0, 51, NaN, 1.5, -1])("rejects unbounded worker batch %s", (n) =>
    expect(() => lifecycleBatchLimit(n)).toThrow("residency_invalid_batch"),
  );
  it("allows bounded batch without coercion", () =>
    expect(lifecycleBatchLimit(50)).toBe(50));
  const expected = {
    botId: "123",
    chatId: "456",
    contentVersion: "lifecycle.overdue.v1",
    payloadDigest: "sha256:" + "a".repeat(64),
  };
  it("accepts only complete exact single-part notice receipts", () =>
    expect(
      validateResidencyNoticeReceipt(
        { ...expected, messageIds: ["1234"] },
        expected,
      ),
    ).toEqual({ ...expected, messageIds: ["1234"] }));
  it.each([
    { messageIds: [] },
    { messageIds: ["1", "2"] },
    { messageIds: ["0"] },
    { messageIds: ["1"], chatId: "999" },
    { messageIds: ["1"], payloadDigest: "sha256:" + "b".repeat(64) },
    { messageIds: ["1"], contentVersion: "arbitrary-card-content" },
  ])("rejects wrong or incomplete delivery receipt", (change) =>
    expect(() =>
      validateResidencyNoticeReceipt(
        Object.assign({ ...expected, messageIds: ["1"] }, change),
        expected,
      ),
    ).toThrow("residency_notice_receipt_invalid"),
  );
});

import { PgDialect } from "drizzle-orm/pg-core";
import {
  finishRenewalBillOrder,
  lockRenewalBillForCheckout,
} from "./expert-residency-lifecycle-repository.js";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
const userId = "11111111-1111-4111-8111-111111111111";
const billId = "22222222-2222-4222-8222-222222222222";
const expertId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";
const acceptanceId = "55555555-5555-4555-8555-555555555555";
const orderId = "66666666-6666-4666-8666-666666666666";
const otherOrder = "77777777-7777-4777-8777-777777777777";
function checkoutTx(prior: unknown = null) {
  const dialect = new PgDialect();
  return {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes("from expert_residency_renewal_bills"))
        return {
          rows: [
            { billId, userId, expertId, quoteId, acceptanceId, orderId: null },
          ],
        };
      if (text.includes("from expert_residency_renewal_attempts"))
        return { rows: prior ? [prior] : [] };
      if (text.includes("update expert_residency_renewal_bills"))
        return { rows: [{ id: billId }] };
      return { rows: [] };
    },
  } as unknown as ExpertCardTransaction;
}
describe("renewal checkout exact financial binding", () => {
  it("recovers the exact existing order and attempt", async () => {
    const tx = checkoutTx({
      sequence: 1,
      acceptanceId,
      orderId,
      expired: false,
    });
    expect(
      await lockRenewalBillForCheckout(tx, { userId, billId }),
    ).toMatchObject({ orderId, attemptSequence: 1, quoteId, acceptanceId });
  });
  it("allows a fresh accepted attempt only after canonical expiry", async () => {
    const tx = checkoutTx({
      sequence: 1,
      acceptanceId: "88888888-8888-4888-8888-888888888888",
      orderId,
      expired: true,
    });
    expect(
      await lockRenewalBillForCheckout(tx, { userId, billId }),
    ).toMatchObject({ orderId: null, attemptSequence: 2 });
  });
  it.each([false, null, undefined])(
    "denies a replacement without explicit DB expiry %s",
    async (expired) => {
      const tx = checkoutTx({
        sequence: 1,
        acceptanceId: "88888888-8888-4888-8888-888888888888",
        orderId,
        expired,
      });
      await expect(
        lockRenewalBillForCheckout(tx, { userId, billId }),
      ).rejects.toThrow("residency_bill_order_conflict");
    },
  );
  it("does not permit a captured checkout context to bind two orders", async () => {
    const tx = checkoutTx();
    const context = await lockRenewalBillForCheckout(tx, { userId, billId });
    await finishRenewalBillOrder(tx, context, orderId);
    await expect(
      finishRenewalBillOrder(tx, context, otherOrder),
    ).rejects.toThrow("residency_bill_order_conflict");
  });
  it("rejects a copied context or a different transaction", async () => {
    const tx = checkoutTx();
    const context = await lockRenewalBillForCheckout(tx, { userId, billId });
    await expect(
      finishRenewalBillOrder(tx, { ...context }, orderId),
    ).rejects.toThrow("residency_bill_order_conflict");
    await expect(
      finishRenewalBillOrder(checkoutTx(), context, orderId),
    ).rejects.toThrow("residency_bill_order_conflict");
  });
});

describe("renewal replay preserves immutable attempts", () => {
  it("does not invoke INSERT source triggers for an already-bound order", async () => {
    const dialect = new PgDialect();
    const base = checkoutTx({
      sequence: 1,
      acceptanceId,
      orderId,
      expired: false,
    });
    const tx = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        if (
          dialect
            .sqlToQuery(query)
            .sql.startsWith("insert into expert_residency_renewal_attempts")
        )
          throw new Error("existing_attempt_must_not_reinsert");
        return base.execute(query);
      },
    } as unknown as ExpertCardTransaction;
    const context = await lockRenewalBillForCheckout(tx, { userId, billId });
    await expect(
      finishRenewalBillOrder(tx, context, orderId),
    ).resolves.toBeUndefined();
  });
});

import { beginCardRequest } from "./expert-card-repository.js";
const residentEvent = {
  botId: "123",
  botKey: "work-fixture",
  telegramUserId: "456",
  chatId: "456",
  requestKey: "123:1",
  requestDigest: "a".repeat(64),
};
function residentTx(options: { consent?: boolean; resident?: boolean } = {}) {
  const dialect = new PgDialect();
  return {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes("from channel_identities ci"))
        return { rows: [{ userId }] };
      if (text.includes("from consent_states s"))
        return {
          rows:
            options.consent === false
              ? []
              : [
                  {
                    policyVersion: "messaging-v1",
                    decisionId: quoteId,
                    revision: "1",
                  },
                ],
        };
      if (text.includes("from expert_residency_orders o join experts"))
        return { rows: options.resident === false ? [] : [{ id: orderId }] };
      return { rows: [] };
    },
  } as unknown as ExpertCardTransaction;
}
describe("lifecycle receipt authority for existing canonical residents", () => {
  it("permits a private consented historical resident without fabricating an onboarding application", async () => {
    const result = await beginCardRequest(
      residentTx(),
      residentEvent,
      "residency_pause",
      { returnDate: "2026-11-01" },
    );
    expect(result).toEqual({ userId, replay: false });
  });
  it("does not extend card entry authority to a legacy resident without paid interview", async () => {
    await expect(
      beginCardRequest(residentTx(), residentEvent, "entry", {
        kind: "text",
        text: "private",
      }),
    ).rejects.toThrow("card_forbidden");
  });
  it.each([{ consent: false }, { resident: false }])(
    "denies lifecycle mutation without original consent or actual resident history",
    async (options) => {
      await expect(
        beginCardRequest(
          residentTx(options),
          residentEvent,
          "residency_resume",
        ),
      ).rejects.toThrow("card_forbidden");
    },
  );
});

describe("renewal transaction input capture", () => {
  it("captures bill ownership before its first asynchronous lock", async () => {
    const dialect = new PgDialect();
    let release!: () => void;
    let captured: unknown[] = [];
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = checkoutTx();
    let first = true;
    const tx = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const compiled = dialect.sqlToQuery(query);
        if (first) {
          first = false;
          await wait;
        }
        if (compiled.sql.includes("from expert_residency_renewal_bills"))
          captured = compiled.params;
        return base.execute(query);
      },
    } as unknown as ExpertCardTransaction;
    const input = { userId, billId };
    const pending = lockRenewalBillForCheckout(tx, input);
    input.userId = otherOrder;
    input.billId = otherOrder;
    release();
    await pending;
    expect(captured).toEqual([billId, userId]);
  });
});

import { PostgresExpertResidencyLifecycleRepository } from "./expert-residency-lifecycle-repository.js";
import type { DrizzleDb } from "../client.js";
describe("notice authority after a template lock wait", () => {
  it("rechecks original consent after the final content lock before any send", async () => {
    const dialect = new PgDialect();
    let revoked = false;
    let sends = 0;
    const tx = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const text = dialect.sqlToQuery(query).sql;
        if (
          text.startsWith(
            'select user_id as "userId" from expert_residency_lifecycle_notices',
          )
        )
          return { rows: [{ userId }] };
        if (text.includes("from channel_identities ci"))
          return {
            rows: text.includes('as "chatId"')
              ? [{ chatId: "456" }]
              : [{ userId }],
          };
        if (text.includes("from consent_states s"))
          return {
            rows: revoked
              ? []
              : [
                  {
                    policyVersion: "messaging-v1",
                    decisionId: quoteId,
                    revision: "1",
                  },
                ],
          };
        if (text.startsWith("select status,attempt_id"))
          return {
            rows: [{ status: "pending", attemptId: null, stage: "seven_days" }],
          };
        if (
          text.includes(" as current from expert_residency_lifecycle_notices")
        )
          return { rows: [{ current: true }] };
        if (text.startsWith("select id,content_version"))
          return {
            rows: [
              {
                id: quoteId,
                contentVersion: "lifecycle.seven_days.v1",
                text: "Approved synthetic notice",
              },
            ],
          };
        if (
          text.startsWith("select id from expert_residency_lifecycle_notices")
        )
          return { rows: [{ id: billId }] };
        if (text.startsWith("select text_body as text")) {
          revoked = true;
          return { rows: [{ text: "Approved synthetic notice" }] };
        }
        return { rows: [] };
      },
    };
    const db = {
      transaction: async (work: (value: unknown) => Promise<unknown>) =>
        work(tx),
    } as unknown as DrizzleDb;
    const repo = new PostgresExpertResidencyLifecycleRepository(db, {
      workBotId: "123",
      workBotKey: "work-fixture",
      messagingConsentPolicyVersion: "messaging-v1",
      noticeTransport: {
        send: async (input) => {
          sends++;
          return {
            messageIds: ["1"],
            botId: input.botId,
            chatId: input.chatId,
            contentVersion: input.contentVersion,
            payloadDigest: input.payloadDigest,
          };
        },
      },
    });
    await expect(repo.deliverNotice(billId)).resolves.toEqual({
      kind: "unknown_outcome",
    });
    expect(sends).toBe(0);
  });
});

describe("scheduled work uses current original owner authority", () => {
  it("does not create a reminder or restore access for a resident with withdrawn messaging consent", async () => {
    const dialect = new PgDialect();
    let notices = 0;
    let accessRestores = 0;
    const tx = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const text = dialect.sqlToQuery(query).sql;
        if (text.startsWith('select e.user_id as "userId",e.id as "expertId"'))
          return { rows: [{ userId, expertId }] };
        if (text.startsWith("select active from users"))
          return { rows: [{ active: true }] };
        if (text.startsWith("select status,paused_until"))
          return { rows: [{ status: "payment_required", due: false }] };
        if (
          text.includes("select exists(select 1 from expert_card_main_orders")
        )
          return { rows: [{ present: false }] };
        if (text.startsWith('select o.id as "sourceOrderId"'))
          return {
            rows: [
              {
                sourceOrderId: orderId,
                cycleEnd: "2026-10-23 18:00:00+00",
                tariffVersionId: quoteId,
                termMonths: 1,
                billDue: true,
                stage: "overdue",
              },
            ],
          };
        if (text.startsWith("insert into expert_residency_lifecycle_notices")) {
          notices++;
          return { rows: [{ id: billId }] };
        }
        if (text.includes("update experts set active=true")) accessRestores++;
        return { rows: [] };
      },
    };
    const db = {
      transaction: async (work: (value: unknown) => Promise<unknown>) =>
        work(tx),
    } as unknown as DrizzleDb;
    const repo = new PostgresExpertResidencyLifecycleRepository(db, {
      workBotId: "123",
      workBotKey: "work-fixture",
      messagingConsentPolicyVersion: "messaging-v1",
    });
    const result = await repo.processLifecycleBatch(1);
    expect(result.noticesCreated).toBe(0);
    expect(notices).toBe(0);
    expect(accessRestores).toBe(0);
  });
});

describe("bounded lifecycle scan fairness", () => {
  it("advances past two future-paused residents to suspend an overdue third resident on the next bounded cycle", async () => {
    const dialect = new PgDialect();
    const residents = [
      {
        userId,
        expertId: quoteId,
        status: "paused",
        updated: 1,
        active: false,
      },
      {
        userId: billId,
        expertId: acceptanceId,
        status: "paused",
        updated: 2,
        active: false,
      },
      {
        userId: expertId,
        expertId: orderId,
        status: "active",
        updated: 3,
        active: true,
      },
    ];
    let clock = 10;
    const scans: string[][] = [];
    const tx = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        if (
          text.startsWith('select e.user_id as "userId",e.id as "expertId"')
        ) {
          const selected = [...residents]
            .sort((a, b) => a.updated - b.updated)
            .slice(0, Number(params[0]));
          scans.push(selected.map((row) => row.userId));
          return {
            rows: selected.map((row) => ({
              userId: row.userId,
              expertId: row.expertId,
            })),
          };
        }
        if (text.startsWith("select active from users"))
          return { rows: [{ active: true }] };
        if (text.startsWith("select status,paused_until")) {
          const resident = residents.find((row) => row.userId === params[0])!;
          return { rows: [{ status: resident.status, due: false }] };
        }
        if (text.startsWith("update expert_residency_lifecycle set")) {
          const resident = residents.find(
            (row) => row.userId === params.at(-1),
          )!;
          resident.updated = clock++;
          if (text.includes("status='payment_required'"))
            resident.status = "payment_required";
          else if (text.includes("status=$"))
            resident.status = String(params[0]);
        }
        if (text.startsWith("update experts set active=false")) {
          const resident = residents.find((row) => row.expertId === params[0])!;
          resident.active = false;
        }
        if (
          text.includes("select exists(select 1 from expert_card_main_orders")
        )
          return { rows: [{ present: false }] };
        return { rows: [] };
      },
    };
    const db = {
      transaction: async (work: (value: unknown) => Promise<unknown>) =>
        work(tx),
    } as unknown as DrizzleDb;
    const repo = new PostgresExpertResidencyLifecycleRepository(db, {
      workBotId: "123",
      workBotKey: "work-fixture",
      messagingConsentPolicyVersion: "messaging-v1",
    });
    expect((await repo.processLifecycleBatch(2)).examined).toBe(2);
    const second = await repo.processLifecycleBatch(2);
    expect(scans).toEqual([
      [userId, billId],
      [expertId, userId],
    ]);
    expect(second.suspended).toBe(1);
    expect(residents[2]).toMatchObject({
      status: "payment_required",
      active: false,
    });
  });
});
