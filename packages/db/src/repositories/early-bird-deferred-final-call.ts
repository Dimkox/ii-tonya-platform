import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
import type { QueueClaim, QueueResult } from "./early-bird-final-call-queue.js";

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const signature = "public.early_bird_final_call_worker(text,jsonb)";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export type FinalCallResume = Readonly<{
  chatId: string;
  subscriptionMinor: string;
  clientStartMs: number;
  callbackData: string;
}>;

/** A single protected SQL capability owns queue/source access. The worker login
 * has no table privileges, ownership or unrelated privileged functions. */
export class PostgresDeferredFinalCallCampaign {
  readonly queue: {
    claim: () => Promise<QueueClaim | null>;
    dispatch: (claim: QueueClaim) => Promise<boolean>;
  };
  constructor(
    private readonly db: DrizzleDb,
    private readonly target: {
      botKey: string;
      messagingPolicyVersion: string;
      expectedLogin: string;
    },
  ) {
    this.queue = {
      claim: () => this.claim(),
      dispatch: (claim) =>
        this.command("dispatch", claim).then((value) => value === true),
    };
  }
  private transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level read committed`);
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await requireDeferredPrincipal(
        tx,
        this.target.expectedLogin,
        "ii_tonya_wave_final_call_worker",
        signature,
      );
      return work(tx);
    });
  }
  private async invoke(
    tx: Transaction,
    operation: string,
    payload: unknown,
  ): Promise<unknown> {
    const result = await tx.execute<{ data: unknown }>(
      sql`select public.early_bird_final_call_worker(${operation},${JSON.stringify(payload)}::jsonb) as data`,
    );
    if (result.rows.length !== 1)
      throw new Error("early_bird_final_call_response_invalid");
    return result.rows[0]!.data;
  }
  private command(operation: string, payload: unknown) {
    return this.transaction((tx) => this.invoke(tx, operation, payload));
  }
  private limit(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 50)
      throw new Error("early_bird_notice_limit_invalid");
  }
  async enqueueDue(limit: number): Promise<number> {
    this.limit(limit);
    const raw = await this.command("scan", { limit });
    if (!Array.isArray(raw) || raw.length > limit)
      throw new Error("early_bird_final_call_response_invalid");
    let queued = 0;
    for (const value of raw) {
      if (
        !value ||
        typeof value !== "object" ||
        !uuid.test(value.userId) ||
        !uuid.test(value.configId) ||
        !["first", "repeat"].includes(value.kind) ||
        typeof value.scheduledAt !== "string" ||
        !Number.isFinite(Date.parse(value.scheduledAt))
      )
        throw new Error("early_bird_final_call_response_invalid");
      if ((await this.command("enqueue", value)) === true) queued++;
    }
    return queued;
  }
  async excludeUnpaid(limit: number): Promise<number> {
    this.limit(limit);
    const result = await this.command("exclude", { limit });
    if (
      !Number.isSafeInteger(result) ||
      Number(result) < 0 ||
      Number(result) > limit
    )
      throw new Error("early_bird_final_call_response_invalid");
    return Number(result);
  }
  private async claim(): Promise<QueueClaim | null> {
    const raw = await this.command("claim", { attemptId: randomUUID() });
    if (raw === null) return null;
    if (!raw || typeof raw !== "object")
      throw new Error("early_bird_final_call_response_invalid");
    const row = raw as Record<string, unknown>;
    if (
      typeof row.noticeId !== "string" ||
      !uuid.test(row.noticeId) ||
      typeof row.attemptId !== "string" ||
      !uuid.test(row.attemptId) ||
      typeof row.userId !== "string" ||
      !uuid.test(row.userId) ||
      (row.kind !== "first" && row.kind !== "repeat")
    )
      throw new Error("early_bird_final_call_response_invalid");
    return {
      noticeId: row.noticeId,
      attemptId: row.attemptId,
      userId: row.userId,
      kind: row.kind,
    };
  }
  finish(claim: QueueClaim, result: QueueResult): Promise<boolean> {
    return this.command("finish", {
      ...claim,
      result: result.kind,
      ...(result.kind === "delivered" ? { messageId: result.messageId } : {}),
    }).then((value) => value === true);
  }
  /** Queue dispatch commits before this function, so loss of send/commit outcome
   * can never return the notice to a sendable state. The SQL function takes and
   * holds the subject/config/source locks until this one callback completes. */
  async sendIfCurrent(
    claim: QueueClaim,
    send: (resume: FinalCallResume) => Promise<{ messageId: string }>,
  ): Promise<QueueResult> {
    return this.transaction(async (tx) => {
      const raw = await this.invoke(tx, "resume", {
        ...claim,
        botKey: this.target.botKey,
        messagingPolicyVersion: this.target.messagingPolicyVersion,
      });
      if (raw === null) return { kind: "cancelled" };
      if (!raw || typeof raw !== "object")
        throw new Error("early_bird_final_call_response_invalid");
      const row = raw as Record<string, unknown>;
      const ms = Number(row.clientStartMs);
      if (
        typeof row.chatId !== "string" ||
        !/^[1-9]\d{0,19}$/u.test(row.chatId) ||
        row.chatId === "0" ||
        typeof row.subscriptionMinor !== "string" ||
        !/^[1-9]\d{0,11}$/u.test(row.subscriptionMinor) ||
        BigInt(row.subscriptionMinor) <= 0n ||
        typeof row.baseId !== "string" ||
        !uuid.test(row.baseId) ||
        !Number.isSafeInteger(row.revision) ||
        Number(row.revision) < 0 ||
        Number(row.revision) > 999999 ||
        !Number.isSafeInteger(ms)
      )
        throw new Error("early_bird_final_call_response_invalid");
      const callbackData = `eb:${row.baseId}:${row.revision}:subscription`;
      if (Buffer.byteLength(callbackData) > 64)
        throw new Error("early_bird_final_call_response_invalid");
      try {
        const result = await send({
          chatId: row.chatId,
          subscriptionMinor: row.subscriptionMinor,
          clientStartMs: ms,
          callbackData,
        });
        return /^[1-9][0-9]{0,19}$/u.test(result.messageId)
          ? { kind: "delivered", messageId: result.messageId }
          : { kind: "uncertain" };
      } catch {
        return { kind: "uncertain" };
      }
    });
  }
}

/** API-primary-owner port, deliberately distinct from the worker capability.
 * The API must authenticate the Telegram transport and resolve its current
 * account/offer scope before calling this method. No worker-role grant exists.
 */
export class PostgresFinalCallEngagement {
  constructor(private readonly db: DrizzleDb) {}
  async recordEngagementForUser(userId: string): Promise<void> {
    if (!uuid.test(userId))
      throw new Error("early_bird_final_call_request_invalid");
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await tx.execute(
        sql`select public.early_bird_final_call_engage(${userId}::uuid)`,
      );
    });
  }
}
