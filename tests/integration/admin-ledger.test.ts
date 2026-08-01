import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresAdminApprovalRepository,
  PostgresAdminRepository,
  type AdminPayload,
  type AdminRole,
  type ApprovalAdminAction,
} from "../../packages/db/src/index.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";
import { expectPostgresErrorCause } from "../support/postgres-error.js";

let testDb: TestDatabase | undefined;

const rejected = async (operation: Promise<unknown>): Promise<unknown> =>
  operation.then(
    () => { throw new Error("Expected PostgreSQL trigger rejection"); },
    (error: unknown) => error,
  );

const expectHandoffPostgresRejection = async (
  operation: Promise<unknown>,
  expectedCode: string,
  expectedMessage: string,
): Promise<void> => {
  expectPostgresErrorCause(await rejected(operation), expectedCode, expectedMessage);
};

async function seedAdmin(role: AdminRole) {
  const adminId = randomUUID();
  const sessionIdHash = `session:${randomUUID()}`;
  await testDb!.db.execute(sql`insert into users (id) values (${adminId}::uuid)`);
  await testDb!.db.execute(sql`
    insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at)
    values (${sessionIdHash}, ${adminId}::uuid, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour')
  `);
  await testDb!.db.execute(sql`insert into admin_role_assignments (admin_id, role) values (${adminId}::uuid, ${role})`);
  return { adminId, sessionIdHash };
}

async function approved(input: {
  requester: { sessionIdHash: string };
  approver: { sessionIdHash: string };
  action: ApprovalAdminAction;
  objectType: string;
  objectId: string;
  payload: AdminPayload;
}) {
  const nonce = `nonce:${randomUUID()}`;
  const approvals = new PostgresAdminApprovalRepository(testDb!.db);
  const request = await approvals.requestApproval({ ...input, sessionIdHash: input.requester.sessionIdHash, nonce });
  expect(request).not.toBeNull();
  await expect(approvals.approveApproval({ approvalId: request!.approvalId, sessionIdHash: input.approver.sessionIdHash })).resolves.toBe(true);
  return { approvalId: request!.approvalId, nonce, sessionIdHash: input.requester.sessionIdHash, correlationId: `corr:${randomUUID()}` };
}

