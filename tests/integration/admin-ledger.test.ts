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

let testDb: TestDatabase | undefined;

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
    const packageId = await testDb!.createLedgerPackage(ownerId, `seed:${randomUUID()}`, 500);
    const grant = await testDb!.db.execute<{ id: string }>(sql`
      insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key)
      values (${packageId}::uuid, 'grant', 500, ${`seed-ledger:${randomUUID()}`}) returning id
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
      values (${incidentId}::uuid, 'safety_test', 'sha256:redacted');
      insert into human_escalations (
        id, incident_id, status, opened_at, acknowledgement_deadline, escalation_reason
      ) values (
        ${safetyId}::uuid, ${incidentId}::uuid, 'open', clock_timestamp(),
        clock_timestamp() + interval '5 minutes', 'safety_test'
      );
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
      );
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
    const actions = await testDb!.db.execute<{ count: string }>(sql`
      select count(*)::text as count from admin_case_actions
      where object_id in (${safetyId}::uuid, ${feedbackId}::uuid)
    `);
    expect(actions.rows).toEqual([{ count: "4" }]);
    await expect(testDb!.db.execute(sql`delete from admin_case_actions where object_id = ${safetyId}::uuid`)).rejects.toThrow();
  });
});
