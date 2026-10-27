import { seedClientConsent } from "../../../../packages/db/src/testkit/client-consent.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HybridMessageGateway } from "../../../../packages/application/src/hybrid-message-gateway.js";
import {
  PostgresAdminApprovalRepository,
  PostgresHybridMessageRepository,
  selartiBudgetPolicyApprovalPayload,
} from "../../../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../../packages/db/src/testkit/postgres.js";
import { telegramWebhookRoutes } from "./telegram-webhook.js";

describe("B1 dedicated Telegram HTTP to PostgreSQL path", () => {
  let database: TestDatabase | undefined;
  let app: ReturnType<typeof Fastify> | undefined;
  const secret = "Dedicated_B1_Webhook_Secret_123456";
  const botKey = "client-bot-a";

  const bounded = async <T>(
    operation: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label}_timeout`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };

  const closeFixture = async (): Promise<void> => {
    const appToClose = app;
    const databaseToStop = database;
    app = undefined;
    database = undefined;
    try {
      if (appToClose !== undefined)
        await bounded(appToClose.close(), 10_000, "app_close");
    } finally {
      if (databaseToStop !== undefined)
        await bounded(databaseToStop.stop(), 30_000, "database_stop");
    }
  };

  beforeAll(async () => {
    try {
      database = await startTestPostgres();
      await database.migrate();
      const fixtureClock = await database.db.execute<{
        fixtureNow: Date | string;
      }>(sql`
        select clock_timestamp() as "fixtureNow"
      `);
      const rawFixtureNow = fixtureClock.rows[0]?.fixtureNow;
      if (rawFixtureNow === undefined)
        throw new Error("b1_fixture_clock_missing");
      const fixtureNow = new Date(rawFixtureNow);
      if (Number.isNaN(fixtureNow.getTime()))
        throw new Error("b1_fixture_clock_invalid");
      const fixtureExpiry = new Date(fixtureNow.getTime() + 60 * 60 * 1000);
      const paymentDeadline = new Date(fixtureNow.getTime() + 60 * 60 * 1000);
      const providerDeadline = new Date(
        fixtureNow.getTime() + 2 * 60 * 60 * 1000,
      );
      const settledAt = new Date("2026-08-28T00:00:00Z");
      const residencyEnd = new Date("2026-09-27T00:00:00Z");
      const fixtureDatabase = database;
      const seed = async (
        externalId: string,
        status: "active" | "blocked",
        decision: "granted" | "denied",
      ) => {
        const userId = await fixtureDatabase.createUser();
        await fixtureDatabase.db.execute(sql`
        insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status)
        values(${userId}::uuid,'telegram',${externalId},${botKey},${externalId},${status})
      `);
        if (decision === "granted") {
          await seedClientConsent(
            fixtureDatabase.db,
            userId,
            "client_messaging",
          );
          await seedClientConsent(
            fixtureDatabase.db,
            userId,
            "selarti_ai_processing",
          );
        }
      };
      await seed("701", "active", "granted");
      await seed("702", "blocked", "granted");
      await seed("703", "active", "denied");
      await seed("704", "active", "granted");
      const expertUserId = await database.createUser();
      const requesterId = await database.createUser();
      const approverId = await database.createUser();
      const expertId = randomUUID();
      const tariffId = randomUUID();
      const policyId = randomUUID();
      const requesterSession = `b1-budget-requester:${randomUUID()}`;
      const approverSession = `b1-budget-approver:${randomUUID()}`;
      await database.db.execute(
        sql`insert into experts(id,user_id,active,verified) values(${expertId}::uuid,${expertUserId}::uuid,true,true)`,
      );
      await database.db.execute(sql`
      insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at)
      values
        (${requesterSession},${requesterId}::uuid,${fixtureNow},${fixtureExpiry}),
        (${approverSession},${approverId}::uuid,${fixtureNow},${fixtureExpiry})
    `);
      await database.db.execute(sql`
      insert into admin_role_assignments(admin_id,role)
      values
        (${requesterId}::uuid,'security_admin'),
        (${approverId}::uuid,'security_admin'),
        (${requesterId}::uuid,'entitlement_admin'),
        (${approverId}::uuid,'entitlement_admin')
    `);
      const approvals = new PostgresAdminApprovalRepository(database.db);
      const pendingTariff = await approvals.requestApproval({
        sessionIdHash: requesterSession,
        action: "expert_residency.tariff_create",
        objectType: "expert_residency_tariff_version",
        objectId: tariffId,
        payload: "b1-http-budget:590000:RUB:2592000",
        nonce: "b1-http-budget-tariff-v1",
      });
      if (!pendingTariff)
        throw new Error("b1_http_tariff_approval_request_failed");
      expect(
        await approvals.approveApproval({
          approvalId: pendingTariff.approvalId,
          sessionIdHash: approverSession,
        }),
      ).toBe(true);
      await database.db.execute(sql`
      insert into expert_residency_tariff_versions(
        id,tariff_key,display_name,price_minor,currency,duration_seconds,
        active_from,active_to,approval_id,admin_session_id_hash
      ) values(
        ${tariffId}::uuid,'b1-http-budget','B1 HTTP budget',590000,'RUB',2592000,
        '2026-08-01','2026-09-30',${pendingTariff.approvalId}::uuid,${requesterSession}
      )
    `);
      await database.db.execute(sql`
      insert into expert_residency_orders(
        expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,
        duration_seconds,credit_minor,cash_minor,payment_deadline,provider_deadline,
        idempotency_key,status,settled_at,residency_starts_at,residency_ends_at
      ) values(
        ${expertId}::uuid,${tariffId}::uuid,'B1 HTTP budget',590000,'RUB',2592000,
        0,590000,${paymentDeadline},${providerDeadline},
        'b1-http-settled-cash','settled',${settledAt},
        ${settledAt},${residencyEnd}
      )
    `);
      await database.db.execute(
        sql`insert into admin_object_assignments(admin_id,object_type,object_id) values(${requesterId}::uuid,'selarti_budget_policy',${policyId}::uuid)`,
      );
      const policyPayload = selartiBudgetPolicyApprovalPayload({
        version: 1,
        status: "approved",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: null,
        globalCapRubMinor: 1704n,
        globalWarningRubMinor: 568n,
        globalSoftRubMinor: 1704n,
        perUserWarningRubMinor: 568n,
        perUserSoftRubMinor: 1200n,
        perUserHardRubMinor: 1704n,
        officialUsdRubQuoteMicros: 85_954_100n,
        selartiUpliftBps: 1000,
        usdMicrosPerRequest: 0n,
        usdMicrosPerUnit: 30_000n,
        worstCaseBillableUnits: 2n,
        rateVersion: "cbr-b1-http",
        modelVersion: "selarti-b1-http",
        stressInflationBps: 6000,
      });
      const pendingPolicy = await approvals.requestApproval({
        sessionIdHash: requesterSession,
        action: "selarti_budget.policy_approve",
        objectType: "selarti_budget_policy",
        objectId: policyId,
        payload: policyPayload,
        nonce: "b1-http-budget-policy-v1",
      });
      if (!pendingPolicy)
        throw new Error("b1_http_budget_approval_request_failed");
      expect(
        await approvals.approveApproval({
          approvalId: pendingPolicy.approvalId,
          sessionIdHash: approverSession,
        }),
      ).toBe(true);
      await database.db.execute(sql`
      insert into selarti_budget_policies(
        id,version,status,effective_from,global_cap_rub_minor,
        global_warning_rub_minor,global_soft_rub_minor,per_user_warning_rub_minor,
        per_user_soft_rub_minor,per_user_hard_rub_minor,
        official_usd_rub_quote_micros,usd_micros_per_request,usd_micros_per_unit,
        worst_case_billable_units,rate_version,model_version,approval_id
      ) values(
        ${policyId}::uuid,1,'approved','2026-08-01',1704,568,1704,568,1200,1704,
        85954100,0,30000,2,'cbr-b1-http','selarti-b1-http',
        ${pendingPolicy.approvalId}::uuid
      )
    `);
      const repository = new PostgresHybridMessageRepository(database.db);
      const gateway = new HybridMessageGateway({
        enabled: true,
        botKey,
        routingEnabled: true,
        costAdmissionEnabled: true,
        messagingConsentPolicyVersion: "client-messaging-v1",
        selartiConsentPolicyVersion: "selarti-ai-v1",
        hasMessagingConsent: async () => true,
        clock: () => new Date("2026-08-29T00:00:00.000Z"),
        persist: (input) => repository.persist(input),
      });
      app = Fastify({ logger: false });
      await app.register(telegramWebhookRoutes, {
        secret,
        callbacks: {
          isAuthorizedIdentity: async () => false,
          verifyCallback: async () => false,
          process: async () => undefined,
        },
        inbox: {
          claim: async () => ({ kind: "claimed", claimId: "unused" }),
          complete: async () => undefined,
          fail: async () => undefined,
        },
        rateLimiter: { consume: () => true },
        clientIngressEnabled: true,
        clientHybridRoutingEnabled: true,
        clientBotKey: botKey,
        clientGateway: gateway,
      });
    } catch (error) {
      await closeFixture();
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    await closeFixture();
  }, 45_000);

  const request = (updateId: number, userId: number) => {
    if (app === undefined) throw new Error("b1_fixture_app_unavailable");
    return app.inject({
      method: "POST",
      url: `/v1/webhooks/telegram/client/${botKey}`,
      headers: { "x-telegram-bot-api-secret-token": secret },
      payload: {
        update_id: updateId,
        message: {
          from: { id: userId },
          chat: { id: userId, type: "private" },
          text: "Подбери специалиста по моему сложному запросу",
        },
      },
    });
  };

  it("creates exactly one selarti.request.v1 for an authenticated consented client", async () => {
    if (database === undefined)
      throw new Error("b1_fixture_database_unavailable");
    const response = await request(1_001, 701);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      route: "complex_dialogue",
    });
    const effects = await database.db.execute<{
      approvals: number;
      lifecycleOrdered: boolean;
      inbound: number;
      outbox: number;
    }>(sql`
      select
        (select count(*)::int from admin_approvals where nonce in ('b1-http-budget-tariff-v1','b1-http-budget-policy-v1')) approvals,
        (select bool_and(
          requester_mfa_verified_at <= created_at
          and approved_at >= created_at
          and approver_mfa_verified_at <= approved_at
          and expires_at > approved_at
        ) from admin_approvals where nonce in ('b1-http-budget-tariff-v1','b1-http-budget-policy-v1')) "lifecycleOrdered",
        (select count(*)::int from dialogue_inbound where provider='telegram' and bot_key=${botKey} and provider_update_id=1001) inbound,
        (select count(*)::int from integration_outbox where topic='selarti.request.v1' and correlation_id=${`telegram:${botKey}:1001`}) outbox
    `);
    expect(effects.rows[0]).toEqual({
      approvals: 2,
      lifecycleOrdered: true,
      inbound: 1,
      outbox: 1,
    });
  });

  it.each([
    [1_002, 799, "unknown"],
    [1_003, 702, "blocked"],
    [1_004, 703, "consent denied"],
  ])(
    "terminally rejects %s/%s %s without effects",
    async (updateId, userId) => {
      if (database === undefined)
        throw new Error("b1_fixture_database_unavailable");
      const response = await request(updateId, userId);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true, rejected: true });
      const effects = await database.db.execute<{ count: number }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider_update_id=${updateId}) +
        (select count(*)::int from integration_outbox where correlation_id=${`telegram:${botKey}:${updateId}`}) count
    `);
      expect(effects.rows[0]?.count).toBe(0);
    },
  );

  it("returns retryable 503 and rolls back every effect on a database failure", async () => {
    if (database === undefined)
      throw new Error("b1_fixture_database_unavailable");
    await database.db.execute(sql`
      create function b1_http_reject_inbound() returns trigger language plpgsql as $$
      begin
        if new.provider_update_id = 1005 then
          raise exception 'forced B1 HTTP database failure';
        end if;
        return new;
      end $$
    `);
    await database.db.execute(sql`
      create trigger b1_http_reject_inbound_trigger before insert on dialogue_inbound
      for each row execute function b1_http_reject_inbound()
    `);
    try {
      const response = await request(1_005, 704);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "client_gateway_unavailable" });
    } finally {
      await database.db.execute(
        sql`drop trigger b1_http_reject_inbound_trigger on dialogue_inbound`,
      );
      await database.db.execute(sql`drop function b1_http_reject_inbound()`);
    }
    const effects = await database.db.execute<{
      inbound: number;
      outbox: number;
    }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider_update_id=1005) inbound,
        (select count(*)::int from integration_outbox where correlation_id=${`telegram:${botKey}:1005`}) outbox
    `);
    expect(effects.rows[0]).toEqual({ inbound: 0, outbox: 0 });
  });
});
