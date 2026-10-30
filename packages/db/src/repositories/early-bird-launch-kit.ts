import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const signature = "public.early_bird_launch_kit_worker(text,jsonb)";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export type LaunchKitClaim = {
  jobId: string;
  userId: string;
  attemptId: string;
  contentVersion: string;
  payloadDigest: string;
};
export class PostgresEarlyBirdLaunchKit {
  constructor(
    private readonly db: DrizzleDb,
    private readonly config: {
      expectedLogin: string;
      botKey: string;
      messagingPolicyVersion: string;
      contentVersion: string;
      payloadDigest: string;
    },
  ) {}
  private transaction<T>(callback: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level read committed`);
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      await requireDeferredPrincipal(
        tx,
        this.config.expectedLogin,
        "ii_tonya_wave_launch_kit_worker",
        signature,
      );
      return callback(tx);
    });
  }
  private async invoke(
    tx: Transaction,
    operation: string,
    payload: unknown,
  ): Promise<unknown> {
    const rows = await tx.execute<{ data: unknown }>(
      sql`select public.early_bird_launch_kit_worker(${operation},${JSON.stringify(payload)}::jsonb) as data`,
    );
    if (rows.rows.length !== 1)
      throw new Error("early_bird_launch_kit_invalid");
    return rows.rows[0]!.data;
  }
  private command(operation: string, payload: unknown) {
    return this.transaction((tx) => this.invoke(tx, operation, payload));
  }
  private target() {
    return {
      botKey: this.config.botKey,
      messagingPolicyVersion: this.config.messagingPolicyVersion,
    };
  }
  async enqueue(limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_launch_kit_limit_invalid");
    const data = await this.command("enqueue", { limit, ...this.target() });
    if (!Number.isSafeInteger(data) || Number(data) < 0 || Number(data) > limit)
      throw new Error("early_bird_launch_kit_invalid");
    return Number(data);
  }
  async claim(): Promise<LaunchKitClaim | null> {
    const value = await this.command("claim", {
      attemptId: randomUUID(),
      ...this.target(),
    });
    if (value === null) return null;
    if (!value || typeof value !== "object")
      throw new Error("early_bird_launch_kit_invalid");
    const row = value as Record<string, unknown>;
    if (
      typeof row.jobId !== "string" ||
      !uuid.test(row.jobId) ||
      typeof row.userId !== "string" ||
      !uuid.test(row.userId) ||
      typeof row.attemptId !== "string" ||
      !uuid.test(row.attemptId) ||
      row.contentVersion !== this.config.contentVersion ||
      row.payloadDigest !== this.config.payloadDigest
    )
      throw new Error("early_bird_launch_kit_invalid");
    return {
      jobId: row.jobId,
      userId: row.userId,
      attemptId: row.attemptId,
      contentVersion: this.config.contentVersion,
      payloadDigest: this.config.payloadDigest,
    };
  }
  async sendIfCurrent(
    claim: LaunchKitClaim,
    send: (target: {
      chatId: string;
    }) => Promise<{ messageIds: readonly string[] }>,
  ): Promise<
    | { kind: "delivered"; messageIds: readonly string[] }
    | { kind: "cancelled" | "uncertain" }
  > {
    return this.transaction(async (tx) => {
      const value = await this.invoke(tx, "resume", {
        jobId: claim.jobId,
        userId: claim.userId,
        attemptId: claim.attemptId,
        ...this.target(),
      });
      if (value === null) return { kind: "cancelled" };
      if (!value || typeof value !== "object")
        throw new Error("early_bird_launch_kit_invalid");
      const row = value as Record<string, unknown>;
      if (
        typeof row.chatId !== "string" ||
        !/^[1-9][0-9]{0,19}$/u.test(row.chatId) ||
        row.contentVersion !== this.config.contentVersion ||
        row.payloadDigest !== this.config.payloadDigest
      )
        throw new Error("early_bird_launch_kit_invalid");
      try {
        const result = await send({ chatId: row.chatId });
        return result.messageIds.length === 2 &&
          new Set(result.messageIds).size === 2 &&
          result.messageIds.every((id) => /^[1-9][0-9]{0,19}$/u.test(id))
          ? { kind: "delivered", messageIds: result.messageIds }
          : { kind: "uncertain" };
      } catch {
        return { kind: "uncertain" };
      }
    });
  }
  async finish(
    claim: LaunchKitClaim,
    result:
      | { kind: "delivered"; messageIds: readonly string[] }
      | { kind: "cancelled" | "uncertain" },
  ): Promise<boolean> {
    return (
      (await this.command("finish", {
        jobId: claim.jobId,
        userId: claim.userId,
        attemptId: claim.attemptId,
        result: result.kind,
        ...(result.kind === "delivered"
          ? { messageIds: result.messageIds }
          : {}),
      })) === true
    );
  }
}