async function seedSafetyAlert(
  status: "opened" | "assigned" | "acknowledged" | "escalated",
  assignedAdminId: string,
  slaExpired = false,
) {
  const incidentId = randomUUID();
  const alertId = randomUUID();
  await testDb!.db.execute(sql`
    insert into safety_incidents (id, reason_code, metadata_hash)
    values (${incidentId}::uuid, 'safety_test', 'sha256:redacted')
  `);
  await testDb!.db.execute(sql`
    insert into human_escalations (
      id, incident_id, status, opened_at, acknowledgement_deadline,
      acknowledged_at, owner_id, escalation_reason
    ) values (
      ${alertId}::uuid, ${incidentId}::uuid, ${status}, clock_timestamp(),
      clock_timestamp() + case when ${slaExpired} then interval '-5 minutes' else interval '5 minutes' end,
      case when ${status} = 'acknowledged' then clock_timestamp() else null end,
      ${assignedAdminId}::uuid, 'safety_test'
    )
  `);
  await testDb!.db.execute(sql`
    insert into admin_object_assignments (admin_id, object_type, object_id)
    values (${assignedAdminId}::uuid, 'safety_case', ${alertId}::uuid)
  `);
  return alertId;
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

describe("atomic approved admin workflows", () => {
  it("grants once under replay/concurrency with DB-authoritative 60-day immutable metadata and complete audit", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const approver = await seedAdmin("entitlement_admin");
    const userId = await testDb!.createUser();
    const idempotencyKey = `grant:${randomUUID()}`;
    const payload = { userId, units: 500, idempotencyKey };
    const auth = await approved({ requester, approver, action: "package.grant", objectType: "user", objectId: userId, payload });
    const repository = new PostgresAdminRepository(testDb!.db);
    const command = { ...auth, userId, units: 500 as const, idempotencyKey };

    const raced = await Promise.all([repository.grantPackage(command), repository.grantPackage(command)]);
    expect(raced.every((result) => result.allowed)).toBe(true);
    expect(raced.filter((result) => result.allowed && !result.replayed)).toHaveLength(1);
    await expect(repository.grantPackage(command)).resolves.toMatchObject({ allowed: true, replayed: true });
    for (const changed of [
      { nonce: `${auth.nonce}:changed`, correlationId: `corr:${randomUUID()}` },
      { units: 1000 as const, correlationId: `corr:${randomUUID()}` },
      { userId: await testDb!.createUser(), correlationId: `corr:${randomUUID()}` },
    ]) {
      await expect(repository.grantPackage({ ...command, ...changed }))
        .resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });
    }
    await expect(repository.grantIntroPackage({
      ...command,
      units: 100,
      correlationId: `corr:${randomUUID()}`,
    })).resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });
    await testDb!.db.execute(sql`
      insert into admin_role_assignments (admin_id, role)
      values (${requester.adminId}::uuid, 'support')
    `);
    await testDb!.db.execute(sql`
      delete from admin_role_assignments
      where admin_id = ${requester.adminId}::uuid and role = 'entitlement_admin'
    `);
    await expect(repository.grantPackage({
      ...command,
      correlationId: `corr:${randomUUID()}`,
    })).resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });

    const facts = await testDb!.db.execute<{
      packages: string; grants: string; audits: string; consumed: string; seconds: string;
    }>(sql`
      select
        (select count(*)::text from message_packages where grant_idempotency_key = ${idempotencyKey}) as packages,
        (select count(*)::text from message_ledger_entries where idempotency_key = ${`admin:${idempotencyKey}:grant`}) as grants,
        (select count(*)::text from audit_events where correlation_id = ${auth.correlationId} and decision = 'allowed'
          and actor_id = ${requester.adminId}::uuid and authenticated_session_id_hash = ${requester.sessionIdHash}
          and action = 'package.grant.allowed' and object_type = 'user' and object_id = ${userId}::uuid
          and reason_code = 'approved_dual_control' and metadata_hash <> '') as audits,
        (select count(*)::text from admin_approvals where id = ${auth.approvalId}::uuid and consumed_at is not null) as consumed,
        (select extract(epoch from (expires_at - granted_at))::text from message_packages where grant_idempotency_key = ${idempotencyKey}) as seconds
    `);
    expect(facts.rows[0]).toEqual({ packages: "1", grants: "1", audits: "1", consumed: "1", seconds: "5184000.000000" });
    await expect(testDb!.db.execute(sql`update message_packages set granted_messages = 1 where grant_idempotency_key = ${idempotencyKey}`)).rejects.toThrow();
    await expect(testDb!.db.execute(sql`delete from audit_events where correlation_id = ${auth.correlationId}`)).rejects.toThrow();
  });

  it("keeps intro grants separate, exact 100 units, and without expiry", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const approver = await seedAdmin("entitlement_admin");
    const userId = await testDb!.createUser();
    const idempotencyKey = `intro:${randomUUID()}`;
    const auth = await approved({
      requester, approver, action: "package.intro_grant", objectType: "user", objectId: userId,
      payload: { userId, units: 100, idempotencyKey },
    });
    await expect(new PostgresAdminRepository(testDb!.db).grantIntroPackage({
      ...auth, userId, units: 100, idempotencyKey,
    })).resolves.toMatchObject({ allowed: true, replayed: false });
    const row = await testDb!.db.execute(sql`
      select granted_messages, kind, expires_at from message_packages where grant_idempotency_key = ${idempotencyKey}
    `);
    expect(row.rows[0]).toMatchObject({ granted_messages: 100, kind: "intro", expires_at: null });
  });

  it("revokes only the bound user's locked package by one conserving append-only fact", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const approver = await seedAdmin("entitlement_admin");
    const ownerId = await testDb!.createUser();
    const otherUserId = await testDb!.createUser();
    const grantKey = `grant-for-revoke:${randomUUID()}`;
    const grantAuth = await approved({
      requester, approver, action: "package.grant", objectType: "user", objectId: ownerId,
      payload: { userId: ownerId, units: 500, idempotencyKey: grantKey },
    });
    const granted = await new PostgresAdminRepository(testDb!.db).grantPackage({
      ...grantAuth, userId: ownerId, units: 500, idempotencyKey: grantKey,
    });
    expect(granted.allowed).toBe(true);
    const packageId = granted.allowed ? granted.packageId : "";
    const grant = await testDb!.db.execute<{ id: string }>(sql`
      select id from message_ledger_entries
      where package_id = ${packageId}::uuid and entry_kind = 'grant'
    `);
    const idempotencyKey = `revoke:${randomUUID()}`;
    const auth = await approved({
      requester, approver, action: "package.revoke", objectType: "user", objectId: ownerId,
      payload: { userId: ownerId, packageId, idempotencyKey },
    });
    const repository = new PostgresAdminRepository(testDb!.db);
    await expect(repository.revokePackage({ ...auth, userId: ownerId, packageId, idempotencyKey }))
      .resolves.toMatchObject({ allowed: true, delta: -500, originalEntryId: grant.rows[0]!.id });
    await expect(repository.revokePackage({ ...auth, userId: ownerId, packageId, idempotencyKey }))
      .resolves.toMatchObject({ allowed: true, replayed: true, delta: -500 });
    const conservation = await testDb!.db.execute(sql`select balance from package_balances where package_id = ${packageId}::uuid`);
    expect(conservation.rows[0]).toMatchObject({ balance: 0 });

    const crossKey = `cross:${randomUUID()}`;
    const crossAuth = await approved({
      requester, approver, action: "package.revoke", objectType: "user", objectId: otherUserId,
      payload: { userId: otherUserId, packageId, idempotencyKey: crossKey },
    });
    await expect(repository.revokePackage({ ...crossAuth, userId: otherUserId, packageId, idempotencyKey: crossKey }))
      .rejects.toThrow("Admin workflow target was not found");
    const cross = await testDb!.db.execute<{ ledger: string; consumed: string; denied: string }>(sql`
      select
        (select count(*)::text from message_ledger_entries where idempotency_key = ${crossKey}) as ledger,
        (select count(*)::text from admin_approvals where id = ${crossAuth.approvalId}::uuid and consumed_at is not null) as consumed,
        (select count(*)::text from audit_events where correlation_id = ${crossAuth.correlationId} and decision = 'denied') as denied
    `);
    expect(cross.rows[0]).toEqual({ ledger: "0", consumed: "0", denied: "1" });
  });

  it("rejects paid and intro package revocation with full rollback and denied audit", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const approver = await seedAdmin("entitlement_admin");
    const userId = await testDb!.createUser();
    const paidId = await testDb!.createLedgerPackage(userId, `paid:${randomUUID()}`, 500);
    await testDb!.db.execute(sql`
      insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
      values (${paidId}::uuid, 'grant', 500, ${`paid-ledger:${randomUUID()}`})
    `);
    const introKey = `intro-revoke:${randomUUID()}`;
    const introAuth = await approved({
      requester, approver, action: "package.intro_grant", objectType: "user", objectId: userId,
      payload: { userId, units: 100, idempotencyKey: introKey },
    });
    const intro = await new PostgresAdminRepository(testDb!.db).grantIntroPackage({
      ...introAuth, userId, units: 100, idempotencyKey: introKey,
    });
    expect(intro.allowed).toBe(true);
    const introId = intro.allowed ? intro.packageId : "";
    const repository = new PostgresAdminRepository(testDb!.db);

    for (const [kind, packageId] of [["paid", paidId], ["intro", introId]] as const) {
      const idempotencyKey = `reject-${kind}:${randomUUID()}`;
      const auth = await approved({
        requester, approver, action: "package.revoke", objectType: "user", objectId: userId,
        payload: { userId, packageId, idempotencyKey },
      });
      await expect(repository.revokePackage({ ...auth, userId, packageId, idempotencyKey }))
        .rejects.toThrow("Admin workflow target was not found");
      const effects = await testDb!.db.execute<{ ledger: string; consumed: string; denied: string; allowed: string }>(sql`
        select
          (select count(*)::text from message_ledger_entries where idempotency_key = ${idempotencyKey}) as ledger,
          (select count(*)::text from admin_approvals where id = ${auth.approvalId}::uuid and consumed_at is not null) as consumed,
          (select count(*)::text from audit_events where correlation_id = ${auth.correlationId} and decision = 'denied') as denied,
          (select count(*)::text from audit_events where correlation_id = ${auth.correlationId} and decision = 'allowed') as allowed
      `);
      expect(effects.rows[0]).toEqual({ ledger: "0", consumed: "0", denied: "1", allowed: "0" });
    }
  });

  it("executes exact client, expert, service, and integration-error mutations", async () => {
    const supportA = await seedAdmin("support");
    const supportB = await seedAdmin("support");
    const catalogA = await seedAdmin("catalog_admin");
    const catalogB = await seedAdmin("catalog_admin");
    const repository = new PostgresAdminRepository(testDb!.db);
    const clientId = randomUUID();
    const createAuth = await approved({ requester: supportA, approver: supportB, action: "client.create", objectType: "user", objectId: clientId, payload: { userId: clientId } });
    await expect(repository.createClient({ ...createAuth, userId: clientId })).resolves.toMatchObject({ allowed: true });
    const deactivateAuth = await approved({ requester: supportA, approver: supportB, action: "client.deactivate", objectType: "user", objectId: clientId, payload: { userId: clientId } });
    await repository.deactivateClient({ ...deactivateAuth, userId: clientId });

    const expertUser = await testDb!.createUser();
    const expert = await testDb!.db.execute<{ expertId: string }>(sql`
      insert into experts (user_id, active, verified) values (${expertUser}::uuid, true, false) returning id as "expertId"
    `);
    const service = await testDb!.db.execute<{ serviceId: string }>(sql`
      insert into expert_services (expert_id, name, active, duration_minutes)
      values (${expert.rows[0]!.expertId}::uuid, 'Admin test', false, 60) returning id as "serviceId"
    `);
    const verifyAuth = await approved({ requester: catalogA, approver: catalogB, action: "expert.verify", objectType: "expert", objectId: expert.rows[0]!.expertId, payload: { expertId: expert.rows[0]!.expertId, verified: true } });
    await repository.verifyExpert({ ...verifyAuth, expertId: expert.rows[0]!.expertId });
    const activateAuth = await approved({ requester: catalogA, approver: catalogB, action: "service.activate", objectType: "service", objectId: service.rows[0]!.serviceId, payload: { serviceId: service.rows[0]!.serviceId, active: true } });
    await repository.activateService({ ...activateAuth, serviceId: service.rows[0]!.serviceId });
    const suspendAuth = await approved({ requester: catalogA, approver: catalogB, action: "expert.suspend", objectType: "expert", objectId: expert.rows[0]!.expertId, payload: { expertId: expert.rows[0]!.expertId, verified: false } });
    await repository.suspendExpert({ ...suspendAuth, expertId: expert.rows[0]!.expertId });
    const deactivateServiceAuth = await approved({ requester: catalogA, approver: catalogB, action: "service.deactivate", objectType: "service", objectId: service.rows[0]!.serviceId, payload: { serviceId: service.rows[0]!.serviceId, active: false } });
    await repository.deactivateService({ ...deactivateServiceAuth, serviceId: service.rows[0]!.serviceId });

    const errorId = randomUUID();
    await testDb!.db.execute(sql`
      insert into integration_errors (id, provider, reason_code, metadata_hash)
      values (${errorId}::uuid, 'test', 'timeout', 'sha256:redacted')
    `);
    const errorAuth = await approved({ requester: supportA, approver: supportB, action: "integration_error.resolve", objectType: "integration_error", objectId: errorId, payload: { errorId } });
    await repository.resolveIntegrationError({ ...errorAuth, errorId });
    const state = await testDb!.db.execute(sql`
      select
        (select active from users where id = ${clientId}::uuid) as client_active,
        (select verified from experts where id = ${expert.rows[0]!.expertId}::uuid) as expert_verified,
        (select active from expert_services where id = ${service.rows[0]!.serviceId}::uuid) as service_active,
        (select status from integration_errors where id = ${errorId}::uuid) as error_status
    `);
    expect(state.rows[0]).toEqual({ client_active: false, expert_verified: false, service_active: false, error_status: "resolved" });
  });

  it("rolls approval, package, ledger, and allowed audit back together on an audit fault, then retries", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const approver = await seedAdmin("entitlement_admin");
    const userId = await testDb!.createUser();
    const idempotencyKey = `grant-fault:${randomUUID()}`;
    const auth = await approved({
      requester, approver, action: "package.grant", objectType: "user", objectId: userId,
      payload: { userId, units: 500, idempotencyKey },
    });
    const repository = new PostgresAdminRepository(testDb!.db);
    await testDb!.db.execute(sql`
      create function fail_admin_allowed_audit() returns trigger language plpgsql as $$
      begin raise exception 'forced admin audit failure'; end; $$
    `);
    await testDb!.db.execute(sql`
      create trigger fail_admin_allowed_audit before insert on audit_events
      for each row when (new.action = 'package.grant.allowed')
      execute function fail_admin_allowed_audit()
    `);
    try {
      await expect(repository.grantPackage({ ...auth, userId, units: 500, idempotencyKey })).rejects.toThrow();
    } finally {
      await testDb!.db.execute(sql`drop trigger if exists fail_admin_allowed_audit on audit_events`);
      await testDb!.db.execute(sql`drop function if exists fail_admin_allowed_audit()`);
    }
    const rolledBack = await testDb!.db.execute<{ packages: string; ledger: string; consumed: string; denied: string }>(sql`
      select
        (select count(*)::text from message_packages where grant_idempotency_key = ${idempotencyKey}) as packages,
        (select count(*)::text from message_ledger_entries where idempotency_key = ${`admin:${idempotencyKey}:grant`}) as ledger,
        (select count(*)::text from admin_approvals where id = ${auth.approvalId}::uuid and consumed_at is not null) as consumed,
        (select count(*)::text from audit_events where correlation_id = ${auth.correlationId} and decision = 'denied') as denied
    `);
    expect(rolledBack.rows[0]).toEqual({ packages: "0", ledger: "0", consumed: "0", denied: "1" });
    await expect(repository.grantPackage({ ...auth, userId, units: 500, idempotencyKey }))
      .resolves.toMatchObject({ allowed: true, replayed: false });
  });

  it("records a complete denied audit and no domain fact for a forged approval", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const userId = await testDb!.createUser();
    const idempotencyKey = `forged:${randomUUID()}`;
    const correlationId = `corr:${randomUUID()}`;
    await expect(new PostgresAdminRepository(testDb!.db).grantPackage({
      sessionIdHash: requester.sessionIdHash,
      approvalId: randomUUID(),
      nonce: `nonce:${randomUUID()}`,
      correlationId,
      userId,
      units: 500,
      idempotencyKey,
    })).resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });
    const denied = await testDb!.db.execute<{ packages: string; ledger: string; audit: string }>(sql`
      select
        (select count(*)::text from message_packages where grant_idempotency_key = ${idempotencyKey}) as packages,
        (select count(*)::text from message_ledger_entries where idempotency_key = ${`admin:${idempotencyKey}:grant`}) as ledger,
        (select count(*)::text from audit_events where correlation_id = ${correlationId}
          and actor_id = ${requester.adminId}::uuid
          and authenticated_session_id_hash = ${requester.sessionIdHash}
          and action = 'package.grant.denied' and object_type = 'user'
          and object_id = ${userId}::uuid and decision = 'denied'
          and reason_code = 'approval_denied' and metadata_hash <> '') as audit
    `);
    expect(denied.rows[0]).toEqual({ packages: "0", ledger: "0", audit: "1" });
  });

  it("enforces safety transition order, serializes concurrent transitions, and rolls state back with audit failure", async () => {
    const requester = await seedAdmin("security_admin");
    const approver = await seedAdmin("security_admin");
    const repository = new PostgresAdminRepository(testDb!.db);

    const openedId = await seedSafetyAlert("opened", requester.adminId);
    const openedAuth = await approved({
      requester, approver, action: "safety.resolve", objectType: "safety_case",
      objectId: openedId, payload: { alertId: openedId, resolution: "acknowledge" },
    });
    await expect(repository.acknowledgeSafetyAlert({ ...openedAuth, alertId: openedId }))
      .rejects.toThrow("Admin workflow state transition is not allowed");
    const opened = await testDb!.db.execute<{ status: string; version: number; consumed: string; denied: string }>(sql`
      select status, version,
        (select count(*)::text from admin_approvals where id = ${openedAuth.approvalId}::uuid and consumed_at is not null) as consumed,
        (select count(*)::text from audit_events where correlation_id = ${openedAuth.correlationId} and decision = 'denied') as denied
      from human_escalations where id = ${openedId}::uuid
    `);
    expect(opened.rows[0]).toEqual({ status: "opened", version: 1, consumed: "0", denied: "1" });

    const concurrentId = await seedSafetyAlert("assigned", requester.adminId);
    const first = await approved({
      requester, approver, action: "safety.resolve", objectType: "safety_case",
      objectId: concurrentId, payload: { alertId: concurrentId, resolution: "acknowledge" },
    });
    const second = await approved({
      requester, approver, action: "safety.resolve", objectType: "safety_case",
      objectId: concurrentId, payload: { alertId: concurrentId, resolution: "acknowledge" },
    });
    const concurrent = await Promise.allSettled([
      repository.acknowledgeSafetyAlert({ ...first, alertId: concurrentId }),
      repository.acknowledgeSafetyAlert({ ...second, alertId: concurrentId }),
    ]);
    expect(concurrent.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const concurrentState = await testDb!.db.execute<{ status: string; version: number; actions: string; consumed: string }>(sql`
      select status, version,
        (select count(*)::text from admin_case_actions where object_id = ${concurrentId}::uuid and action = 'acknowledge') as actions,
        (select count(*)::text from admin_approvals where id in (${first.approvalId}::uuid, ${second.approvalId}::uuid) and consumed_at is not null) as consumed
      from human_escalations where id = ${concurrentId}::uuid
    `);
    expect(concurrentState.rows[0]).toEqual({ status: "acknowledged", version: 2, actions: "1", consumed: "1" });

    const rollbackId = await seedSafetyAlert("assigned", requester.adminId);
    const rollbackAuth = await approved({
      requester, approver, action: "safety.resolve", objectType: "safety_case",
      objectId: rollbackId, payload: { alertId: rollbackId, resolution: "acknowledge" },
    });
    await testDb!.db.execute(sql`
      create function fail_safety_allowed_audit() returns trigger language plpgsql as $$
      begin raise exception 'forced safety audit failure'; end; $$
    `);
    await testDb!.db.execute(sql`
      create trigger fail_safety_allowed_audit before insert on audit_events
      for each row when (new.action = 'safety.resolve.allowed')
      execute function fail_safety_allowed_audit()
    `);
    try {
      await expect(repository.acknowledgeSafetyAlert({ ...rollbackAuth, alertId: rollbackId })).rejects.toThrow();
    } finally {
      await testDb!.db.execute(sql`drop trigger if exists fail_safety_allowed_audit on audit_events`);
      await testDb!.db.execute(sql`drop function if exists fail_safety_allowed_audit()`);
    }
    const rollback = await testDb!.db.execute<{ status: string; version: number; actions: string; consumed: string; denied: string }>(sql`
      select status, version,
        (select count(*)::text from admin_case_actions where object_id = ${rollbackId}::uuid) as actions,
        (select count(*)::text from admin_approvals where id = ${rollbackAuth.approvalId}::uuid and consumed_at is not null) as consumed,
        (select count(*)::text from audit_events where correlation_id = ${rollbackAuth.correlationId} and decision = 'denied') as denied
      from human_escalations where id = ${rollbackId}::uuid
    `);
    expect(rollback.rows[0]).toEqual({ status: "assigned", version: 1, actions: "0", consumed: "0", denied: "1" });
  });

  it("rejects direct handoff deletion, immutable rewrites, skipped transitions, and wrong versions", async () => {
    const security = await seedAdmin("security_admin");
    const alertId = await seedSafetyAlert("opened", security.adminId);

    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      delete from human_escalations where id = ${alertId}::uuid
    `), "55000", "human escalation deletion is forbidden");
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set acknowledgement_deadline = acknowledgement_deadline + interval '1 minute',
        status = 'assigned', version = version + 1, updated_at = clock_timestamp()
      where id = ${alertId}::uuid
    `), "55000", "human escalation immutable fields cannot change");
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'acknowledged', acknowledged_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
      where id = ${alertId}::uuid
    `), "23514", "human escalation status transition is not allowed");
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'assigned', version = version + 2, updated_at = clock_timestamp()
      where id = ${alertId}::uuid
    `), "40001", "human escalation version must increment by one");
  });

  it("rejects forged early-SLA, pre-transition, and future handoff timestamps", async () => {
    const security = await seedAdmin("security_admin");

    const earlySlaId = await seedSafetyAlert("assigned", security.adminId);
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'escalated', version = version + 1,
        updated_at = acknowledgement_deadline + interval '1 minute'
      where id = ${earlySlaId}::uuid
    `), "22007", "human escalation transition timestamp is in the future");

    const earlyAckId = await seedSafetyAlert("assigned", security.adminId);
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'acknowledged', acknowledged_at = updated_at - interval '1 second',
        version = version + 1, updated_at = clock_timestamp()
      where id = ${earlyAckId}::uuid
    `), "23514", "invalid assigned to acknowledged human escalation transition");

    const futureAssignmentId = await seedSafetyAlert("opened", security.adminId);
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'assigned', version = version + 1,
        updated_at = clock_timestamp() + interval '1 minute'
      where id = ${futureAssignmentId}::uuid
    `), "22007", "human escalation transition timestamp is in the future");

    const futureAckId = await seedSafetyAlert("assigned", security.adminId);
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'acknowledged', acknowledged_at = clock_timestamp() + interval '1 minute',
        version = version + 1, updated_at = clock_timestamp() + interval '1 minute'
      where id = ${futureAckId}::uuid
    `), "22007", "human escalation transition timestamp is in the future");

    const earlyResolveAfterAckId = await seedSafetyAlert("acknowledged", security.adminId);
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'resolved', resolved_at = acknowledged_at - interval '1 second',
        version = version + 1, updated_at = clock_timestamp()
      where id = ${earlyResolveAfterAckId}::uuid
    `), "23514", "invalid resolved human escalation transition");

    const earlyResolveAfterEscalationId = await seedSafetyAlert("escalated", security.adminId, true);
    await expectHandoffPostgresRejection(testDb!.db.execute(sql`
      update human_escalations
      set status = 'resolved', resolved_at = updated_at - interval '1 second',
        version = version + 1, updated_at = clock_timestamp()
      where id = ${earlyResolveAfterEscalationId}::uuid
    `), "23514", "invalid resolved human escalation transition");
  });

  it("allows only opened-assigned, assigned-acknowledged or SLA-escalated, and terminal resolution", async () => {
    const security = await seedAdmin("security_admin");
    const acknowledgedId = await seedSafetyAlert("opened", security.adminId);
    await testDb!.db.execute(sql`
      update human_escalations
      set status = 'assigned', version = version + 1, updated_at = clock_timestamp()
      where id = ${acknowledgedId}::uuid
    `);
    await testDb!.db.execute(sql`
      update human_escalations
      set status = 'acknowledged', acknowledged_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
      where id = ${acknowledgedId}::uuid
    `);
    await testDb!.db.execute(sql`
      update human_escalations
      set status = 'resolved', resolved_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
      where id = ${acknowledgedId}::uuid
    `);

    const escalatedId = await seedSafetyAlert("assigned", security.adminId, true);
    await testDb!.db.execute(sql`
      update human_escalations
      set status = 'escalated', version = version + 1, updated_at = clock_timestamp()
      where id = ${escalatedId}::uuid
    `);
    await testDb!.db.execute(sql`
      update human_escalations
      set status = 'resolved', resolved_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
      where id = ${escalatedId}::uuid
    `);

    const states = await testDb!.db.execute<{
      id: string;
      status: string;
      version: number;
      acknowledgedAtIsSet: boolean;
      resolvedAtIsSet: boolean;
    }>(sql`
      select id::text, status, version,
        acknowledged_at is not null as "acknowledgedAtIsSet",
        resolved_at is not null as "resolvedAtIsSet"
      from human_escalations
      where id in (${acknowledgedId}::uuid, ${escalatedId}::uuid)
      order by id
    `);
    expect(states.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: acknowledgedId,
        status: "resolved",
        version: 4,
        acknowledgedAtIsSet: true,
        resolvedAtIsSet: true,
      }),
      expect.objectContaining({
        id: escalatedId,
        status: "resolved",
        version: 3,
        acknowledgedAtIsSet: false,
        resolvedAtIsSet: true,
      }),
    ]));
  });

  it("records assigned safety and negative-feedback acknowledgement/resolution as immutable actions", async () => {
    const securityA = await seedAdmin("security_admin");
    const securityB = await seedAdmin("security_admin");
    const supportA = await seedAdmin("support");
    const supportB = await seedAdmin("support");
    const repository = new PostgresAdminRepository(testDb!.db);
    const incidentId = randomUUID();
    const safetyId = randomUUID();
    await testDb!.db.execute(sql`
      insert into safety_incidents (id, reason_code, metadata_hash)
      values (${incidentId}::uuid, 'safety_test', 'sha256:redacted')
    `);
    await testDb!.db.execute(sql`
      insert into human_escalations (
        id, incident_id, status, opened_at, acknowledgement_deadline, owner_id, escalation_reason
      ) values (
        ${safetyId}::uuid, ${incidentId}::uuid, 'assigned', clock_timestamp(),
        clock_timestamp() + interval '5 minutes', ${securityA.adminId}::uuid, 'safety_test'
      )
    `);
    await testDb!.db.execute(sql`
      insert into admin_object_assignments (admin_id, object_type, object_id)
      values (${securityA.adminId}::uuid, 'safety_case', ${safetyId}::uuid)
    `);
    for (const resolution of ["acknowledge", "resolve"] as const) {
      const auth = await approved({
        requester: securityA, approver: securityB, action: "safety.resolve",
        objectType: "safety_case", objectId: safetyId, payload: { alertId: safetyId, resolution },
      });
      const command = { ...auth, alertId: safetyId };
      if (resolution === "acknowledge") await repository.acknowledgeSafetyAlert(command);
      else await repository.resolveSafetyAlert(command);
    }

    const feedbackUser = await testDb!.createUser();
    const feedbackId = randomUUID();
    await testDb!.db.execute(sql`
      insert into feedback (
        id, user_id, rating, source_event_id, content_hash,
        negative_policy_version, escalation_status
      ) values (
        ${feedbackId}::uuid, ${feedbackUser}::uuid, 1, ${`case:${randomUUID()}`},
        'sha256:redacted', 'negative-v1', 'escalated'
      )
    `);
    await testDb!.db.execute(sql`
      insert into admin_object_assignments (admin_id, object_type, object_id)
      values (${supportA.adminId}::uuid, 'feedback_queue', ${feedbackId}::uuid)
    `);
    for (const resolution of ["acknowledge", "resolve"] as const) {
      const auth = await approved({
        requester: supportA, approver: supportB, action: "feedback.resolve",
        objectType: "feedback_queue", objectId: feedbackId, payload: { alertId: feedbackId, resolution },
      });
      const command = { ...auth, alertId: feedbackId };
      if (resolution === "acknowledge") await repository.acknowledgeNegativeFeedback(command);
      else await repository.resolveNegativeFeedback(command);
    }
    const actions = await testDb!.db.execute<{
      count: string;
      safetyStatus: string;
      safetyVersion: number;
      acknowledgedAtIsSet: boolean;
      resolvedAtIsSet: boolean;
      feedbackStatus: string;
    }>(sql`
      select
        (select count(*)::text from admin_case_actions
          where object_id in (${safetyId}::uuid, ${feedbackId}::uuid)) as count,
        (select status from human_escalations where id = ${safetyId}::uuid) as "safetyStatus",
        (select version from human_escalations where id = ${safetyId}::uuid) as "safetyVersion",
        (select acknowledged_at is not null from human_escalations where id = ${safetyId}::uuid) as "acknowledgedAtIsSet",
        (select resolved_at is not null from human_escalations where id = ${safetyId}::uuid) as "resolvedAtIsSet",
        (select escalation_status from feedback where id = ${feedbackId}::uuid) as "feedbackStatus"
    `);
    expect(actions.rows[0]).toMatchObject({
      count: "4",
      safetyStatus: "resolved",
      safetyVersion: 3,
      acknowledgedAtIsSet: true,
      resolvedAtIsSet: true,
      feedbackStatus: "resolved",
    });
    await expect(testDb!.db.execute(sql`delete from admin_case_actions where object_id = ${safetyId}::uuid`)).rejects.toThrow();
  });
});
