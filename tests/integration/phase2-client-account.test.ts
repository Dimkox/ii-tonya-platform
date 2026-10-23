import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach as vitestBeforeEach,
  describe,
  expect,
  it as vitestIt,
  vi,
} from "vitest";
import { createYooKassaClient } from "@ii-tonya/integrations";
import type {
  ClientBotAccountEvent,
  ClientBotAccountQuery,
} from "../../packages/contracts/src/client-bot-account.js";
import { loadEnv } from "../../packages/config/src/index.js";
import { PostgresClientBotAccountReadRepository } from "../../packages/db/src/repositories/client-bot-account-read-repository.js";
import { PostgresClientPaidOrderRepository } from "../../packages/db/src/repositories/client-paid-order-repository.js";
import { PostgresClientIngressReplayRepository } from "../../packages/db/src/repositories/client-ingress-replay-repository.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { PostgresWebhookInboxRepository } from "../../packages/db/src/repositories/webhook-inbox-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { createClientBotAccountComposition } from "../../apps/api/src/client-bot-account-composition.js";
import { telegramWebhookRoutes } from "../../apps/api/src/routes/telegram-webhook.js";
import { createAsyncCaseDrainFence } from "../support/async-case-drain.js";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = apiRequire("fastify") as (options: {
  logger: false;
}) => Parameters<typeof telegramWebhookRoutes>[0];
const drain = createAsyncCaseDrainFence({ drainTimeoutMs: 2000 });
const it = (name: string, body: () => Promise<void>) =>
  vitestIt(name, () => drain.run(body));
const beforeEach = (body: () => Promise<void>) =>
  vitestBeforeEach(() => {
    drain.assertReady();
    return drain.run(body);
  });
const bot = { botId: "919191", botKey: "phase2-assistant" };
const secret = "synthetic_phase2_webhook_secret_1234567890";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
let database: ExpertReferralTestDatabase;
let paid: PostgresClientPaidOrderRepository;
let sequence = 980000;
const settings = (providerMode: "live" | "test" = "live") => ({
  ...bot,
  providerMode,
  messagingConsentPolicyVersion: "client-messaging-v1",
});
const account = (mode: "live" | "test" = "live") =>
  new PostgresClientBotAccountReadRepository(database.db, settings(mode));
