import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  PostgresAdminApprovalRepository,
  PostgresHybridMessageRepository,
  PostgresPrivacyRepository,
  selartiBudgetPolicyApprovalPayload,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("hybrid gateway B1 PostgreSQL transaction", () => {
  let database!: TestDatabase;
  let client: string;
  let repository!: PostgresHybridMessageRepository;
  beforeAll(async () => {
    try {
      database = await startTestPostgres();
      await database.migrate();
      const db = database;
      client = await db.createUser();
      await db.db.execute(
        sql`insert into channel_identities(user_id, provider, external_id, bot_key, external_chat_id, status) values (${client}::uuid, 'telegram', '22', 'bot-a', '22', 'active')`,
      );
      await seedClientConsent(db.db, client, "client_messaging");
      await seedClientConsent(db.db, client, "selarti_ai_processing");

      const nowResult = await db.db.execute<{ now: Date | string }>(
        sql`select clock_timestamp() as now`,
      );
      const nowValue = nowResult.rows[0]?.now;
      if (nowValue === undefined) throw new Error("b1_fixture_clock_missing");
      const fixtureNow = new Date(nowValue);
      if (Number.isNaN(fixtureNow.getTime()))
        throw new Error("b1_fixture_clock_invalid");
      const fixtureExpiry = new Date(fixtureNow.getTime() + 60 * 60 * 1000);
      const paymentDeadline = new Date(fixtureNow.getTime() + 60 * 60 * 1000);
      const providerDeadline = new Date(
        fixtureNow.getTime() + 2 * 60 * 60 * 1000,
      );
      const settledAt = new Date("2026-08-28T00:00:00Z");
      const residencyEnd = new Date("2026-09-27T00:00:00Z");
      const expertUser = await db.createUser();
      const requester = await db.createUser();
      const approver = await db.createUser();
      const expertId = randomUUID();
      const tariffId = randomUUID();
      const policyId = randomUUID();
      const requesterSession = `b1-requester:${randomUUID()}`;
      const approverSession = `b1-approver:${randomUUID()}`;
      await db.db.execute(
        sql`insert into experts(id,user_id,active,verified) values(${expertId}::uuid,${expertUser}::uuid,true,true)`,
      );
      await db.db.execute(sql`
        insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at)
        values(${requesterSession},${requester}::uuid,${fixtureNow},${fixtureExpiry}),(${approverSession},${approver}::uuid,${fixtureNow},${fixtureExpiry})
      `);
      await db.db.execute(sql`
        insert into admin_role_assignments(admin_id,role)
        values(${requester}::uuid,'security_admin'),(${approver}::uuid,'security_admin'),(${requester}::uuid,'entitlement_admin'),(${approver}::uuid,'entitlement_admin')
      `);
      const approvals = new PostgresAdminApprovalRepository(db.db);
      const tariffApproval = await approvals.requestApproval({
        sessionIdHash: requesterSession,
        action: "expert_residency.tariff_create",
        objectType: "expert_residency_tariff_version",
        objectId: tariffId,
        payload: "b1-budget:590000:RUB:2592000",
        nonce: "b1-budget-tariff-v1",
      });
      if (!tariffApproval) throw new Error("b1_tariff_approval_failed");
      expect(
        await approvals.approveApproval({
          approvalId: tariffApproval.approvalId,
          sessionIdHash: approverSession,
        }),
      ).toBe(true);
      await db.db.execute(sql`
        insert into expert_residency_tariff_versions(id,tariff_key,display_name,price_minor,currency,duration_seconds,active_from,active_to,approval_id,admin_session_id_hash)
        values(${tariffId}::uuid,'b1-budget','B1 budget',590000,'RUB',2592000,'2026-08-01','2026-09-30',${tariffApproval.approvalId}::uuid,${requesterSession})
      `);
      await db.db.execute(sql`
        insert into expert_residency_orders(expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,payment_deadline,provider_deadline,idempotency_key,status,settled_at,residency_starts_at,residency_ends_at)
        values(${expertId}::uuid,${tariffId}::uuid,'B1 budget',590000,'RUB',2592000,0,590000,${paymentDeadline},${providerDeadline},'b1-settled-cash','settled',${settledAt},${settledAt},${residencyEnd})
      `);
      await db.db.execute(
        sql`insert into admin_object_assignments(admin_id,object_type,object_id) values(${requester}::uuid,'selarti_budget_policy',${policyId}::uuid)`,
      );
      const policyPayload = selartiBudgetPolicyApprovalPayload({
        version: 1,
        status: "approved",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: null,
        globalCapRubMinor: 59000n,
        globalWarningRubMinor: 58000n,
        globalSoftRubMinor: 58500n,
        perUserWarningRubMinor: 58000n,
        perUserSoftRubMinor: 58500n,
        perUserHardRubMinor: 59000n,
        officialUsdRubQuoteMicros: 85_954_100n,
        selartiUpliftBps: 1000,
        usdMicrosPerRequest: 0n,
        usdMicrosPerUnit: 30_000n,
        worstCaseBillableUnits: 2n,
        rateVersion: "cbr-b1",
        modelVersion: "selarti-b1",
        stressInflationBps: 6000,
      });
      const policyApproval = await approvals.requestApproval({
        sessionIdHash: requesterSession,
        action: "selarti_budget.policy_approve",
        objectType: "selarti_budget_policy",
        objectId: policyId,
        payload: policyPayload,
        nonce: "b1-budget-policy-v1",
      });
      if (!policyApproval) throw new Error("b1_policy_approval_failed");
      expect(
        await approvals.approveApproval({
          approvalId: policyApproval.approvalId,
          sessionIdHash: approverSession,
        }),
      ).toBe(true);
      await db.db.execute(sql`
        insert into selarti_budget_policies(id,version,status,effective_from,global_cap_rub_minor,global_warning_rub_minor,global_soft_rub_minor,per_user_warning_rub_minor,per_user_soft_rub_minor,per_user_hard_rub_minor,official_usd_rub_quote_micros,usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,rate_version,model_version,approval_id)
        values(${policyId}::uuid,1,'approved','2026-08-01',59000,58000,58500,58000,58500,59000,85954100,0,30000,2,'cbr-b1','selarti-b1',${policyApproval.approvalId}::uuid)
      `);
      repository = new PostgresHybridMessageRepository(db.db);
    } catch (error) {
      throw error;
    }
  }, 120_000);
  afterAll(async () => {
    if (database !== undefined) await database.stop();
  }, 45_000);
  const input = (id: bigint, bot = "bot-a", text = "сложный запрос") => ({
    updateId: id,
    payloadHash: createHash("sha256").update(`${id}:${text}`).digest("hex"),
    provider: "telegram" as const,
    botKey: bot,
    externalUserId: "22",
    externalChatId: "22",
    text,
    route: "complex_dialogue" as const,
    routingEnabled: true,
    costAdmissionEnabled: true,
    correlationId: `c-${id}`,
    locale: "ru-RU",
    deadline: "2026-08-29T00:00:30.000Z",
    occurredAt: "2026-08-29T00:00:00.000Z",
    messagingConsentPolicyVersion: "client-messaging-v1",
    selartiConsentPolicyVersion: "selarti-ai-v1",
  });
  const bindClient = async (options: {
    externalUserId: string;
    externalChatId?: string;
    status?: "active" | "blocked" | "unresolved";
    active?: boolean;
    dualRole?: boolean;
    messaging?: readonly [decision: "granted" | "revoked", version: string][];
    ai?: readonly [decision: "granted" | "revoked", version: string][];
  }) => {
    const userId = await database.createUser();
    if (options.active === false) {
      await database.db.execute(
        sql`update users set active=false where id=${userId}::uuid`,
      );
    }
    if (options.dualRole === true) {
      await database.db.execute(
        sql`insert into experts(user_id,active,verified) values(${userId}::uuid,true,true)`,
      );
    }
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${options.externalUserId},'bot-a',${options.externalChatId ?? options.externalUserId},${options.status ?? "active"})`,
    );
    for (const [purpose, decisions] of [
      [
        "client_messaging",
        options.messaging ?? [["granted", "client-messaging-v1"]],
      ],
      ["selarti_ai_processing", options.ai ?? [["granted", "selarti-ai-v1"]]],
    ] as const) {
      for (const [decision, version] of decisions) {
        if (decision === "granted")
          await seedClientConsent(database.db, userId, purpose, version);
        else
          await database.db.execute(
            sql`insert into consents(user_id,consent_type,decision,policy_version,created_at) values(${userId}::uuid,${purpose},${decision},${version},clock_timestamp())`,
          );
      }
    }
    return userId;
  };
  it("creates one dialogue, inbound, route, and Selarti outbox; exact replay is idempotent", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => repository.persist(input(100n))),
    );
    expect(outcomes.filter((x) => x === "claimed")).toHaveLength(1);
    expect(outcomes.filter((x) => x === "duplicate")).toHaveLength(4);
    const rows = await database.db.execute<{ inbound: number; outbox: number }>(
      sql`select (select count(*)::int from dialogue_inbound where provider='telegram' and bot_key='bot-a' and provider_update_id=100) inbound, (select count(*)::int from integration_outbox where topic='selarti.request.v1') outbox`,
    );
    expect(rows.rows[0]).toEqual({ inbound: 1, outbox: 1 });
  });
  it("rejects poison replay and isolates same update id across bots", async () => {
    expect(await repository.persist(input(100n, "bot-a", "different"))).toBe(
      "conflict",
    );
    await database.db.execute(
      sql`insert into channel_identities(user_id, provider, external_id, bot_key, external_chat_id, status) values (${client}::uuid, 'telegram', '22', 'bot-b', '22', 'active')`,
    );
    expect(await repository.persist(input(100n, "bot-b"))).toBe("claimed");
  });
  it("rejects unknown and legacy NULL identity without durable effects; deterministic/routing-off never enqueue Selarti", async () => {
    expect(
      await repository.persist({ ...input(101n), externalUserId: "999" }),
    ).toBe("rejected");
    await database.db.execute(
      sql`insert into channel_identities(user_id, provider, external_id, status) values (${client}::uuid, 'telegram', 'legacy', 'active')`,
    );
    expect(
      await repository.persist({ ...input(102n), externalUserId: "legacy" }),
    ).toBe("rejected");
    expect(
      await repository.persist({
        ...input(103n),
        route: "deterministic",
        routingEnabled: false,
      }),
    ).toBe("claimed");
    const rows = await database.db.execute<{ count: number }>(
      sql`select count(*)::int count from integration_outbox where topic='selarti.request.v1' and correlation_id in ('c-101','c-102','c-103')`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
  it("rolls back identity-resolved inbound and route when Selarti outbox insertion fails", async () => {
    await database.db.execute(sql`
      create function b1_reject_selected_outbox() returns trigger language plpgsql as $$
      begin
        if new.topic = 'selarti.request.v1' and new.correlation_id = 'c-104' then
          raise exception 'forced B1 outbox failure';
        end if;
        return new;
      end $$
    `);
    await database.db.execute(sql`
      create trigger b1_reject_selected_outbox_trigger before insert on integration_outbox
      for each row execute function b1_reject_selected_outbox()
    `);
    try {
      await expect(repository.persist(input(104n))).rejects.toBeDefined();
    } finally {
      await database.db.execute(
        sql`drop trigger b1_reject_selected_outbox_trigger on integration_outbox`,
      );
      await database.db.execute(sql`drop function b1_reject_selected_outbox()`);
    }
    const rows = await database.db.execute<{
      inbound: number;
      routes: number;
      outbox: number;
    }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider='telegram' and bot_key='bot-a' and provider_update_id=104) inbound,
        (select count(*)::int from dialogue_route_decisions r join dialogue_inbound i on i.id=r.inbound_id where i.provider='telegram' and i.bot_key='bot-a' and i.provider_update_id=104) routes,
        (select count(*)::int from integration_outbox where correlation_id='c-104') outbox
    `);
    expect(rows.rows[0]).toEqual({ inbound: 0, routes: 0, outbox: 0 });
  });
  it("rejects dialogue ownership rebind before inbound effects", async () => {
    await bindClient({ externalUserId: "33", externalChatId: "22" });
    expect(
      await repository.persist({ ...input(105n), externalUserId: "33" }),
    ).toBe("rejected");
    const rows = await database.db.execute<{ count: number }>(
      sql`select count(*)::int count from dialogue_inbound where provider_update_id=105`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
  it("accepts an active dual-role client and rejects inactive, blocked, and unresolved bindings", async () => {
    await bindClient({ externalUserId: "dual", dualRole: true });
    await bindClient({ externalUserId: "inactive", active: false });
    await bindClient({ externalUserId: "blocked", status: "blocked" });
    await bindClient({ externalUserId: "unresolved", status: "unresolved" });
    expect(
      await repository.persist({
        ...input(106n),
        externalUserId: "dual",
        externalChatId: "dual",
        route: "deterministic",
        routingEnabled: false,
      }),
    ).toBe("claimed");
    for (const [updateId, externalId] of [
      [107n, "inactive"],
      [108n, "blocked"],
      [109n, "unresolved"],
    ] as const) {
      expect(
        await repository.persist({
          ...input(updateId),
          externalUserId: externalId,
          externalChatId: externalId,
        }),
      ).toBe("rejected");
    }
    const rows = await database.db.execute<{
      accepted: number;
      rejected: number;
    }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider_update_id=106) accepted,
        (select count(*)::int from dialogue_inbound where provider_update_id in (107,108,109)) rejected
    `);
    expect(rows.rows[0]).toEqual({ accepted: 1, rejected: 0 });
  });
  it("requires the latest exact messaging and Selarti policy grants before storing text", async () => {
    await bindClient({
      externalUserId: "wrong-policy",
      messaging: [["granted", "client-messaging-v0"]],
    });
    await bindClient({
      externalUserId: "revoked-message",
      messaging: [
        ["granted", "client-messaging-v1"],
        ["revoked", "client-messaging-v1"],
      ],
    });
    await bindClient({
      externalUserId: "revoked-ai",
      ai: [
        ["granted", "selarti-ai-v1"],
        ["revoked", "selarti-ai-v1"],
      ],
    });
    for (const [updateId, externalId] of [
      [110n, "wrong-policy"],
      [111n, "revoked-message"],
      [112n, "revoked-ai"],
    ] as const) {
      expect(
        await repository.persist({
          ...input(updateId),
          externalUserId: externalId,
          externalChatId: externalId,
        }),
      ).toBe("rejected");
    }
    const rows = await database.db.execute<{ count: number }>(
      sql`select count(*)::int count from dialogue_inbound where provider_update_id in (110,111,112)`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
  it("does not mutate package, event, ledger, or deferred coupon accounting", async () => {
    const snapshot = async () =>
      database.db.execute<{
        packages: number;
        events: number;
        ledger: number;
        couponTable: boolean;
      }>(sql`
      select
        (select count(*)::int from message_packages) packages,
        (select count(*)::int from message_events) events,
        (select count(*)::int from message_ledger_entries) ledger,
        to_regclass('public.coupons') is not null as "couponTable"
    `);
    const before = (await snapshot()).rows[0];
    expect(
      await repository.persist({
        ...input(113n),
        route: "deterministic",
        routingEnabled: false,
      }),
    ).toBe("claimed");
    const after = (await snapshot()).rows[0];
    expect(after).toEqual(before);
    expect(after).toEqual({
      packages: 0,
      events: 0,
      ledger: 0,
      couponTable: false,
    });
  });

  it("serializes ingress consent checks with runtime withdrawal on the shared user lock", async () => {
    const ingressUser = await bindClient({ externalUserId: "race-ingress" });
    let signalConsentRead!: () => void;
    const consentRead = new Promise<void>((resolve) => {
      signalConsentRead = resolve;
    });
    let releaseIngress!: () => void;
    const ingressRelease = new Promise<void>((resolve) => {
      releaseIngress = resolve;
    });
    let withdrawalReachedAudit = false;
    const ingressFirst = new PostgresHybridMessageRepository(database.db, {
      afterConsentRead: async (userId) => {
        expect(userId).toBe(ingressUser);
        signalConsentRead();
        await ingressRelease;
      },
    });
    const privacyAfterIngress = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
      beforeWithdrawalAudit: () => {
        withdrawalReachedAudit = true;
      },
    });
    const ingress = ingressFirst.persist({
      ...input(114n),
      externalUserId: "race-ingress",
      externalChatId: "race-ingress",
    });
    await expect(
      Promise.race([
        consentRead.then(() => "read"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 250)),
      ]),
    ).resolves.toBe("read");
    const withdrawal = privacyAfterIngress.withdrawConsentAtomically({
      targetUserId: ingressUser,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: "withdraw-after-ingress",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(withdrawalReachedAudit).toBe(false);
    releaseIngress();
    await expect(ingress).resolves.toBe("claimed");
    await expect(withdrawal).resolves.toBeDefined();

    const revokeUser = await bindClient({ externalUserId: "race-revoke" });
    let signalWithdrawalLock!: () => void;
    const withdrawalLocked = new Promise<void>((resolve) => {
      signalWithdrawalLock = resolve;
    });
    let releaseWithdrawal!: () => void;
    const withdrawalRelease = new Promise<void>((resolve) => {
      releaseWithdrawal = resolve;
    });
    const privacyFirst = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
      beforeWithdrawalAudit: async () => {
        signalWithdrawalLock();
        await withdrawalRelease;
      },
    });
    const revoke = privacyFirst.withdrawConsentAtomically({
      targetUserId: revokeUser,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: "withdraw-before-ingress",
    });
    await withdrawalLocked;
    let ingressSettled = false;
    const afterRevoke = repository
      .persist({
        ...input(115n),
        externalUserId: "race-revoke",
        externalChatId: "race-revoke",
      })
      .finally(() => {
        ingressSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ingressSettled).toBe(false);
    releaseWithdrawal();
    await expect(revoke).resolves.toBeDefined();
    await expect(afterRevoke).resolves.toBe("rejected");
    const effects = await database.db.execute<{
      inbound: number;
      outbox: number;
    }>(sql`
      select
        (select count(*)::int from dialogue_inbound where provider_update_id=115) inbound,
        (select count(*)::int from integration_outbox where topic='selarti.request.v1' and correlation_id='c-115') outbox
    `);
    expect(effects.rows[0]).toEqual({ inbound: 0, outbox: 0 });
  });
});
