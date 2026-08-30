import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export type TrialOutcomeKind = "unknown" | "applied" | "not_applied";
export type TrialRedemption = {
  id: string;
  campaignVersionId: string;
  userId: string;
};
export type TrialReservation = {
  reservationId: string;
  redemptionId: string;
  requestKey: string;
  units: 2;
  status: "reserved" | "unknown" | "applied" | "not_applied";
};
export type TrialSummary = {
  grantedUnits: 100;
  consumedUnits: number;
  reservedUnits: number;
};

export interface TestExpertTrialRepository {
  createOrGetRedemption(input: {
    campaignVersionId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<TrialRedemption>;
  reserveAiTurn(input: {
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
  }): Promise<TrialReservation>;
  recordOutcome(input: {
    reservationId: string;
    outcome: TrialOutcomeKind;
  }): Promise<TrialSummary>;
  reconcileUnknown(input: {
    reservationId: string;
    outcome: "applied" | "not_applied";
  }): Promise<TrialSummary>;
  summary(redemptionId: string): Promise<TrialSummary>;
}

export class TrialCapReachedError extends Error {
  constructor() {
    super("trial_cap_reached");
  }
}
export class TrialIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class TrialOutcomeConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type MemRedemption = TrialRedemption & {
  key: string;
  consumed: number;
  reserved: number;
};
type MemReservation = TrialReservation & { digest: string };

export class MemoryTestExpertTrialRepository implements TestExpertTrialRepository {
  private readonly redemptions = new Map<string, MemRedemption>();
  private readonly reservations = new Map<string, MemReservation>();
  private readonly locks = new Map<string, Promise<void>>();

  async createOrGetRedemption(input: {
    campaignVersionId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<TrialRedemption> {
    const previous = [...this.redemptions.values()].find(
      (row) => row.key === input.idempotencyKey,
    );
    if (previous) {
      if (
        previous.campaignVersionId !== input.campaignVersionId ||
        previous.userId !== input.userId
      )
        throw new TrialIdempotencyConflictError(
          "redemption_idempotency_conflict",
        );
      return previous;
    }
    const row: MemRedemption = {
      id: randomUUID(),
      campaignVersionId: input.campaignVersionId,
      userId: input.userId,
      key: input.idempotencyKey,
      consumed: 0,
      reserved: 0,
    };
    this.redemptions.set(row.id, row);
    return row;
  }

  private async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      id,
      prior.then(() => current),
    );
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }

  async reserveAiTurn(input: {
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
  }): Promise<TrialReservation> {
    const redemption = this.redemptions.get(input.redemptionId);
    if (!redemption) throw new Error("redemption_not_found");
    return this.locked(input.redemptionId, async () => {
      const existing = [...this.reservations.values()].find(
        (row) =>
          row.redemptionId === input.redemptionId &&
          row.requestKey === input.requestKey,
      );
      if (existing) {
        if (existing.digest !== input.requestDigest)
          throw new TrialIdempotencyConflictError(
            "request_idempotency_conflict",
          );
        return existing;
      }
      if (redemption.consumed + redemption.reserved + 2 > 100)
        throw new TrialCapReachedError();
      const row: MemReservation = {
        reservationId: randomUUID(),
        redemptionId: input.redemptionId,
        requestKey: input.requestKey,
        units: 2,
        status: "reserved",
        digest: input.requestDigest,
      };
      this.reservations.set(row.reservationId, row);
      redemption.reserved += 2;
      return row;
    });
  }

  async recordOutcome(input: {
    reservationId: string;
    outcome: TrialOutcomeKind;
  }): Promise<TrialSummary> {
    const reservation = this.reservations.get(input.reservationId);
    if (!reservation) throw new Error("reservation_not_found");
    return this.locked(reservation.redemptionId, async () => {
      const redemption = this.redemptions.get(reservation.redemptionId)!;
      if (
        reservation.status === input.outcome ||
        (reservation.status === "unknown" && input.outcome === "unknown")
      )
        return this.toSummary(redemption);
      if (reservation.status !== "reserved")
        throw new TrialOutcomeConflictError(
          reservation.status === "unknown"
            ? "unknown_outcome_requires_reconciliation"
            : "outcome_conflict",
        );
      if (input.outcome === "unknown") {
        reservation.status = "unknown";
        return this.toSummary(redemption);
      }
      redemption.reserved -= 2;
      if (input.outcome === "applied") redemption.consumed += 2;
      reservation.status = input.outcome;
      return this.toSummary(redemption);
    });
  }

  async reconcileUnknown(input: {
    reservationId: string;
    outcome: "applied" | "not_applied";
  }): Promise<TrialSummary> {
    const reservation = this.reservations.get(input.reservationId);
    if (!reservation) throw new Error("reservation_not_found");
    return this.locked(reservation.redemptionId, async () => {
      const redemption = this.redemptions.get(reservation.redemptionId)!;
      if (reservation.status === input.outcome)
        return this.toSummary(redemption);
      if (reservation.status !== "unknown")
        throw new TrialOutcomeConflictError("reconciliation_requires_unknown");
      redemption.reserved -= 2;
      if (input.outcome === "applied") redemption.consumed += 2;
      reservation.status = input.outcome;
      return this.toSummary(redemption);
    });
  }

  async summary(redemptionId: string): Promise<TrialSummary> {
    const row = this.redemptions.get(redemptionId);
    if (!row) throw new Error("redemption_not_found");
    return this.toSummary(row);
  }
  private toSummary(row: MemRedemption): TrialSummary {
    return {
      grantedUnits: 100,
      consumedUnits: row.consumed,
      reservedUnits: row.reserved,
    };
  }
}

export class PostgresTestExpertTrialRepository implements TestExpertTrialRepository {
  constructor(private readonly db: DrizzleDb) {}
  async createOrGetRedemption(input: {
    campaignVersionId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<TrialRedemption> {
    const rows = await this.db.execute<{
      id: string;
      campaignVersionId: string;
      userId: string;
      key: string;
    }>(sql`
      insert into test_expert_redemptions (campaign_version_id,user_id,redemption_idempotency_key)
      values (${input.campaignVersionId}::uuid,${input.userId}::uuid,${input.idempotencyKey})
      on conflict (redemption_idempotency_key) do update set redemption_idempotency_key=excluded.redemption_idempotency_key
      returning id, campaign_version_id as "campaignVersionId", user_id as "userId", redemption_idempotency_key as key`);
    const row = rows.rows[0];
    if (!row) throw new Error("redemption_create_failed");
    if (
      row.campaignVersionId !== input.campaignVersionId ||
      row.userId !== input.userId
    )
      throw new TrialIdempotencyConflictError(
        "redemption_idempotency_conflict",
      );
    return row;
  }
  async reserveAiTurn(input: {
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
  }): Promise<TrialReservation> {
    return this.db.transaction(async (tx) => {
      const prior = await tx.execute<{
        reservationId: string;
        redemptionId: string;
        requestKey: string;
        requestDigest: string;
        units: number;
        status: TrialReservation["status"];
      }>(
        sql`select id as "reservationId", redemption_id as "redemptionId", request_key as "requestKey", request_digest as "requestDigest", units, status from test_expert_reservations where redemption_id=${input.redemptionId}::uuid and request_key=${input.requestKey} for update`,
      );
      if (prior.rows[0]) {
        if (prior.rows[0].requestDigest !== input.requestDigest)
          throw new TrialIdempotencyConflictError(
            "request_idempotency_conflict",
          );
        return { ...prior.rows[0], units: 2 as const };
      }
      const balance = await tx.execute<{ consumed: number; reserved: number }>(
        sql`select consumed_units as consumed, reserved_units as reserved from test_expert_redemptions where id=${input.redemptionId}::uuid for update`,
      );
      const row = balance.rows[0];
      if (!row) throw new Error("redemption_not_found");
      if (Number(row.consumed) + Number(row.reserved) + 2 > 100)
        throw new TrialCapReachedError();
      const inserted = await tx.execute<{ reservationId: string }>(
        sql`insert into test_expert_reservations (redemption_id,request_key,request_digest,units) values (${input.redemptionId}::uuid,${input.requestKey},${input.requestDigest},2) returning id as "reservationId"`,
      );
      await tx.execute(
        sql`update test_expert_redemptions set reserved_units=reserved_units+2 where id=${input.redemptionId}::uuid`,
      );
      return {
        reservationId: inserted.rows[0]!.reservationId,
        redemptionId: input.redemptionId,
        requestKey: input.requestKey,
        units: 2,
        status: "reserved",
      };
    });
  }
  async recordOutcome(input: {
    reservationId: string;
    outcome: TrialOutcomeKind;
  }): Promise<TrialSummary> {
    return this.transition(input.reservationId, input.outcome, false);
  }
  async reconcileUnknown(input: {
    reservationId: string;
    outcome: "applied" | "not_applied";
  }): Promise<TrialSummary> {
    return this.transition(input.reservationId, input.outcome, true);
  }
  private async transition(
    id: string,
    outcome: TrialOutcomeKind,
    reconcile: boolean,
  ): Promise<TrialSummary> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        redemptionId: string;
        status: TrialReservation["status"];
      }>(
        sql`select redemption_id as "redemptionId", status from test_expert_reservations where id=${id}::uuid for update`,
      );
      const row = rows.rows[0];
      if (!row) throw new Error("reservation_not_found");
      if (row.status === outcome) return this.summaryTx(tx, row.redemptionId);
      if (
        (row.status === "unknown" && !reconcile) ||
        (reconcile && row.status !== "unknown") ||
        (row.status !== "reserved" && !reconcile)
      )
        throw new TrialOutcomeConflictError(
          row.status === "unknown"
            ? "unknown_outcome_requires_reconciliation"
            : "outcome_conflict",
        );
      await tx.execute(
        sql`insert into test_expert_outcomes (reservation_id,outcome) values (${id}::uuid,${outcome}) on conflict (reservation_id,outcome) do nothing`,
      );
      if (outcome === "unknown")
        await tx.execute(
          sql`update test_expert_reservations set status='unknown' where id=${id}::uuid`,
        );
      else {
        await tx.execute(
          sql`update test_expert_reservations set status=${outcome} where id=${id}::uuid`,
        );
        await tx.execute(
          sql`update test_expert_redemptions set reserved_units=reserved_units-2, consumed_units=consumed_units+case when ${outcome}='applied' then 2 else 0 end where id=${row.redemptionId}::uuid`,
        );
      }
      return this.summaryTx(tx, row.redemptionId);
    });
  }
  private async summaryTx(
    tx: Parameters<DrizzleDb["transaction"]>[0] extends (tx: infer T) => unknown
      ? T
      : never,
    id: string,
  ): Promise<TrialSummary> {
    const rows = await tx.execute<{
      granted: number;
      consumed: number;
      reserved: number;
    }>(
      sql`select granted_units as granted, consumed_units as consumed, reserved_units as reserved from test_expert_redemptions where id=${id}::uuid`,
    );
    const row = rows.rows[0];
    if (!row) throw new Error("redemption_not_found");
    return {
      grantedUnits: 100,
      consumedUnits: Number(row.consumed),
      reservedUnits: Number(row.reserved),
    };
  }
  async summary(id: string): Promise<TrialSummary> {
    const rows = await this.db.execute<{ consumed: number; reserved: number }>(
      sql`select consumed_units as consumed, reserved_units as reserved from test_expert_redemptions where id=${id}::uuid`,
    );
    const row = rows.rows[0];
    if (!row) throw new Error("redemption_not_found");
    return {
      grantedUnits: 100,
      consumedUnits: Number(row.consumed),
      reservedUnits: Number(row.reserved),
    };
  }
}
