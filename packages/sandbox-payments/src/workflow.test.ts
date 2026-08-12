import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  migrateDb,
  PostgresAdminApprovalRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import { startExternalPostgresDatabase } from "../../db/src/testkit/external-postgres.js";
import {
  migrateSandboxDatabase,
  PostgresSandboxPaymentRepository,
} from "./repository.js";
import { SandboxTransitionWorkflow, sandboxApprovalObjectId } from "./workflow.js";

const checkoutBaseUrl = new URL("https://sandbox.ii-tonya.invalid/");
let database: Awaited<ReturnType<typeof startExternalPostgresDatabase>> | undefined;
let db: DrizzleDb | undefined;
let payments: PostgresSandboxPaymentRepository;
let approvals: PostgresAdminApprovalRepository;
let workflow: SandboxTransitionWorkflow;

beforeAll(async () => {
  const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  if (!adminUrl) throw new Error("II_TONYA_TEST_POSTGRES_ADMIN_URL is required by Claw");
  database = await startExternalPostgresDatabase(adminUrl);
  db = createDb(database.getConnectionUri());
}, 120_000);

beforeEach(async () => {
  await db!.execute(sql`drop schema public cascade`);
  await db!.execute(sql`create schema public`);
  await migrateDb(db!, "packages/db/migrations");
  await migrateSandboxDatabase(db!);
  payments = new PostgresSandboxPaymentRepository(db!, checkoutBaseUrl);
  approvals = new PostgresAdminApprovalRepository(db!);
  workflow = new SandboxTransitionWorkflow(db!, approvals, payments);
});

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.stop();
}, 60_000);

async function admin(role: "entitlement_admin" = "entitlement_admin") {
  const user = await db!.execute<{ id: string }>(sql`insert into users default values returning id`);
  const id = user.rows[0]!.id;
  const sessionIdHash = `session-${randomUUID()}`;
  await db!.execute(sql`insert into admin_role_assignments (admin_id, role) values (${id}::uuid, ${role})`);
  await db!.execute(sql`insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at) values (${sessionIdHash}, ${id}::uuid, transaction_timestamp(), transaction_timestamp() + interval '1 hour')`);
  return { id, sessionIdHash };
}

async function approvedCommand(overrides: Record<string, unknown> = {}) {
  const checkout = await payments.createCheckout({ orderId: randomUUID(), amountMinor: "100000", currency: "RUB", idempotencyKey: `checkout:${randomUUID()}` });
  const requester = await admin();
  const approver = await admin();
  const command = {
    action: "expert_residency.sandbox_settle" as const,
    paymentId: checkout.paymentId,
    approvalId: "",
    nonce: randomUUID(),
    sessionIdHash: requester.sessionIdHash,
    expectedVersion: 0,
    idempotencyKey: `transition:${randomUUID()}`,
    correlationId: randomUUID(),
    ...overrides,
  };
  const payload = { paymentId: command.paymentId, transition: "settled", expectedVersion: command.expectedVersion, idempotencyKey: command.idempotencyKey };
  const requested = await approvals.requestApproval({ sessionIdHash: requester.sessionIdHash, action: command.action, objectType: "sandbox_expert_residency_payment", objectId: sandboxApprovalObjectId(command.paymentId), payload, nonce: command.nonce });
  expect(requested).not.toBeNull();
  command.approvalId = requested!.approvalId;
  expect(await approvals.approveApproval({ approvalId: command.approvalId, sessionIdHash: approver.sessionIdHash })).toBe(true);
  return { command, requester, approver };
}

describe("SandboxTransitionWorkflow", () => {
  it("settles only with an exactly bound approval and replays the committed event", async () => {
    const { command } = await approvedCommand();
    const first = await workflow.execute(command);
    expect(first).toMatchObject({ allowed: true, replayed: false, event: { kind: "settled", version: 1 } });
    await expect(workflow.execute(command)).resolves.toEqual({ ...(first as { allowed: true; event: unknown }), replayed: true });
  });

  it.each([
    ["paymentId", "sandbox_payment_wrong"],
    ["expectedVersion", 99],
    ["idempotencyKey", "transition:wrong"],
    ["sessionIdHash", "session-wrong"],
    ["action", "expert_residency.sandbox_refund"],
  ])("denies a mismatched %s without consuming the approval", async (field, value) => {
    const { command } = await approvedCommand();
    await expect(workflow.execute({ ...command, [field]: value } as typeof command)).resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });
    const row = await db!.execute<{ consumed: boolean }>(sql`select consumed_at is not null as consumed from admin_approvals where id=${command.approvalId}::uuid`);
    expect(row.rows[0]?.consumed).toBe(false);
  });

  it("allows only one concurrent consumption and transition", async () => {
    const { command } = await approvedCommand();
    const results = await Promise.all([workflow.execute(command), workflow.execute(command)]);
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.filter((result) => result.allowed && !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.allowed && result.replayed)).toHaveLength(1);
    const rows = await db!.execute<{ events: number; audits: number }>(sql`select (select count(*)::int from sandbox_expert_residency_events) as events, (select count(*)::int from audit_events where action='expert_residency.sandbox_settle') as audits`);
    expect(rows.rows[0]).toEqual({ events: 1, audits: 1 });
  });
});
