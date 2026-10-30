import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";

type Candidate = { userId: string; sourceId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const signature = "public.early_bird_publication_worker(text,jsonb)";

/** Dedicated least-privilege worker principal. No direct table access. */
export class PostgresEarlyBirdPublicationWorker {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  private async invoke(operation: string, payload: unknown): Promise<unknown> {
    return this.db.transaction(
      async (tx) => {
        await tx.execute(sql`set local statement_timeout='5000ms'`);
        await tx.execute(sql`set local lock_timeout='1000ms'`);
        await requireDeferredPrincipal(
          tx,
          this.expectedLogin,
          "ii_tonya_wave_publication_worker",
          signature,
        );
        const response = await tx.execute<{ data: unknown }>(
          sql`select public.early_bird_publication_worker(${operation},${JSON.stringify(payload)}::jsonb) as data`,
        );
        if (response.rows.length !== 1)
          throw new Error("early_bird_publication_response_invalid");
        return response.rows[0]!.data;
      },
      { isolationLevel: "serializable" },
    );
  }
  async scan(limit: number, after: Candidate | null): Promise<Candidate[]> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (after && (!uuid.test(after.userId) || !uuid.test(after.sourceId)))
    )
      throw new Error("early_bird_publication_scan_invalid");
    const raw = await this.invoke("scan", {
      limit,
      afterUser: after?.userId ?? null,
      afterSource: after?.sourceId ?? null,
    });
    if (!Array.isArray(raw) || raw.length > limit)
      throw new Error("early_bird_publication_response_invalid");
    return raw.map((item: unknown) => {
      if (!item || typeof item !== "object")
        throw new Error("early_bird_publication_response_invalid");
      const row = item as Record<string, unknown>;
      if (
        typeof row.userId !== "string" ||
        typeof row.sourceId !== "string" ||
        !uuid.test(row.userId) ||
        !uuid.test(row.sourceId)
      )
        throw new Error("early_bird_publication_response_invalid");
      return { userId: row.userId, sourceId: row.sourceId };
    });
  }
  async activate(candidate: Candidate): Promise<void> {
    if (!uuid.test(candidate.userId) || !uuid.test(candidate.sourceId))
      throw new Error("early_bird_publication_candidate_invalid");
    if ((await this.invoke("activate", candidate)) !== true)
      throw new Error("early_bird_publication_response_invalid");
  }
}
