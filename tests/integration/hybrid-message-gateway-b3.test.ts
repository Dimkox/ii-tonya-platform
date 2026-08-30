import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  PostgresAdminApprovalRepository,
  PostgresHybridMessageRepository,
  PostgresSelartiBudgetRepository,
  selartiBudgetPolicyApprovalPayload,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("hybrid gateway B3 budget admission", () => {
  let database: TestDatabase;
  let userId: string;
  let gateway: PostgresHybridMessageRepository;
  const botKey = "bot-b3";
  const at = "2026-08-29T12:00:00.000Z";
  const input = (updateId: bigint) => ({
    updateId,
    payloadHash: createHash("sha256").update(`b3:${updateId}`).digest("hex"),
    provider: "telegram" as const,
    botKey,
    externalUserId: "903",
    externalChatId: "903",
    text: "сложный персональный запрос",
    route: "complex_dialogue" as const,
    routingEnabled: true,
    costAdmissionEnabled: true,
    correlationId: `b3-${updateId}`,
    locale: "ru-RU",
    deadline: "2026-08-29T12:00:30.000Z",
    occurredAt: at,
    messagingConsentPolicyVersion: "client-msg-v1",
    selartiConsentPolicyVersion: "selarti-v1",
  });

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    gateway = new PostgresHybridMessageRepository(database.db);
    userId = await database.createUser();
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','903',${botKey},'903','active')`,
    );
    await database.db.execute(
      sql`insert into consents(user_id,consent_type,decision,policy_version,created_at) values(${userId}::uuid,'client_messaging','granted','client-msg-v1','2026-08-28T00:00:00Z'),(${userId}::uuid,'selarti_ai_processing','granted','selarti-v1','2026-08-28T00:00:01Z')`,
    );
  }, 120_000);
  afterAll(async () => database.stop());

  it("fails closed without approved policy and creates only bounded local handoff", async () => {
    expect(await gateway.persist(input(3_001n))).toBe("hard_stop");
    const row = (
      await database.db.execute<{
        paid: number;
        local: number;
        reservations: number;
      }>(
        sql`select (select count(*)::int from integration_outbox where correlation_id='b3-3001' and topic='selarti.request.v1') paid,(select count(*)::int from integration_outbox where correlation_id='b3-3001' and topic='telegram.send_text.v1') local,(select count(*)::int from selarti_cost_reservations) reservations`,
      )
    ).rows[0];
    expect(row).toEqual({ paid: 0, local: 1, reservations: 0 });
  });

  it("uses only settled cash revenue, atomically reserves, and preserves free-client ledgers", async () => {
    const expertUser = await database.createUser();
    const expertId = randomUUID();
    const adminId = randomUUID();
    const approvalId = randomUUID();
    const tariffId = randomUUID();
    const budgetPolicyId = randomUUID();
    const approverId = randomUUID();
    const session = `b3:${randomUUID()}`;
    const approverSession = `b3-approver:${randomUUID()}`;
    const fixtureClock = await database.db.execute<{ now: Date | string }>(
      sql`select clock_timestamp() as now`,
    );
    const rawFixtureNow = fixtureClock.rows[0]?.now;
    if (rawFixtureNow === undefined)
      throw new Error("b3_fixture_clock_missing");
    const fixtureNow = new Date(rawFixtureNow);
    if (Number.isNaN(fixtureNow.getTime()))
      throw new Error("b3_fixture_clock_invalid");
    const fixtureExpiry = new Date(fixtureNow.getTime() + 60 * 60 * 1000);
    const paymentDeadline = new Date(fixtureNow.getTime() + 60 * 60 * 1000);
    const providerDeadline = new Date(
      fixtureNow.getTime() + 2 * 60 * 60 * 1000,
    );
    const settledAt = new Date("2026-08-28T00:00:00Z");
    const residencyEnd = new Date("2026-09-27T00:00:00Z");
    await database.db.execute(
      sql`insert into experts(id,user_id,active,verified) values(${expertId}::uuid,${expertUser}::uuid,true,true)`,
    );
    await database.db.execute(
      sql`insert into users(id) values(${adminId}::uuid)`,
    );
    await database.db.execute(
      sql`insert into users(id) values(${approverId}::uuid)`,
    );
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${adminId}::uuid,${fixtureNow},${fixtureExpiry})`,
    );
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${approverSession},${approverId}::uuid,${fixtureNow},${fixtureExpiry})`,
    );
    await database.db.execute(
      sql`insert into admin_approvals(id,action,object_type,object_id,requester_id,requester_session_id_hash,payload_hash,required_role,requester_mfa_verified_at,expires_at,nonce,created_at) values(${approvalId}::uuid,'expert_residency.tariff_create','expert_residency_tariff_version',${randomUUID()}::uuid,${adminId}::uuid,${session},'sha256:b3','entitlement_admin',${fixtureNow},${fixtureExpiry},${`nonce:${randomUUID()}`},${fixtureNow})`,
    );
    await database.db.execute(
      sql`insert into expert_residency_tariff_versions(id,tariff_key,display_name,price_minor,currency,duration_seconds,active_from,active_to,approval_id,admin_session_id_hash) values(${tariffId}::uuid,'b3','B3',590000,'RUB',2592000,'2026-08-01','2026-09-30',${approvalId}::uuid,${session})`,
    );
    await database.db.execute(
      sql`insert into expert_residency_orders(expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,payment_deadline,provider_deadline,idempotency_key,status,settled_at,residency_starts_at,residency_ends_at) values(${expertId}::uuid,${tariffId}::uuid,'B3',590000,'RUB',2592000,0,590000,${paymentDeadline},${providerDeadline},'b3-revenue','settled',${settledAt},${settledAt},${residencyEnd})`,
    );
    await database.db.execute(
      sql`insert into expert_residency_orders(expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,payment_deadline,provider_deadline,idempotency_key,status) values(${expertId}::uuid,${tariffId}::uuid,'Quoted ignored',590000,'RUB',2592000,290000,300000,${paymentDeadline},${providerDeadline},'b3-quoted','quoted')`,
    );
    const insertPolicy = (id: string, approval: string, version: number) =>
      database.db.execute(
        sql`insert into selarti_budget_policies(id,version,status,effective_from,global_cap_rub_minor,global_warning_rub_minor,global_soft_rub_minor,per_user_warning_rub_minor,per_user_soft_rub_minor,per_user_hard_rub_minor,official_usd_rub_quote_micros,usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,rate_version,model_version,approval_id) values(${id}::uuid,${version},'approved','2026-08-01',1704,568,1704,568,1200,1704,85954100,0,30000,2,'cbr-2026-08-29','selarti-v1',${approval}::uuid)`,
      );
    await expect(
      insertPolicy(randomUUID(), randomUUID(), 98),
    ).rejects.toBeDefined();
    await expect(
      insertPolicy(randomUUID(), approvalId, 99),
    ).rejects.toBeDefined();
    await database.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 hour' where session_id_hash in (${session},${approverSession})`,
    );
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${adminId}::uuid,'security_admin'),(${approverId}::uuid,'security_admin')`,
    );
    await database.db.execute(
      sql`insert into admin_object_assignments(admin_id,object_type,object_id) values(${adminId}::uuid,'selarti_budget_policy',${budgetPolicyId}::uuid)`,
    );
    const approvals = new PostgresAdminApprovalRepository(database.db);
    const payload = selartiBudgetPolicyApprovalPayload({
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
      officialUsdRubQuoteMicros: 85954100n,
      selartiUpliftBps: 1000,
      usdMicrosPerRequest: 0n,
      usdMicrosPerUnit: 30000n,
      worstCaseBillableUnits: 2n,
      rateVersion: "cbr-2026-08-29",
      modelVersion: "selarti-v1",
      stressInflationBps: 6000,
    });
    expect(
      await approvals.requestApproval({
        sessionIdHash: session,
        action: "selarti_budget.policy_approve",
        objectType: "wrong",
        objectId: budgetPolicyId,
        payload,
        nonce: "wrong-scope",
      }),
    ).toBeNull();
    const pending = await approvals.requestApproval({
      sessionIdHash: session,
      action: "selarti_budget.policy_approve",
      objectType: "selarti_budget_policy",
      objectId: budgetPolicyId,
      payload,
      nonce: "b3-policy-v1",
    });
    expect(pending).not.toBeNull();
    await expect(
      insertPolicy(budgetPolicyId, pending!.approvalId, 1),
    ).rejects.toBeDefined();
    expect(
      await approvals.approveApproval({
        approvalId: pending!.approvalId,
        sessionIdHash: approverSession,
      }),
    ).toBe(true);
    const budgetApprovalId = pending!.approvalId;
    await insertPolicy(budgetPolicyId, budgetApprovalId, 1);
    expect(
      (
        await database.db.execute<{ consumed: boolean }>(
          sql`select consumed_at is not null consumed from admin_approvals where id=${budgetApprovalId}::uuid`,
        )
      ).rows[0]?.consumed,
    ).toBe(true);
    expect(await gateway.persist(input(3_002n))).toBe("claimed");
    expect(await gateway.persist(input(3_002n))).toBe("duplicate");
    expect(
      await gateway.persist({
        ...input(3_002n),
        payloadHash: createHash("sha256").update("poison").digest("hex"),
      }),
    ).toBe("conflict");
    const row = (
      await database.db.execute<{
        reserved: bigint;
        paid: number;
        packages: number;
        events: number;
        ledger: number;
      }>(
        sql`select (select reserved_rub_minor from selarti_cost_reservations where request_id like 'sha256:%' order by created_at desc limit 1) reserved,(select count(*)::int from integration_outbox where correlation_id='b3-3002' and topic='selarti.request.v1') paid,(select count(*)::int from message_packages) packages,(select count(*)::int from message_events) events,(select count(*)::int from message_ledger_entries) ledger`,
      )
    ).rows[0];
    expect({ ...row, reserved: BigInt(row!.reserved) }).toEqual({
      reserved: 568n,
      paid: 1,
      packages: 0,
      events: 0,
      ledger: 0,
    });
  });

  it("does not overspend under concurrency and rolls reservation back with outbox failure", async () => {
    await database.db.execute(
      sql`create function b3_fail_outbox() returns trigger language plpgsql as $$ begin if new.correlation_id='b3-3999' and new.topic='selarti.request.v1' then raise exception 'forced'; end if; return new; end $$; create trigger b3_fail_outbox_trigger before insert on integration_outbox for each row execute function b3_fail_outbox()`,
    );
    try {
      await expect(gateway.persist(input(3_999n))).rejects.toBeDefined();
    } finally {
      await database.db.execute(
        sql`drop trigger b3_fail_outbox_trigger on integration_outbox; drop function b3_fail_outbox()`,
      );
    }
    const failedRequestId = `sha256:${createHash("sha256").update(["telegram", botKey, "3999"].join("\0")).digest("hex")}`;
    expect(
      (
        await database.db.execute<{ count: number }>(
          sql`select count(*)::int count from selarti_cost_reservations where request_id=${failedRequestId}`,
        )
      ).rows[0]?.count,
    ).toBe(0);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        gateway.persist(input(BigInt(3_100 + i))),
      ),
    );
    expect(results.filter((x) => x === "warning")).toHaveLength(1);
    expect(results.filter((x) => x === "soft_stop")).toHaveLength(7);
    const exposure = BigInt(
      (
        await database.db.execute<{ amount: string }>(
          sql`select coalesce(sum(reserved_rub_minor),0)::text amount from selarti_cost_reservations`,
        )
      ).rows[0]!.amount,
    );
    expect(exposure).toBe(1_136n);
    const secondUser = await database.createUser();
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${secondUser}::uuid,'telegram','904',${botKey},'904','active')`,
    );
    await database.db.execute(
      sql`insert into consents(user_id,consent_type,decision,policy_version,created_at) values(${secondUser}::uuid,'client_messaging','granted','client-msg-v1','2026-08-28T00:00:00Z'),(${secondUser}::uuid,'selarti_ai_processing','granted','selarti-v1','2026-08-28T00:00:01Z')`,
    );
    const secondInput = (id: bigint) => ({
      ...input(id),
      externalUserId: "904",
      externalChatId: "904",
      payloadHash: createHash("sha256").update(`b3-second:${id}`).digest("hex"),
    });
    expect(await gateway.persist(secondInput(3_500n))).toBe("warning");
    expect(await gateway.persist(secondInput(3_501n))).toBe("hard_stop");
    expect(
      BigInt(
        (
          await database.db.execute<{ amount: string }>(
            sql`select sum(reserved_rub_minor)::text amount from selarti_cost_reservations`,
          )
        ).rows[0]!.amount,
      ),
    ).toBe(1_704n);
    await database.db.execute(
      sql`update expert_residency_orders set status='refunded' where idempotency_key='b3-revenue'`,
    );
    expect(await gateway.persist(input(4_000n))).toBe("hard_stop");
  });

  it("reconciles server-calculated RUB once; unknown cannot resurrect terminal exposure", async () => {
    const requestId = (
      await database.db.execute<{ id: string }>(
        sql`select request_id id from selarti_cost_reservations order by created_at limit 1`,
      )
    ).rows[0]!.id;
    const metrics: string[] = [];
    const repository = new PostgresSelartiBudgetRepository(
      database.db,
      (outcome) => metrics.push(outcome),
    );
    expect(
      await repository.recordOutcome({
        requestId,
        factId: "unknown-1",
        outcome: "unknown",
      }),
    ).toBe("recorded");
    expect(
      await repository.recordOutcome({
        requestId,
        factId: "applied-1",
        outcome: "applied",
        actualUsdMicros: 70_000n,
      }),
    ).toBe("recorded");
    expect(
      await repository.recordOutcome({
        requestId,
        factId: "unknown-after",
        outcome: "unknown",
      }),
    ).toBe("conflict");
    expect(metrics).toEqual(["unknown", "reconciled", "overrun"]);
    expect(
      await repository.recordOutcome({
        requestId,
        factId: "applied-1",
        outcome: "applied",
        actualUsdMicros: 70_000n,
      }),
    ).toBe("duplicate");
    expect(
      await repository.recordOutcome({
        requestId,
        factId: "applied-1",
        outcome: "applied",
        actualUsdMicros: 71_000n,
      }),
    ).toBe("conflict");
    const row = (
      await database.db.execute<{ rub: bigint; overrun: bigint }>(
        sql`select (select actual_rub_minor from selarti_actual_usage_facts where fact_id='applied-1') rub,coalesce((select amount_rub_minor from selarti_cost_adjustments where request_id=${requestId} and kind='overrun'),0)::bigint overrun`,
      )
    ).rows[0]!;
    expect(BigInt(row.rub)).toBe(662n);
    expect(BigInt(row.overrun)).toBe(94n);
    await database.db.execute(
      sql`insert into selarti_cost_reservations select 'release-request',repeat('b',64),policy_id,policy_version,user_id,dialogue_id,period_start,official_usd_rub_quote_micros,effective_usd_rub_quote_micros,selarti_uplift_bps,usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,worst_case_usd_micros,reserved_rub_minor,rate_version,model_version,created_at from selarti_cost_reservations where request_id=${requestId}`,
    );
    expect(
      await repository.recordOutcome({
        requestId: "release-request",
        factId: "release-1",
        outcome: "not_applied",
      }),
    ).toBe("recorded");
    expect(metrics).toEqual(["unknown", "reconciled", "overrun", "released"]);
    await database.db.execute(
      sql`insert into selarti_cost_reservations select 'rollback-request',repeat('c',64),policy_id,policy_version,user_id,dialogue_id,period_start,official_usd_rub_quote_micros,effective_usd_rub_quote_micros,selarti_uplift_bps,usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,worst_case_usd_micros,reserved_rub_minor,rate_version,model_version,created_at from selarti_cost_reservations where request_id=${requestId}`,
    );
    await database.db.execute(
      sql`create function b3_fail_fact() returns trigger language plpgsql as $$ begin if new.fact_id='rollback-fact' then raise exception 'forced'; end if; return new; end $$; create trigger b3_fail_fact_trigger before insert on selarti_actual_usage_facts for each row execute function b3_fail_fact()`,
    );
    try {
      await expect(
        repository.recordOutcome({
          requestId: "rollback-request",
          factId: "rollback-fact",
          outcome: "unknown",
        }),
      ).rejects.toBeDefined();
    } finally {
      await database.db.execute(
        sql`drop trigger b3_fail_fact_trigger on selarti_actual_usage_facts; drop function b3_fail_fact()`,
      );
    }
    expect(metrics).toEqual(["unknown", "reconciled", "overrun", "released"]);
  });

  it("keeps approved policy immutable", async () => {
    await expect(
      database.db.execute(
        sql`update selarti_budget_policies set rate_version='tampered' where version=1`,
      ),
    ).rejects.toBeDefined();
    await expect(
      database.db.execute(
        sql`delete from selarti_budget_policies where version=1`,
      ),
    ).rejects.toBeDefined();
  });
});
