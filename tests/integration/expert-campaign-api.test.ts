import { createHmac, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "../../packages/config/src/env.js";
import { buildApp } from "../../apps/api/src/app.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

let database: ExpertReferralTestDatabase;
const botToken = `123456:${"x".repeat(35)}`;
const referralKeyring = {
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(11),
};
const config = (referrals = false) =>
  loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_SESSION_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: botToken,
    EXPERT_TELEGRAM_BOT_KEY: "expert-bot",
    EXPERT_WEB_ORIGIN: "https://expert.example",
    EXPERT_TELEGRAM_LOGIN_BOT_USERNAME: "expert_test_bot",
    EXPERT_RESIDENCY_BILLING_ENABLED: "true",
    ...(referrals
      ? {
          EXPERT_REFERRAL_ENABLED: "true",
          EXPERT_REFERRAL_HMAC_KEY_VERSION: "v1",
          EXPERT_REFERRAL_HMAC_KEY_REF: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
        }
      : {}),
  });
beforeAll(async () => {
  if (!process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL)
    throw new Error("retained_pg17_required");
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
}, 120000);
beforeEach(async () => {
  await database.reset();
});
afterAll(async () => {
  await database?.stop();
});
function proof() {
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
  return `mini:${params}`;
}
async function setup(referrals = false) {
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
  const deps = await createDefaultLifecycle(
    referrals
      ? { expertCodeSecretResolver: { resolve: () => referralKeyring } }
      : {},
  ).dependencies(config(referrals), database.db);
  expect(deps.expertApi).toBeDefined();
  const app = await buildApp(deps);
  const session = await app.inject({
    method: "POST",
    url: "/v1/expert/sessions",
    payload: { identityProof: proof() },
  });
  expect(session.statusCode).toBe(201);
  return {
    app,
    owner,
    tariffVersionId,
    headers: {
      authorization: `Bearer ${session.json<{ accessToken: string }>().accessToken}`,
    },
  };
}
async function counts() {
  return (
    await database.db
      .execute(sql`select (select count(*)::int from expert_campaign_quotes) quotes,
    (select count(*)::int from expert_campaign_anchors) anchors,
    (select count(*)::int from expert_residency_orders) orders,
    (select count(*)::int from expert_referral_ledger_entries) ledger`)
  ).rows[0];
}
it("ordinary tariff HTTP labels the base price explicitly and distinguishes the saved offer", async () => {
  await database.enableExpertReferralCommands();
  const s = await setup();
  try {
    const response = await s.app.inject({
      url: "/v1/expert/residency/tariffs",
      headers: s.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const tariffs = response.json<Record<string, unknown>[]>();
    expect(tariffs).toHaveLength(1);
    expect(tariffs[0]).toMatchObject({
      tariffVersionId: s.tariffVersionId,
      displayName: "Про",
      currency: "RUB",
      priceKind: "base",
      baseMonthlyMinor: "999000",
    });
    expect(tariffs[0]).not.toHaveProperty("priceMinor");
    expect(tariffs[0]).not.toHaveProperty("cashMinor");
    expect(await counts()).toEqual({
      quotes: 0,
      anchors: 0,
      orders: 0,
      ledger: 0,
    });
    const offer = await s.app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: s.headers,
      payload: {
        tariffVersionId: s.tariffVersionId,
        termMonths: 1,
        idempotencyKey: randomUUID(),
      },
    });
    expect(offer.statusCode).toBe(200);
    expect(offer.json()).toMatchObject({
      baseMonthlyMinor: "999000",
      priceMinor: "599400",
    });
  } finally {
    await s.app.close();
  }
});
it("filters twenty earlier active legacy 90-day tariffs before the campaign limit", async () => {
  await database.enableExpertReferralCommands();
  const legacyIds: string[] = [];
  for (let i = 0; i < 20; i++)
    legacyIds.push(
      await database.createResidencyTariff({
        tariffKey: `legacy-quarter-${i}`,
        displayName: `Legacy quarter ${i}`,
        priceMinor: 999000,
        durationSeconds: 7776000,
        commercialPolicyVersion: "legacy_residency_v1",
      }),
    );
  const s = await setup();
  try {
    // Verify the old unfiltered LIMIT would contain only the twenty legacy rows.
    const firstTwenty = (
      await database.db.execute<{ id: string }>(sql`
      select id from expert_residency_tariff_versions
      where active_from <= transaction_timestamp() and transaction_timestamp() < active_to
      order by active_from,id limit 20
    `)
    ).rows.map((row) => row.id);
    expect(firstTwenty).toHaveLength(20);
    expect(new Set(firstTwenty)).toEqual(new Set(legacyIds));
    const response = await s.app.inject({
      url: "/v1/expert/residency/tariffs",
      headers: s.headers,
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json<Record<string, unknown>[]>();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tariffVersionId: s.tariffVersionId,
      commercialPolicyVersion: "expert_residency_v2",
      durationSeconds: 2592000,
      priceKind: "base",
      baseMonthlyMinor: "999000",
    });
    expect(rows[0]).not.toHaveProperty("priceMinor");
    expect(
      rows.some((row) => legacyIds.includes(String(row.tariffVersionId))),
    ).toBe(false);
    expect(await counts()).toEqual({
      quotes: 0,
      anchors: 0,
      orders: 0,
      ledger: 0,
    });
  } finally {
    await s.app.close();
  }
});
it("campaign tariff discovery preserves durable feature and active-owner guards", async () => {
  const s = await setup();
  try {
    const disabled = await s.app.inject({
      url: "/v1/expert/residency/tariffs",
      headers: s.headers,
    });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toEqual({ error: "feature_disabled" });
    await database.enableExpertReferralCommands();
    await database.db.execute(
      sql`update experts set verified=false where id=${s.owner.expertId}::uuid`,
    );
    const denied = await s.app.inject({
      url: "/v1/expert/residency/tariffs",
      headers: s.headers,
    });
    expect(denied.statusCode).toBe(401);
    expect(await counts()).toEqual({
      quotes: 0,
      anchors: 0,
      orders: 0,
      ledger: 0,
    });
  } finally {
    await s.app.close();
  }
});
it("ordinary referral composition redeems a real HMAC code for the signed-session owner and exposes summary", async () => {
  await database.enableExpertReferralCommands();
  const inviter = await database.createExpertIdentity();
  const audit = await database.createAdminAudit({
    action: "expert_referral.batch_generate",
    objectId: inviter.expertId,
  });
  const issued = await new PostgresExpertReferralRepository(
    database.db,
    new ExpertCodeCrypto(referralKeyring),
  ).issueBatch({
    inviterExpertId: inviter.expertId,
    count: 1,
    issuedByAdminId: audit.adminId,
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  const code = issued.codes[0]!;
  const s = await setup(true);
  try {
    const payload = { code: code.plaintext, idempotencyKey: randomUUID() };
    const denied = await s.app.inject({
      method: "POST",
      url: "/v1/expert/referrals/redeem",
      payload,
    });
    expect(denied.statusCode).toBe(401);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_referrals`,
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    const redeemed = await s.app.inject({
      method: "POST",
      url: "/v1/expert/referrals/redeem",
      headers: s.headers,
      payload,
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.headers["cache-control"]).toBe("no-store");
    expect(redeemed.json()).toEqual({
      kind: "redeemed",
      referralId: expect.any(String),
    });
    expect(
      (
        await database.db.execute(sql`
      select id,code_id,inviter_expert_id,invitee_expert_id from expert_referrals
    `)
      ).rows,
    ).toEqual([
      {
        id: redeemed.json<{ referralId: string }>().referralId,
        code_id: code.id,
        inviter_expert_id: inviter.expertId,
        invitee_expert_id: s.owner.expertId,
      },
    ]);
    expect(
      (
        await database.db.execute(
          sql`select status from expert_referral_codes where id=${code.id}::uuid`,
        )
      ).rows,
    ).toEqual([{ status: "redeemed" }]);
    const summary = await s.app.inject({
      url: "/v1/expert/referrals/summary",
      headers: s.headers,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.headers["cache-control"]).toBe("no-store");
    expect(summary.json()).toEqual({
      availableMinor: "0",
      reservedMinor: "0",
      debtMinor: "0",
      nearestExpiry: null,
    });
    expect(await counts()).toEqual({
      quotes: 0,
      anchors: 0,
      orders: 0,
      ledger: 0,
    });
  } finally {
    await s.app.close();
  }
});
it("ordinary signed-session HTTP persists and replays saved quotes; unavailable checkout creates no order", async () => {
  const s = await setup();
  try {
    const payload = {
      tariffVersionId: s.tariffVersionId,
      termMonths: 1,
      idempotencyKey: randomUUID(),
    };
    const first = await s.app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: s.headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toMatchObject({
      id: expect.any(String),
      termMonths: 1,
      priceMinor: "599400",
      expiresAt: expect.any(String),
      calculationTimestamp: expect.any(String),
    });
    const replay = await s.app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: s.headers,
      payload,
    });
    expect(replay.json()).toEqual(first.json());
    const conflict = await s.app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: s.headers,
      payload: { ...payload, termMonths: 3 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "command_rejected" });
    const stored = (
      await database.db.execute(
        sql`select id,price_minor::text as price from expert_campaign_quotes`,
      )
    ).rows;
    expect(stored).toEqual([
      { id: first.json<{ id: string }>().id, price: "599400" },
    ]);
    expect(await counts()).toEqual({
      quotes: 1,
      anchors: 1,
      orders: 0,
      ledger: 0,
    });
    const unavailable = await s.app.inject({
      method: "POST",
      url: "/v1/expert/residency/checkouts",
      headers: s.headers,
      payload: {
        quoteId: first.json<{ id: string }>().id,
        idempotencyKey: randomUUID(),
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ error: "payment_unavailable" });
    expect(await counts()).toEqual({
      quotes: 1,
      anchors: 1,
      orders: 0,
      ledger: 0,
    });
  } finally {
    await s.app.close();
  }
});
it("rejects forged fields, legacy checkout, duplicate/client/absent bearer and oversized body before writes", async () => {
  const s = await setup();
  try {
    const payload = {
      tariffVersionId: s.tariffVersionId,
      termMonths: 1,
      idempotencyKey: randomUUID(),
    };
    for (const field of [
      "priceMinor",
      "cashMinor",
      "userId",
      "expertId",
      "calculationTimestamp",
      "unknown",
    ]) {
      const r = await s.app.inject({
        method: "POST",
        url: "/v1/expert/residency/quotes",
        headers: s.headers,
        payload: { ...payload, [field]: "forged" },
      });
      expect(r.statusCode).toBe(400);
    }
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/expert/residency/checkouts",
          headers: s.headers,
          payload: {
            tariffVersionId: s.tariffVersionId,
            idempotencyKey: randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(400);
    for (const headers of [
      {},
      { authorization: `Bearer cs1.${"a".repeat(43)}` },
      {
        authorization: `${s.headers.authorization}, ${s.headers.authorization}`,
      },
    ]) {
      expect([400, 401]).toContain(
        (
          await s.app.inject({
            method: "POST",
            url: "/v1/expert/residency/quotes",
            headers,
            payload,
          })
        ).statusCode,
      );
    }
    const address = await s.app.listen({ host: "127.0.0.1", port: 0 });
    const duplicateStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const body = JSON.stringify(payload);
        const request = httpRequest(
          `${address}/v1/expert/residency/quotes`,
          {
            method: "POST",
            headers: [
              "Authorization",
              s.headers.authorization,
              "Authorization",
              s.headers.authorization,
              "Content-Type",
              "application/json",
              "Content-Length",
              String(Buffer.byteLength(body)),
            ],
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          },
        );
        request.on("error", reject);
        request.end(body);
      },
    );
    expect(duplicateStatus).toBe(400);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/expert/residency/quotes",
          headers: s.headers,
          payload: { ...payload, junk: "x".repeat(9000) },
        })
      ).statusCode,
    ).toBe(413);
    expect(await counts()).toEqual({
      quotes: 0,
      anchors: 0,
      orders: 0,
      ledger: 0,
    });
  } finally {
    await s.app.close();
  }
});
it.each(["revoked", "inactive", "unverified", "owner"])(
  "denies %s authority without business writes",
  async (kind) => {
    const s = await setup();
    try {
      if (kind === "revoked")
        await s.app.inject({
          method: "DELETE",
          url: "/v1/expert/sessions/current",
          headers: s.headers,
        });
      if (kind === "inactive")
        await database.db.execute(
          sql`update experts set active=false where id=${s.owner.expertId}::uuid`,
        );
      if (kind === "unverified")
        await database.db.execute(
          sql`update experts set verified=false where id=${s.owner.expertId}::uuid`,
        );
      if (kind === "owner") {
        const id = randomUUID();
        await database.db.execute(
          sql`insert into users(id) values(${id}::uuid)`,
        );
        await database.db.execute(
          sql`update experts set user_id=${id}::uuid where id=${s.owner.expertId}::uuid`,
        );
      }
      for (const [url, payload] of [
        [
          "quotes",
          {
            tariffVersionId: s.tariffVersionId,
            termMonths: 1,
            idempotencyKey: randomUUID(),
          },
        ],
        ["checkouts", { quoteId: randomUUID(), idempotencyKey: randomUUID() }],
      ] as const) {
        expect(
          (
            await s.app.inject({
              method: "POST",
              url: `/v1/expert/residency/${url}`,
              headers: s.headers,
              payload,
            })
          ).statusCode,
        ).toBe(401);
      }
      expect(await counts()).toEqual({
        quotes: 0,
        anchors: 0,
        orders: 0,
        ledger: 0,
      });
    } finally {
      await s.app.close();
    }
  },
);
it("fails ordinary composition when billing has no session capability", async () => {
  const c = config();
  c.features.expertSession = false;
  await expect(
    createDefaultLifecycle().dependencies(c, database.db),
  ).rejects.toThrow("expert_session_capability_unavailable");
});
it("bounds HTTP command rate without creating financial state", async () => {
  const s = await setup();
  try {
    let status = 0;
    for (let i = 0; i < 61; i++)
      status = (
        await s.app.inject({
          method: "POST",
          url: "/v1/expert/residency/checkouts",
          headers: s.headers,
          payload: { quoteId: randomUUID(), idempotencyKey: randomUUID() },
        })
      ).statusCode;
    expect(status).toBe(429);
    expect(await counts()).toEqual({
      quotes: 0,
      anchors: 0,
      orders: 0,
      ledger: 0,
    });
  } finally {
    await s.app.close();
  }
});
