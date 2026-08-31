import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  canonicalAdminPayloadHash,
  PostgresAdminApprovalRepository,
  selartiBudgetPolicyApprovalPayload,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

type Policy = {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  globalCapRubMinor: bigint;
  globalWarningRubMinor: bigint;
  globalSoftRubMinor: bigint;
  perUserWarningRubMinor: bigint;
  perUserSoftRubMinor: bigint;
  perUserHardRubMinor: bigint;
  officialUsdRubQuoteMicros: bigint;
  usdMicrosPerRequest: bigint;
  usdMicrosPerUnit: bigint;
  worstCaseBillableUnits: bigint;
};

describe("B3 operator policy guards", () => {
  let database: TestDatabase;
  let requesterId: string;
  let approverId: string;
  let requesterSession: string;
  let approverSession: string;
  let approvals: PostgresAdminApprovalRepository;
  const base = (version: number, from: string, to: string | null): Policy => ({
    id: randomUUID(),
    version,
    effectiveFrom: from,
    effectiveTo: to,
    globalCapRubMinor: 1_704n,
    globalWarningRubMinor: 568n,
    globalSoftRubMinor: 1_704n,
    perUserWarningRubMinor: 568n,
    perUserSoftRubMinor: 1_200n,
    perUserHardRubMinor: 1_704n,
    officialUsdRubQuoteMicros: 85_954_100n,
    usdMicrosPerRequest: 0n,
    usdMicrosPerUnit: 30_000n,
    worstCaseBillableUnits: 2n,
  });
  const payload = (p: Policy) =>
    selartiBudgetPolicyApprovalPayload({
      version: p.version,
      status: "approved",
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      globalCapRubMinor: p.globalCapRubMinor,
      globalWarningRubMinor: p.globalWarningRubMinor,
      globalSoftRubMinor: p.globalSoftRubMinor,
      perUserWarningRubMinor: p.perUserWarningRubMinor,
      perUserSoftRubMinor: p.perUserSoftRubMinor,
      perUserHardRubMinor: p.perUserHardRubMinor,
      officialUsdRubQuoteMicros: p.officialUsdRubQuoteMicros,
      selartiUpliftBps: 1000,
      usdMicrosPerRequest: p.usdMicrosPerRequest,
      usdMicrosPerUnit: p.usdMicrosPerUnit,
      worstCaseBillableUnits: p.worstCaseBillableUnits,
      rateVersion: "cbr-guard-v1",
      modelVersion: "selarti-guard-v1",
      stressInflationBps: 6000,
    });
  const insertPolicy = (p: Policy, approvalId: string) =>
    database.db.execute(sql`
    insert into selarti_budget_policies(
      id,version,status,effective_from,effective_to,global_cap_rub_minor,
      global_warning_rub_minor,global_soft_rub_minor,per_user_warning_rub_minor,
      per_user_soft_rub_minor,per_user_hard_rub_minor,official_usd_rub_quote_micros,
      usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,
      rate_version,model_version,approval_id
    ) values (
      ${p.id}::uuid,${p.version},'approved',${p.effectiveFrom}::timestamptz,
      ${p.effectiveTo}::timestamptz,${p.globalCapRubMinor},${p.globalWarningRubMinor},
      ${p.globalSoftRubMinor},${p.perUserWarningRubMinor},${p.perUserSoftRubMinor},
      ${p.perUserHardRubMinor},${p.officialUsdRubQuoteMicros},${p.usdMicrosPerRequest},
      ${p.usdMicrosPerUnit},${p.worstCaseBillableUnits},'cbr-guard-v1','selarti-guard-v1',
      ${approvalId}::uuid
    )
  `);
  const approve = async (p: Policy) => {
    await database.db.execute(
      sql`insert into admin_object_assignments(admin_id,object_type,object_id) values(${requesterId}::uuid,'selarti_budget_policy',${p.id}::uuid)`,
    );
    const requested = await approvals.requestApproval({
      sessionIdHash: requesterSession,
      action: "selarti_budget.policy_approve",
      objectType: "selarti_budget_policy",
      objectId: p.id,
      payload: payload(p),
      nonce: `policy-${p.version}`,
    });
    if (!requested) throw new Error("approval_request_failed");
    expect(
      await approvals.approveApproval({
        approvalId: requested.approvalId,
        sessionIdHash: approverSession,
      }),
    ).toBe(true);
    return requested.approvalId;
  };

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    requesterId = await database.createUser();
    approverId = await database.createUser();
    requesterSession = `guard-requester:${randomUUID()}`;
    approverSession = `guard-approver:${randomUUID()}`;
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${requesterSession},${requesterId}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour'),(${approverSession},${approverId}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${requesterId}::uuid,'security_admin'),(${approverId}::uuid,'security_admin')`,
    );
    approvals = new PostgresAdminApprovalRepository(database.db);
  }, 120_000);
  afterAll(async () => database.stop());

  it.each([
    "same_actor",
    "missing_role",
    "revoked_session",
    "expired_session",
    "mismatched_session",
    "expired_approval",
  ] as const)("rejects forged approved row: %s", async (kind) => {
    const p = base(
      10 +
        [
          "same_actor",
          "missing_role",
          "revoked_session",
          "expired_session",
          "mismatched_session",
          "expired_approval",
        ].indexOf(kind),
      `2026-01-0${1 + ["same_actor", "missing_role", "revoked_session", "expired_session", "mismatched_session", "expired_approval"].indexOf(kind)}T00:00:00.000Z`,
      `2026-01-0${2 + ["same_actor", "missing_role", "revoked_session", "expired_session", "mismatched_session", "expired_approval"].indexOf(kind)}T00:00:00.000Z`,
    );
    const malformedUser = await database.createUser();
    const malformedSession = `malformed:${kind}:${randomUUID()}`;
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at,revoked_at) values(${malformedSession},${malformedUser}::uuid,clock_timestamp()-interval '1 minute',case when ${kind}='expired_session' then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '1 hour' end,case when ${kind}='revoked_session' then clock_timestamp() else null end)`,
    );
    if (kind !== "missing_role")
      await database.db.execute(
        sql`insert into admin_role_assignments(admin_id,role) values(${malformedUser}::uuid,'security_admin')`,
      );
    const approvalId = randomUUID();
    const forgedApproval = database.db.execute(
      sql`insert into admin_approvals(id,action,object_type,object_id,requester_id,approver_id,requester_session_id_hash,approver_session_id_hash,payload_hash,required_role,requester_mfa_verified_at,approver_mfa_verified_at,approved_at,expires_at,nonce,created_at) values(${approvalId}::uuid,'selarti_budget.policy_approve','selarti_budget_policy',${p.id}::uuid,${requesterId}::uuid,case when ${kind}='same_actor' then ${requesterId}::uuid else ${malformedUser}::uuid end,${requesterSession},case when ${kind}='same_actor' then ${requesterSession} when ${kind}='mismatched_session' then ${approverSession} else ${malformedSession} end,${canonicalAdminPayloadHash(payload(p))},'security_admin',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',case when ${kind}='expired_approval' then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '5 minutes' end,${`nonce-${kind}`},clock_timestamp()-interval '1 minute')`,
    );
    const approvalResult = await Promise.allSettled([forgedApproval]);
    if (approvalResult[0]?.status === "fulfilled") {
      await expect(insertPolicy(p, approvalId)).rejects.toBeDefined();
    } else {
      expect(approvalResult[0]?.reason).toBeDefined();
    }
  });

  it.each([
    "missing_role",
    "revoked_session",
    "expired_session",
    "mismatched_session",
    "stale_mfa",
    "future_mfa",
    "future_approved_at",
  ] as const)("rejects forged requester control: %s", async (kind) => {
    const index = [
      "missing_role",
      "revoked_session",
      "expired_session",
      "mismatched_session",
      "stale_mfa",
      "future_mfa",
      "future_approved_at",
    ].indexOf(kind);
    const p = base(
      30 + index,
      `2026-02-${String(1 + index).padStart(2, "0")}T00:00:00.000Z`,
      `2026-02-${String(2 + index).padStart(2, "0")}T00:00:00.000Z`,
    );
    const malformedRequester = await database.createUser();
    const malformedSession = `bad-requester:${kind}:${randomUUID()}`;
    await database.db.execute(sql`
      insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at,revoked_at)
      values(
        ${malformedSession},${malformedRequester}::uuid,
        case when ${kind}='stale_mfa' then clock_timestamp()-interval '16 minutes'
             when ${kind}='future_mfa' then clock_timestamp()+interval '30 seconds'
             else clock_timestamp()-interval '1 minute' end,
        case when ${kind}='expired_session' then clock_timestamp()-interval '1 second'
             else clock_timestamp()+interval '1 hour' end,
        case when ${kind}='revoked_session' then clock_timestamp() else null end
      )
    `);
    if (kind !== "missing_role") {
      await database.db.execute(
        sql`insert into admin_role_assignments(admin_id,role) values(${malformedRequester}::uuid,'security_admin')`,
      );
    }
    const approvalId = randomUUID();
    await database.db.execute(sql`
      insert into admin_approvals(
        id,action,object_type,object_id,requester_id,approver_id,
        requester_session_id_hash,approver_session_id_hash,payload_hash,required_role,
        requester_mfa_verified_at,approver_mfa_verified_at,approved_at,expires_at,nonce,created_at
      ) values(
        ${approvalId}::uuid,'selarti_budget.policy_approve','selarti_budget_policy',${p.id}::uuid,
        ${malformedRequester}::uuid,${approverId}::uuid,
        case when ${kind}='mismatched_session' then ${requesterSession} else ${malformedSession} end,
        ${approverSession},${canonicalAdminPayloadHash(payload(p))},'security_admin',
        case when ${kind}='stale_mfa' then clock_timestamp()-interval '16 minutes'
             when ${kind}='future_mfa' then clock_timestamp()+interval '30 seconds'
             else clock_timestamp()-interval '1 minute' end,
        clock_timestamp()-interval '1 minute',
        case when ${kind}='future_mfa' then clock_timestamp()+interval '90 seconds'
             when ${kind}='future_approved_at' then clock_timestamp()+interval '30 seconds'
             else clock_timestamp()-interval '30 seconds' end,
        clock_timestamp()+interval '5 minutes',${`bad-requester-${kind}`},
        case when ${kind}='future_mfa' then clock_timestamp()+interval '1 minute'
             else clock_timestamp()-interval '30 seconds' end
      )
    `);
    await expect(insertPolicy(p, approvalId)).rejects.toBeDefined();
  });

  it("allows adjacent windows and rejects sequential overlap", async () => {
    const first = base(
      1,
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    );
    await insertPolicy(first, await approve(first));
    const adjacent = base(
      2,
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
    await expect(
      insertPolicy(adjacent, await approve(adjacent)),
    ).resolves.toBeDefined();
    const overlap = base(
      3,
      "2026-08-15T00:00:00.000Z",
      "2026-09-15T00:00:00.000Z",
    );
    await expect(
      insertPolicy(overlap, await approve(overlap)),
    ).rejects.toBeDefined();
  });

  it("serializes concurrent overlapping inserts so exactly one wins", async () => {
    const a = base(4, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
    const b = base(5, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
    const results = await Promise.allSettled([
      insertPolicy(a, await approve(a)),
      insertPolicy(b, await approve(b)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it.each([
    ["quote_zero", 101, { officialUsdRubQuoteMicros: 0n }],
    ["quote_high", 102, { officialUsdRubQuoteMicros: 1_000_000_000_000n }],
    ["request_negative", 103, { usdMicrosPerRequest: -1n }],
    ["request_high", 104, { usdMicrosPerRequest: 1_000_000_000_000n }],
    ["unit_high", 105, { usdMicrosPerUnit: 1_000_000_000_000n }],
    ["units_zero", 106, { worstCaseBillableUnits: 0n }],
    ["units_high", 107, { worstCaseBillableUnits: 1_000_001n }],
    ["derived_zero", 108, { usdMicrosPerRequest: 0n, usdMicrosPerUnit: 0n }],
  ] as const)(
    "rejects calculator-incompatible bound %s",
    async (_name, version, override) => {
      const p = {
        ...base(
          version,
          "2027-01-01T00:00:00.000Z",
          "2027-02-01T00:00:00.000Z",
        ),
        ...override,
      };
      await expect(insertPolicy(p, await approve(p))).rejects.toBeDefined();
    },
  );

  it("accepts exact derived cap and rejects one micro-dollar above it", async () => {
    const accepted = {
      ...base(200, "2027-02-01T00:00:00.000Z", "2027-03-01T00:00:00.000Z"),
      globalCapRubMinor: 999_999_999_999n,
      globalWarningRubMinor: 0n,
      globalSoftRubMinor: 999_999_999_999n,
      perUserWarningRubMinor: 0n,
      perUserSoftRubMinor: 999_999_999_999n,
      perUserHardRubMinor: 999_999_999_999n,
      officialUsdRubQuoteMicros: 10_000_000n,
      usdMicrosPerUnit: 90_909_090_909n,
      worstCaseBillableUnits: 10_000n,
    };
    await expect(
      insertPolicy(accepted, await approve(accepted)),
    ).resolves.toBeDefined();
    const rejected = {
      ...accepted,
      id: randomUUID(),
      version: 201,
      effectiveFrom: "2027-03-01T00:00:00.000Z",
      effectiveTo: "2027-04-01T00:00:00.000Z",
      usdMicrosPerRequest: 1n,
    };
    await expect(
      insertPolicy(rejected, await approve(rejected)),
    ).rejects.toBeDefined();
  });
});
