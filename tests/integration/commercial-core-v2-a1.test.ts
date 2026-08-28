import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresClientCommercialPolicyRepository,
  PostgresMessageRepository,
} from "../../packages/db/src/index.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

describe("Commercial Core V2 A1 PostgreSQL path", () => {
  let database: ExpertReferralTestDatabase;
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
  }, 120_000);
  afterAll(async () => database?.stop(), 60_000);

  it("audits admission and START, assigns once, completes free, and snapshots the 30% cap", async () => {
    const client = await database.createUser();
    const expert = await database.createExpertIdentity();
    const controlAudit = await database.createAdminAudit({
      action: "client_commercial_policy.control_v2",
      objectId: "00000000-0000-0000-0000-000000000041",
      objectType: "client_commercial_policy_control",
      payload: { version: 1, admissionPolicy: "free_client_v2" },
    });
    await database.db.execute(sql`
      insert into expert_referral_admin_execution_results
        (approval_id, action, object_id, payload_hash, nonce_hash, requester_session_id_hash, expected_version, safe_result)
      values (${controlAudit.approvalId}::uuid, 'client_commercial_policy.control_v2', '00000000-0000-0000-0000-000000000041'::uuid,
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ${controlAudit.sessionIdHash}, 0, '{"version":1,"admissionPolicy":"free_client_v2"}'::jsonb)
    `);
    await database.db.execute(sql`
      insert into client_commercial_policy_controls
        (control_key, admission_policy, version, approval_id, admin_session_id_hash)
      values ('client_access', 'free_client_v2', 1, ${controlAudit.approvalId}::uuid, ${controlAudit.sessionIdHash})
    `);
    const policies = new PostgresClientCommercialPolicyRepository(database.db);
    await expect(
      Promise.all([
        policies.resolveOrAssign({ userId: client, allowV2Admission: true }),
        policies.resolveOrAssign({ userId: client, allowV2Admission: true }),
      ]),
    ).resolves.toEqual(["free_client_v2", "free_client_v2"]);
    const assignment = await database.db.execute<{ count: number }>(sql`
      select count(*)::int as count from client_commercial_policy_assignments where user_id=${client}::uuid
    `);
    expect(assignment.rows[0]?.count).toBe(1);

    const tariff = await database.createResidencyTariff({
      tariffKey: "START",
      displayName: "Старт",
      priceMinor: 390000,
      durationSeconds: 2592000,
    });
    const audit = await database.db.execute<{ actions: string[] }>(sql`
      select array_agg(distinct action order by action) as actions from (
        select action from expert_referral_admin_execution_results
        union all select action from admin_approvals
      ) audited
      where action in ('client_commercial_policy.control_v2', 'expert_residency.tariff_create_v2')
    `);
    expect(audit.rows[0]?.actions).toEqual([
      "client_commercial_policy.control_v2",
      "expert_residency.tariff_create_v2",
    ]);
    await database.enableExpertReferralCommands();

    const message = new PostgresMessageRepository(database.db);
    const inbound = await message.prepareInbound({
      provider: "selarti",
      externalEventId: randomUUID(),
      externalMessageId: randomUUID(),
      userId: client,
      messageClass: "ordinary_inbound",
      occurredAt: new Date(),
      correlationId: randomUUID(),
    });
    expect(
      await message.completeInbound({
        messageEventId: inbound.messageEventId,
        userId: client,
        correlationId: randomUUID(),
        billingPolicy: "free",
        outcome: { kind: "no_package", topic: "client.free", payload: {} },
      }),
    ).toMatchObject({ kind: "completed", packageId: null, ledgerBalance: 0 });

    const grants = [randomUUID(), randomUUID()];
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const grant of grants) {
        await tx.execute(
          sql`insert into expert_referral_reward_grants (id, expert_id, referral_id, first_settlement_id, qualifying_order_id, qualifying_payment_attempt_id, amount_minor, granted_at, expires_at, idempotency_key) values (${grant}::uuid, ${expert.expertId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, 100000, now(), now() + interval '365 days', ${randomUUID()})`,
        );
        const grantEntry = await tx.execute<{ id: string }>(
          sql`insert into expert_referral_ledger_entries (expert_id, entry_kind, amount_minor, source_type, source_id, idempotency_key) values (${expert.expertId}::uuid, 'reward_grant', 100000, 'reward_grant', ${grant}::uuid, ${randomUUID()}) returning id`,
        );
        await tx.execute(
          sql`insert into expert_referral_ledger_allocations (ledger_entry_id, reward_grant_id, expert_id, amount_minor) values (${grantEntry.rows[0]!.id}::uuid, ${grant}::uuid, ${expert.expertId}::uuid, 100000)`,
        );
      }
    });
    const residency = new PostgresExpertResidencyRepository(database.db);
    const order = await residency.createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId: tariff,
      providerDeadline: new Date(Date.now() + 3600000),
      idempotencyKey: randomUUID(),
    });
    expect(order).toMatchObject({
      commercialPolicyVersion: "expert_residency_v2",
      creditCapBps: 3000,
      priceMinor: "390000",
      creditMinor: "117000",
      cashMinor: "273000",
    });
    await expect(
      database.db.execute(
        sql`update expert_residency_orders set credit_cap_bps=5000 where id=${order.id}::uuid`,
      ),
    ).rejects.toBeDefined();
    const snapshot = await database.db.execute<{ price: string; cap: number }>(
      sql`select price_minor::text as price, credit_cap_bps as cap from expert_residency_orders where id=${order.id}::uuid`,
    );
    expect(snapshot.rows[0]).toEqual({ price: "390000", cap: 3000 });
    const providerCalls = await database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from expert_residency_provider_operations`,
    );
    expect(providerCalls.rows[0]?.count).toBe(0);
  });
});
