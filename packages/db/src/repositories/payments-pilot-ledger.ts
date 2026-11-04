import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

/** SCRUM-518 pilot payment status as reported by YooKassa. */
export type PaymentsPilotStatus =
  "pending" | "waiting_for_capture" | "succeeded" | "canceled";

export interface PaymentsPilotRecord {
  readonly providerPaymentId: string;
  readonly principalId: string;
  readonly amountMinor: bigint;
  readonly status: PaymentsPilotStatus;
}

export interface PaymentsPilotLedger {
  recordCreated(input: {
    providerPaymentId: string;
    principalId: string;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<void>;
  recordStatus(input: {
    providerPaymentId: string;
    principalId: string;
    status: PaymentsPilotStatus;
  }): Promise<void>;
  find(providerPaymentId: string): Promise<PaymentsPilotRecord | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const STATUSES = new Set<string>([
  "pending",
  "waiting_for_capture",
  "succeeded",
  "canceled",
]);
const sha = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

/** Pilot-only append-only ledger in audit_events: no schema change, no PII.
 * YooKassa payment ids are UUID-shaped; anything else is refused. */
export class PostgresPaymentsPilotLedger implements PaymentsPilotLedger {
  constructor(private readonly db: DrizzleDb) {}

  async recordCreated(input: {
    providerPaymentId: string;
    principalId: string;
    amountMinor: bigint;
    idempotencyKey: string;
  }): Promise<void> {
    if (
      !UUID.test(input.providerPaymentId) ||
      !UUID.test(input.principalId) ||
      input.amountMinor <= 0n
    )
      throw new Error("payments_pilot_record_invalid");
    await this.db.execute(
      sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('payments_pilot',${input.principalId}::uuid,${sha("payments_pilot")},'PAYMENTS_PILOT_CREATED','payments_pilot_payment',${input.providerPaymentId}::uuid,'pending',${`amount_minor:${input.amountMinor}`},${`payments_pilot:${input.idempotencyKey}`},clock_timestamp(),${sha(`${input.providerPaymentId}:${input.amountMinor}`)})`,
    );
  }

  async recordStatus(input: {
    providerPaymentId: string;
    principalId: string;
    status: PaymentsPilotStatus;
  }): Promise<void> {
    if (
      !UUID.test(input.providerPaymentId) ||
      !UUID.test(input.principalId) ||
      !STATUSES.has(input.status)
    )
      throw new Error("payments_pilot_record_invalid");
    const current = await this.find(input.providerPaymentId);
    if (current === null) throw new Error("payments_pilot_payment_unknown");
    if (current.principalId !== input.principalId)
      throw new Error("payments_pilot_principal_mismatch");
    if (current.status === input.status) return;
    await this.db.execute(
      sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('payments_pilot',${input.principalId}::uuid,${sha("payments_pilot")},'PAYMENTS_PILOT_STATUS','payments_pilot_payment',${input.providerPaymentId}::uuid,${input.status},'provider_verified',${`payments_pilot_status:${input.providerPaymentId}`},clock_timestamp(),${sha(`${input.providerPaymentId}:${input.status}`)})`,
    );
  }

  async find(providerPaymentId: string): Promise<PaymentsPilotRecord | null> {
    if (!UUID.test(providerPaymentId)) return null;
    const result = await this.db.execute(
      sql`select actor_id::text as principal_id, action, decision, reason_code from audit_events where object_type='payments_pilot_payment' and object_id=${providerPaymentId}::uuid order by occurred_at desc, created_at desc`,
    );
    const rows = result.rows as {
      principal_id: string;
      action: string;
      decision: string;
      reason_code: string;
    }[];
    const created = rows.find((row) => row.action === "PAYMENTS_PILOT_CREATED");
    if (!created) return null;
    const amount = /^amount_minor:([1-9]\d{0,9})$/u.exec(created.reason_code);
    const status = rows[0]!.decision;
    if (!amount || !STATUSES.has(status))
      throw new Error("payments_pilot_record_invalid");
    return {
      providerPaymentId,
      principalId: created.principal_id,
      amountMinor: BigInt(amount[1]!),
      status: status as PaymentsPilotStatus,
    };
  }
}