async function actor() {
  const userId = await database.createUser(),
    telegramUserId = String(++sequence);
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${userId}::uuid,'telegram',${telegramUserId},${telegramUserId},${bot.botKey},'active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  return { userId, telegramUserId, chatId: telegramUserId };
}
type Actor = Awaited<ReturnType<typeof actor>>;
function event(
  owner: Actor,
  query: ClientBotAccountQuery,
  updateId = ++sequence,
): ClientBotAccountEvent {
  return {
    ...bot,
    telegramUserId: owner.telegramUserId,
    chatId: owner.chatId,
    updateId,
    query,
  };
}
function update(
  owner: Pick<Actor, "telegramUserId" | "chatId">,
  text: string,
  updateId = ++sequence,
) {
  return {
    update_id: updateId,
    message: {
      from: { id: Number(owner.telegramUserId), is_bot: false },
      chat: { id: Number(owner.chatId), type: "private" },
      text,
    },
  };
}
async function purchase(
  owner: Actor,
  mode: "live" | "test" = "live",
  packageCode = "start",
  settle = true,
) {
  const order = await paid.createOrder({
    userId: owner.userId,
    packageCode,
    mode,
    idempotencyKey: randomUUID(),
  });
  const paymentId = `synthetic_${randomUUID()}`;
  await paid.bindPayment({ orderId: order.id, providerPaymentId: paymentId });
  const captured = new Date(
    String(
      (
        await database.db.execute(
          sql`select clock_timestamp()::timestamptz(3) as captured`,
        )
      ).rows[0]!.captured,
    ),
  );
  const client = createYooKassaClient(
    { mode, shopId: "test-shop", secretKey: "synthetic-fixture-only" },
    async (url, init) => {
      expect(String(init.method)).toBe("GET");
      expect(url).toBe(`https://api.yookassa.ru/v3/payments/${paymentId}`);
      return new Response(
        JSON.stringify({
          id: paymentId,
          status: "succeeded",
          paid: true,
          test: mode === "test",
          amount: {
            value: `${order.priceMinor / 100n}.${String(order.priceMinor % 100n).padStart(2, "0")}`,
            currency: "RUB",
          },
          metadata: { order_id: order.id },
          created_at: captured.toISOString(),
          captured_at: captured.toISOString(),
          refundable: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  const verified = await client.getPayment(paymentId);
  if (!verified.capturedAt) throw new Error("fixture_payment_capture_missing");
  const [major, fraction] = verified.amount.value.split(".");
  const facts = {
    orderId: order.id,
    metadataOrderId: verified.metadata.order_id!,
    providerPaymentId: verified.id,
    amountMinor: BigInt(major!) * 100n + BigInt(fraction!),
    currency: verified.amount.currency,
    mode: verified.test ? ("test" as const) : ("live" as const),
    status: verified.status,
    paid: verified.paid,
    capturedAt: new Date(verified.capturedAt),
  };
  if (settle) await paid.settleVerifiedPayment(facts);
  return { order, paymentId, facts };
}
async function http(mode: "live" | "test" = "live", enabled = true) {
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    TELEGRAM_BOT_TOKEN: `${bot.botId}:synthetic_phase2_assistant_token_1234567890`,
    CLIENT_TELEGRAM_BOT_KEY: bot.botKey,
    CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    CLIENT_ACCOUNT_QUERIES_ENABLED: String(enabled),
    TELEGRAM_WEBHOOK_SECRET: secret,
    CLIENT_ACCOUNT_QUERIES_PAYMENT_MODE: mode,
  });
  const capability = createClientBotAccountComposition(database.db, config);
  const llm = vi.fn(async () => ({ status: "unexpected", route: "llm" }));
  const navigation = vi.fn(async () => ({ status: "unavailable" as const }));
  const app = Fastify({ logger: false });
  await app.register(telegramWebhookRoutes, {
    secret,
    clientBotId: bot.botId,
    clientBotKey: bot.botKey,
    clientIngressEnabled: true,
    clientHybridRoutingEnabled: true,
    clientGateway: { handle: llm },
    clientNavigationEnabled: true,
    clientNavigationGateway: { handle: navigation },
    clientAccountQueriesEnabled: enabled,
    ...(capability ? { clientAccountQueries: capability } : {}),
    clientIngressReplay: new PostgresClientIngressReplayRepository(database.db),
    rateLimiter: { consume: () => true },
    inbox: new PostgresWebhookInboxRepository(database.db),
    callbacks: {
      isAuthorizedIdentity: async () => false,
      verifyCallback: async () => false,
      process: async () => {},
    },
  });
  return { app, llm, navigation };
}
function send(
  f: Awaited<ReturnType<typeof http>>,
  payload: ReturnType<typeof update>,
  header = secret,
  key = bot.botKey,
) {
  return f.app.inject({
    method: "POST",
    url: `/v1/webhooks/telegram/client/${key}`,
    headers: { "x-telegram-bot-api-secret-token": header },
    payload,
  });
}
async function fingerprint() {
  return (
    await database.db.execute(
      sql`select jsonb_build_object('orders',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from client_paid_orders o),'settlements',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from client_paid_settlements s),'coupons',(select coalesce(jsonb_agg(to_jsonb(g) order by id),'[]') from client_coupon_grants g),'packages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from message_packages p),'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from message_ledger_entries l),'reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from reservations r),'booking_receipts',(select coalesce(jsonb_agg(to_jsonb(b) order by booking_handle),'[]') from client_booking_receipts b),'outbox',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from integration_outbox o),'expert_ledger',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from expert_referral_ledger_entries e)) as state`,
    )
  ).rows[0]!.state;
}
async function receiptCount(updateId: number) {
  return Number(
    (
      await database.db.execute(
        sql`select count(*)::int n from webhook_inbox where provider='telegram' and external_event_id=${`client-navigation-v1:${bot.botId}:${updateId}`}`,
      )
    ).rows[0]!.n,
  );
}
function noFallback(f: Awaited<ReturnType<typeof http>>) {
  expect(f.llm).not.toHaveBeenCalled();
  expect(f.navigation).not.toHaveBeenCalled();
}
function privacy() {
  return new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        ["object_store", "selarti", "planerka", "make_projection"].map(
          (processor) => ({
            processor: processor as
              "object_store" | "selarti" | "planerka" | "make_projection",
            ciphertext: `ciphertext:${processor}`,
            keyReference: `fixture:${processor}`,
            algorithm: "test-envelope-v1",
            version: "1",
            subjectDeletionKeyHash: `sha256:${processor}`,
          }),
        ),
      verifyEnvelope: () => true,
    },
  });
}
async function ownedBookings(owner: Actor, foreign: Actor) {
  const expert = await database.createExpertIdentity();
  const serviceId = randomUUID();
  await database.db.execute(
    sql`insert into expert_services(id,expert_id,name,code,language,active,duration_minutes) values(${serviceId}::uuid,${expert.expertId}::uuid,'Synthetic consultation','career','ru',true,60)`,
  );
  const repository = new PostgresBookingRepository(database.db);
  const own: string[] = [];
  let foreignHandle = "";
  for (let index = 0; index < 22; index++) {
    const client = index === 21 ? foreign : owner,
      slotId = randomUUID();
    await database.db.execute(
      sql`insert into slots(id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity) values(${slotId}::uuid,${serviceId}::uuid,'local',${randomUUID()},clock_timestamp()+${index + 48}*interval '1 hour',clock_timestamp()+${index + 49}*interval '1 hour',clock_timestamp(),1)`,
    );
    const requestId = (
      await database.db.execute<{ id: string }>(
        sql`insert into client_catalog_requests(user_id,request_digest,state) values(${client.userId}::uuid,${sha(randomUUID())},'ready') returning id`,
      )
    ).rows[0]!.id;
    const choiceDigest =
      `sha256:${sha(`ch1.${randomBytes(32).toString("base64url")}`)}` as const;
    await database.db.execute(
      sql`insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at) values(${requestId}::uuid,${choiceDigest},${slotId}::uuid,clock_timestamp()+interval '10 minutes')`,
    );
    const bookingHandle =
      `bk1.${randomBytes(32).toString("base64url")}` as const;
    const result = await repository.reserveProtectedChoice({
      userId: client.userId,
      choiceDigest,
      idempotencyKey: sha(
        `client-booking-reserve-v1\0${client.userId}\0${choiceDigest}`,
      ),
      bookingHandle,
      correlationId: `phase2-booking-${index}`,
      minimumLeadMs: 86400000,
      slotFreshnessMs: 900000,
      confirmationBufferMs: 3600000,
    });
    expect(result.kind).toBe("reserved");
    if (index === 21) foreignHandle = bookingHandle;
    else own.push(bookingHandle);
  }
  return { own, foreignHandle };
}

