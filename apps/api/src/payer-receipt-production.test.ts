import { beforeAll, afterAll, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { buildApp } from "./app.js";
import { createDefaultLifecycle } from "./server.js";
import { createExpertCampaignComposition } from "./expert-campaign-composition.js";
import { createPayerReceiptComposition } from "./payer-receipt-composition.js";
import { loadEnv } from "../../../packages/config/src/env.js";
import { ExpertCodeCrypto } from "../../../packages/application/src/expert-code-crypto.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../../packages/db/src/testkit/expert-referral.js";
import * as application from "../../../packages/application/src/index.js";
import type { ExpertCampaignPorts } from "../../../packages/application/src/expert-campaign-service.js";

const userId = "11111111-1111-4111-8111-111111111111",
  expertId = "22222222-2222-4222-8222-222222222222",
  quoteId = "33333333-3333-4333-8333-333333333333",
  receiptContactId = "44444444-4444-4444-8444-444444444444";
const principal = { authenticated: true as const, userId, expertId };
const request = { quoteId, receiptContactId, idempotencyKey: "checkout-one" };
const api = application as unknown as {
  createPayerReceiptRequiredCampaignService(
    ports: Omit<ExpertCampaignPorts, "createCheckoutOrder"> & {
      createCheckoutOrderWithReceipt(
        input: typeof request & { userId: string; expertId: string },
      ): Promise<{
        id: string;
        cashMinor: string;
        currency: "RUB";
        status: "payment_pending";
      }>;
    },
  ): {
    checkout(p: typeof principal, r: unknown): Promise<unknown>;
    receiptRequired: true;
  };
};
it("required service rejects missing, extra and forged input before order or provider writes", async () => {
  expect(api.createPayerReceiptRequiredCampaignService).toBeTypeOf("function");
  let orders = 0,
    calls = 0;
  const service = api.createPayerReceiptRequiredCampaignService({
    environmentEnabled: true,
    ownerUserId: async () => userId,
    listActiveTariffs: async () => [],
    createQuote: async () => {
      throw Error("unused");
    },
    createCheckoutOrderWithReceipt: async (input) => {
      expect(input).toEqual({ ...request, userId, expertId });
      orders++;
      return {
        id: quoteId,
        cashMinor: "100",
        currency: "RUB",
        status: "payment_pending",
      };
    },
    checkoutProvider: {
      createCheckout: async () => {
        calls++;
        return {
          kind: "created",
          paymentId: "synthetic",
          checkoutUrl: "https://checkout.example/pay",
        };
      },
    },
  });
  expect(service.receiptRequired).toBe(true);
  for (const input of [
    { quoteId, idempotencyKey: "checkout-one" },
    { ...request, email: "private@example.test" },
    { ...request, receiptContactId: "foreign" },
  ])
    expect(await service.checkout(principal, input)).toEqual({
      kind: "invalid_request",
    });
  expect([orders, calls]).toEqual([0, 0]);
  expect(await service.checkout(principal, request)).toHaveProperty(
    "payment.kind",
    "created",
  );
  expect([orders, calls]).toEqual([1, 1]);
});
it("absent provider causes zero reservations even with a valid contact selection", async () => {
  expect(api.createPayerReceiptRequiredCampaignService).toBeTypeOf("function");
  let writes = 0;
  const service = api.createPayerReceiptRequiredCampaignService({
    environmentEnabled: true,
    ownerUserId: async () => userId,
    listActiveTariffs: async () => [],
    createQuote: async () => {
      throw Error("unused");
    },
    createCheckoutOrderWithReceipt: async () => {
      writes++;
      throw Error("unexpected");
    },
  });
  expect(await service.checkout(principal, request)).toEqual({
    kind: "payment_unavailable",
  });
  expect(writes).toBe(0);
});

let database: ExpertReferralTestDatabase;
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw Error("isolated_pg17_required");
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  await database.enableExpertReferralCommands();
}, 120000);
afterAll(async () => {
  await database?.stop();
});
it("ordinary composition requires receipt on both cookie and bearer routes, captures without provider, and rejects ambiguous raw JSON", async () => {
  const botToken = `123456:${"x".repeat(35)}`;
  const owner = await database.createExpertIdentity({
    externalId: "123456789",
  });
  await database.db.execute(
    sql`update channel_identities set bot_key='expert-bot',external_chat_id=external_id where user_id=${owner.userId}::uuid`,
  );
  const tariffVersionId = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "Про",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_SESSION_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: botToken,
    EXPERT_TELEGRAM_BOT_KEY: "expert-bot",
    EXPERT_WEB_ORIGIN: "https://expert.example",
    EXPERT_TELEGRAM_LOGIN_BOT_USERNAME: "expert_test_bot",
    EXPERT_RESIDENCY_BILLING_ENABLED: "true",
    PAYER_RECEIPT_CAPTURE_ENABLED: "true",
    PAYER_RECEIPT_ACTIVE_KEY_ID: "r1",
    PAYER_RECEIPT_KEYRING_REF: "env://PAYER_RECEIPT_KEYS_JSON",
    PAYER_RECEIPT_RETENTION_DAYS: "30",
  });
  const deps = await createDefaultLifecycle().dependencies(config, database.db);
  expect(deps.expertApi!.residency).toHaveProperty("receiptRequired", true);
  const receipt = createPayerReceiptComposition(database.db, config, {
    PAYER_RECEIPT_KEYS_JSON: JSON.stringify({
      r1: Buffer.alloc(32, 17).toString("base64url"),
    }),
  })!;
  let providerCalls = 0;
  const composition = (provider: boolean) =>
    createExpertCampaignComposition({
      db: database.db,
      botKey: "expert-bot",
      principals: deps.expertApi!.principals,
      codeCrypto: new ExpertCodeCrypto({
        currentVersion: "v1",
        activeVersions: ["v1"],
        key: () => new Uint8Array(32).fill(11),
      }),
      referralEnabled: false,
      billingEnabled: true,
      payerReceipt: receipt,
      ...(provider
        ? {
            checkoutProvider: {
              createCheckout: async () => {
                providerCalls++;
                return {
                  kind: "created" as const,
                  paymentId: "synthetic",
                  checkoutUrl: "https://checkout.example/pay",
                };
              },
            },
          }
        : {}),
    });
  const app = await buildApp({ ...deps, expertApi: composition(false) });
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 123456789, first_name: "Synthetic" }),
  });
  params.sort();
  params.set(
    "hash",
    createHmac(
      "sha256",
      createHmac("sha256", "WebAppData").update(botToken).digest(),
    )
      .update([...params].map(([k, v]) => `${k}=${v}`).join("\n"))
      .digest("hex"),
  );
  const session = await app.inject({
    method: "POST",
    url: "/v1/expert/sessions",
    payload: { identityProof: `mini:${params}` },
  });
  expect(session.statusCode).toBe(201);
  const token = session.json<{ accessToken: string }>().accessToken;
  const bearer = { authorization: `Bearer ${token}` };
  async function browserHeaders(target: typeof app) {
    const cookie = `__Host-expert-session=${token}`;
    const probe = await target.inject({
      url: "/v1/expert/browser/session",
      headers: { cookie },
    });
    expect(probe.json()).toHaveProperty("authenticated", true);
    const set = probe.headers["set-cookie"];
    const nonce = (Array.isArray(set) ? set : [set])
      .find((s) => s?.startsWith("__Host-expert-csrf="))!
      .split(";")[0];
    return {
      cookie: `${cookie}; ${nonce}`,
      origin: "https://expert.example",
      "x-csrf-token": probe.json<{ csrfToken: string }>().csrfToken,
    };
  }
  const cookieHeaders = await browserHeaders(app);
  const quoted = await app.inject({
    method: "POST",
    url: "/v1/expert/browser/residency/quotes",
    headers: cookieHeaders,
    payload: { tariffVersionId, termMonths: 1, idempotencyKey: randomUUID() },
  });
  expect(quoted.statusCode).toBe(200);
  const q = quoted.json<{ id: string }>().id;
  const capture = {
    quoteId: q,
    email: "payer@example.test",
    idempotencyKey: randomUUID(),
  };
  const captured = await app.inject({
    method: "POST",
    url: "/v1/expert/browser/residency/receipt-contacts",
    headers: cookieHeaders,
    payload: capture,
  });
  expect(captured.statusCode).toBe(200);
  expect(captured.headers["cache-control"]).toBe("no-store");
  expect(captured.body).not.toContain("payer@example.test");
  const contact = captured.json<{ receiptContactId: string }>()
    .receiptContactId;
  for (const payload of [
    { ...capture, userId: owner.userId },
    JSON.stringify(capture).replace(
      '"email":',
      '"email":"foreign@example.test","email":',
    ),
  ]) {
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/expert/browser/residency/receipt-contacts",
      headers: { ...cookieHeaders, "content-type": "application/json" },
      payload,
    });
    expect(rejected.statusCode).toBe(400);
  }
  const denied = await app.inject({
    method: "POST",
    url: "/v1/expert/browser/residency/receipt-contacts",
    headers: { ...cookieHeaders, "x-csrf-token": "0".repeat(64) },
    payload: capture,
  });
  expect(denied.statusCode).toBe(403);
  const command = {
    quoteId: q,
    receiptContactId: contact,
    idempotencyKey: randomUUID(),
  };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/expert/browser/residency/checkouts",
        headers: cookieHeaders,
        payload: command,
      })
    ).statusCode,
  ).toBe(503);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_residency_orders where campaign_quote_id=${q}::uuid`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  await app.close();
  const enabled = await buildApp({ ...deps, expertApi: composition(true) });
  try {
    const browser = await browserHeaders(enabled);
    for (const [path, headers] of [
      ["/v1/expert/browser/residency/checkouts", browser],
      ["/v1/expert/residency/checkouts", bearer],
    ] as const) {
      expect(
        (
          await enabled.inject({
            method: "POST",
            url: path,
            headers,
            payload: { quoteId: q, idempotencyKey: randomUUID() },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await enabled.inject({
            method: "POST",
            url: path,
            headers: { ...headers, "content-type": "application/json" },
            payload: JSON.stringify(command).replace(
              '"receiptContactId":',
              '"receiptContactId":"11111111-1111-4111-8111-111111111111","receiptContactId":',
            ),
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(providerCalls).toBe(0);
    const checkout = await enabled.inject({
      method: "POST",
      url: "/v1/expert/browser/residency/checkouts",
      headers: browser,
      payload: command,
    });
    expect(checkout.statusCode).toBe(200);
    expect(
      await receipt.source.receiptContactForOrder(
        checkout.json<{ id: string }>().id,
      ),
    ).toEqual({
      email: "payer@example.test",
      authorityReference: `payer-receipt:${contact}`,
    });
    const replay = await enabled.inject({
      method: "POST",
      url: "/v1/expert/residency/checkouts",
      headers: bearer,
      payload: command,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ id: string }>().id).toBe(
      checkout.json<{ id: string }>().id,
    );
  } finally {
    await enabled.close();
  }
});