describe("Phase2 deterministic private client account reads (PG17.5)", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0]
        ?.server_version_num,
    ).toBe("170005");
  }, 120000);
  afterAll(async () => {
    await drain.drain();
    await database?.stop();
  }, 120000);
  afterEach(async () => {
    await drain.drain();
  });
  beforeEach(async () => {
    await database.reset();
    await database.db.execute(sql`truncate consent_document_versions cascade`);
    paid = new PostgresClientPaidOrderRepository(database.db);
  });
  describe("canonical coupon face value", () => {
    let owner: Actor;
    let foreign: Actor;
    let web: Awaited<ReturnType<typeof http>>;
    let before: unknown;
    let expected: string;
    beforeEach(async () => {
      owner = await actor();
      foreign = await actor();
      for (let i = 0; i < 12; i++)
        await purchase(owner, "live", i === 11 ? "maximum" : "start");
      await purchase(foreign, "live", "maximum");
      await database.createLedgerPackage(owner.userId, randomUUID(), 123456);
      web = await http();
      before = await fingerprint();
      expected = (11n * 999800n + 2198000n).toString();
    });
    it("returns the uncapped exact coupon total beyond bounded detail without message-unit or foreign-money crossover", async () => {
      try {
        const projection = await account().read(
          event(owner, { kind: "coupons" }),
        );
        expect(projection).toMatchObject({
          kind: "coupons",
          coupons_balance: expected,
          hasMore: true,
        });
        if (projection.kind !== "coupons")
          throw new Error("missing_coupon_projection");
        expect(projection.details).toHaveLength(10);
        const response = await send(web, update(owner, "/coupons_balance"));
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          method: "sendMessage",
          protect_content: true,
          chat_id: Number(owner.chatId),
        });
        expect(response.json().text).toContain("131958,00 ₽");
        expect(response.json().text).not.toContain(owner.userId);
        expect(response.json().text).not.toContain("123456");
        noFallback(web);
        expect(await fingerprint()).toEqual(before);
      } finally {
        await web.app.close();
      }
    });
  });
  describe("reviewed server mode", () => {
    let owner: Actor;
    let testPurchase: Awaited<ReturnType<typeof purchase>>;
    let web: Awaited<ReturnType<typeof http>>;
    let before: unknown;
    beforeEach(async () => {
      owner = await actor();
      await purchase(owner);
      testPurchase = await purchase(owner, "test", "maximum", false);
      web = await http("test");
      before = await fingerprint();
    });
    it("keeps test orders and live coupon settlements separate and never accepts mode or balance from command text", async () => {
      try {
        expect(
          await account("test").read(event(owner, { kind: "coupons" })),
        ).toMatchObject({ kind: "coupons", coupons_balance: "0" });
        const live = await account("live").read(
          event(owner, { kind: "coupons" }),
        );
        expect(live).toMatchObject({ coupons_balance: "999800" });
        const orders = await account("test").read(
          event(owner, { kind: "orders" }),
        );
        expect(orders).toMatchObject({
          kind: "orders",
          orders: [{ packageCode: "maximum", state: "unsettled" }],
        });
        await expect(
          paid.settleVerifiedPayment(testPurchase.facts),
        ).rejects.toThrow("CLIENT_PAID_CONFLICT");
        const response = await send(web, update(owner, "/coupons_balance"));
        expect(response.statusCode).toBe(200);
        expect(response.json().text).toContain("0,00 ₽");
        expect(
          (await send(web, update(owner, "/coupons_balance live"))).statusCode,
        ).toBe(400);
        noFallback(web);
        expect(await fingerprint()).toEqual(before);
      } finally {
        await web.app.close();
      }
    });
  });
  describe("owned order pagination", () => {
    let owner: Actor;
    let foreign: Actor;
    let before: unknown;
    beforeEach(async () => {
      owner = await actor();
      foreign = await actor();
      for (let i = 0; i < 12; i++) await purchase(owner);
      await purchase(foreign, "live", "maximum");
      before = await fingerprint();
    });
    it("bounds own pages, hides raw provider identities and rejects foreign or malformed cursor anchors transactionally", async () => {
      const first = await account().read(event(owner, { kind: "orders" }));
      if (first.kind !== "orders" || !first.nextCursor)
        throw new Error("missing_order_page");
      expect(first.orders).toHaveLength(10);
      const second = await account().read(
        event(owner, { kind: "orders", after: first.nextCursor }),
      );
      expect(second).toMatchObject({ kind: "orders", nextCursor: null });
      if (second.kind !== "orders") throw new Error("missing_next_page");
      expect(second.orders).toHaveLength(2);
      expect(
        new Set([...first.orders, ...second.orders].map((row) => row.handle))
          .size,
      ).toBe(12);
      const other = await account().read(event(foreign, { kind: "orders" }));
      if (other.kind !== "orders") throw new Error("missing_foreign_page");
      const bad = event(owner, {
        kind: "orders",
        after: other.orders[0]!.handle,
      });
      await expect(account().read(bad)).rejects.toThrow(
        "client_account_cursor_invalid",
      );
      expect(await receiptCount(bad.updateId)).toBe(0);
      await expect(
        account().read(event(owner, { kind: "orders", after: "co1.invalid" })),
      ).rejects.toThrow();
      expect(JSON.stringify(first)).not.toContain(owner.userId);
      expect(JSON.stringify(first)).not.toContain("synthetic_");
      expect(await fingerprint()).toEqual(before);
    });
  });
  describe("canonical owned booking handles", () => {
    let owner: Actor;
    let foreign: Actor;
    let bookings: Awaited<ReturnType<typeof ownedBookings>>;
    let before: unknown;
    beforeEach(async () => {
      owner = await actor();
      foreign = await actor();
      bookings = await ownedBookings(owner, foreign);
      before = await fingerprint();
    });
    it("reuses real reservation receipts with bounded owner pages and denies foreign booking cursors", async () => {
      const page = await account().read(event(owner, { kind: "reservations" }));
      if (page.kind !== "reservations" || !page.nextCursor)
        throw new Error("missing_booking_page");
      expect(page.bookings).toHaveLength(20);
      const next = await account().read(
        event(owner, { kind: "reservations", after: page.nextCursor }),
      );
      if (next.kind !== "reservations")
        throw new Error("missing_next_bookings");
      expect(next.bookings).toHaveLength(1);
      expect(
        new Set(
          [...page.bookings, ...next.bookings].map((row) => row.bookingHandle),
        ),
      ).toEqual(new Set(bookings.own));
      expect(JSON.stringify(page)).not.toContain(bookings.foreignHandle);
      expect(JSON.stringify(page)).not.toContain(owner.userId);
      const bad = event(owner, {
        kind: "reservations",
        after: bookings.foreignHandle,
      });
      await expect(account().read(bad)).rejects.toThrow(
        "client_account_cursor_invalid",
      );
      expect(await receiptCount(bad.updateId)).toBe(0);
      expect(await fingerprint()).toEqual(before);
    });
  });
  describe("shared numeric update receipts", () => {
    let owner: Actor;
    let web: Awaited<ReturnType<typeof http>>;
    let before: unknown;
    beforeEach(async () => {
      owner = await actor();
      await purchase(owner);
      web = await http();
      before = await fingerprint();
    });
    it("acknowledges old navigation and repeated account events without reprocessing private data or debiting units", async () => {
      try {
        const old = update(owner, "/orders");
        await new PostgresClientIngressReplayRepository(database.db).record({
          botId: bot.botId,
          updateId: old.update_id,
        });
        expect((await send(web, old)).json()).toEqual({
          accepted: true,
          duplicate: true,
        });
        const current = update(owner, "/coupons_balance");
        expect((await send(web, current)).statusCode).toBe(200);
        expect(
          (
            await send(web, {
              ...current,
              message: { ...current.message, text: "/orders" },
            })
          ).json(),
        ).toEqual({ accepted: true, duplicate: true });
        expect(await receiptCount(current.update_id)).toBe(1);
        noFallback(web);
        expect(await fingerprint()).toEqual(before);
      } finally {
        await web.app.close();
      }
    });
  });
  describe("current ownership and original consent", () => {
    let revoked: Actor;
    let erased: Actor;
    let web: Awaited<ReturnType<typeof http>>;
    let before: unknown;
    beforeEach(async () => {
      revoked = await actor();
      erased = await actor();
      await purchase(revoked);
      await purchase(erased);
      await privacy().withdrawConsentAtomically({
        targetUserId: revoked.userId,
        purpose: "client_messaging",
        policyVersion: "client-messaging-v1",
        correlationId: randomUUID(),
      });
      await privacy().startErasureAtomically({
        targetUserId: erased.userId,
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        pseudonym: "hmac:synthetic-phase2-erasure",
      });
      web = await http();
      before = await fingerprint();
    });
    it("denies revoked, erased, unlinked and alternate bot scopes without account creation or private projections", async () => {
      try {
        for (const actorScope of [
          revoked,
          erased,
          { telegramUserId: "999999", chatId: "999999" },
        ]) {
          const payload = update(actorScope, "/orders");
          const response = await send(web, payload);
          expect(response.statusCode).toBe(200);
          expect(response.json()).toMatchObject({
            method: "sendMessage",
            protect_content: true,
            text: expect.stringContaining("недоступны"),
          });
          expect(JSON.stringify(response.json())).not.toContain("co1.");
          expect(await receiptCount(payload.update_id)).toBe(0);
        }
        await expect(
          account().read({
            ...event(revoked, { kind: "coupons" }),
            botId: "818181",
          }),
        ).rejects.toThrow("client_account_scope_invalid");
        noFallback(web);
        expect(await fingerprint()).toEqual(before);
      } finally {
        await web.app.close();
      }
    });
  });
  describe("fail-closed actual assistant ingress", () => {
    let owner: Actor;
    let enabled: Awaited<ReturnType<typeof http>>;
    let disabled: Awaited<ReturnType<typeof http>>;
    let before: unknown;
    beforeEach(async () => {
      owner = await actor();
      await purchase(owner);
      enabled = await http();
      disabled = await http("live", false);
      before = await fingerprint();
    });
    it("rejects private-context ambiguity and disabled recognized commands before public navigation or hybrid LLM routing", async () => {
      try {
        const payload = update(owner, "/orders");
        const invalid = [
          {
            ...payload,
            message: { ...payload.message, forward_origin: { type: "user" } },
          },
          {
            ...payload,
            message: {
              ...payload.message,
              business_connection_id: "synthetic-business",
            },
          },
          {
            ...payload,
            message: {
              ...payload.message,
              from: { ...payload.message.from, is_bot: true },
            },
          },
          {
            ...payload,
            message: {
              ...payload.message,
              chat: { id: Number(owner.chatId), type: "group" },
            },
          },
          {
            ...payload,
            message: {
              ...payload.message,
              chat: { id: Number(owner.chatId) + 1, type: "private" },
            },
          },
          {
            ...payload,
            message: { ...payload.message, text: "/orders@foreign_bot" },
          },
        ];
        for (const raw of invalid)
          expect((await send(enabled, raw)).statusCode).toBe(400);
        expect((await send(enabled, payload, "wrong-secret")).statusCode).toBe(
          401,
        );
        expect(
          (await send(enabled, payload, secret, "other-assistant")).json(),
        ).toMatchObject({ accepted: true, rejected: true });
        for (const text of [
          "/coupons_balance",
          "/orders",
          "/reservations",
          "/orders@foreign_bot",
        ])
          expect((await send(disabled, update(owner, text))).statusCode).toBe(
            503,
          );
        noFallback(enabled);
        noFallback(disabled);
        expect(await fingerprint()).toEqual(before);
      } finally {
        try {
          await enabled.app.close();
        } finally {
          await disabled.app.close();
        }
      }
    });
  });
  describe("projection atomicity and caller snapshots", () => {
    let owner: Actor;
    let foreign: Actor;
    let web: Awaited<ReturnType<typeof http>>;
    let before: unknown;
    let foreignCursor: string;
    beforeEach(async () => {
      owner = await actor();
      foreign = await actor();
      await purchase(owner);
      await purchase(foreign, "live", "maximum");
      const page = await account().read(event(foreign, { kind: "orders" }));
      if (page.kind !== "orders") throw new Error("missing_foreign_page");
      foreignCursor = page.orders[0]!.handle;
      web = await http();
      before = await fingerprint();
    });
    it("rolls back failed-read receipts for exact-event retry and snapshots mutable request/config before asynchronous reads", async () => {
      try {
        const payload = update(owner, "/orders");
        await database.db.transaction(async (tx) => {
          await tx.execute(
            sql`lock table client_paid_orders in access exclusive mode`,
          );
          expect((await send(web, payload)).statusCode).toBe(503);
        });
        expect(await receiptCount(payload.update_id)).toBe(0);
        const retried = await send(web, payload);
        expect(retried.statusCode).toBe(200);
        expect(retried.json().text).toContain("start");
        expect(await receiptCount(payload.update_id)).toBe(1);
        const config = settings();
        const repository = new PostgresClientBotAccountReadRepository(
          database.db,
          config,
        );
        const query: { kind: "orders"; after?: string } = { kind: "orders" };
        const input = event(owner, query);
        const pending = repository.read(input);
        const observed = pending.then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error: error as unknown }),
        );
        try {
          query.after = foreignCursor;
          input.telegramUserId = foreign.telegramUserId;
          input.chatId = foreign.chatId;
          config.providerMode = "test";
          const outcome = await observed;
          if (!outcome.ok) throw outcome.error;
          expect(outcome.value).toMatchObject({
            kind: "orders",
            orders: [{ packageCode: "start", state: "paid" }],
          });
        } finally {
          await observed;
        }
        noFallback(web);
        expect(await fingerprint()).toEqual(before);
      } finally {
        await web.app.close();
      }
    });
  });
});
