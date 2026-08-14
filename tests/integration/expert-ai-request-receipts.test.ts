import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb } from "../../packages/db/src/client.js";
import { PostgresExpertAiRequestReceiptStore } from "../../packages/db/src/repositories/expert-ai-request-receipt-repository.js";

const schema = "expert_ai_receipts_test";
const connectionString =
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("test_database_unavailable");
const isolatedUrl = new URL(connectionString);
isolatedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const db = createDb(isolatedUrl.toString());
const stores = [
  new PostgresExpertAiRequestReceiptStore(db),
  new PostgresExpertAiRequestReceiptStore(db),
];

const expertId = "00000000-0000-4000-8000-000000000101";
const digest = "a".repeat(64);

describe("Postgres expert AI request receipt store on shared Claw PostgreSQL", () => {
  beforeAll(async () => {
    await db.execute(
      sql.raw(
        `drop schema if exists ${schema} cascade; create schema ${schema}`,
      ),
    );
    const migration = await readFile(
      "packages/db/migrations/0027_expert_ai_request_receipts.sql",
      "utf8",
    );
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean))
      await db.execute(sql.raw(statement));
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists ${schema} cascade`));
    await closeDb(db);
  });
  beforeEach(async () => {
    await db.execute(sql`truncate expert_ai_request_receipts`);
  });

  it("atomically permits one worker and replays only the bounded outcome", async () => {
    const claims = await Promise.all(
      stores.map((store) =>
        store.claim({
          expertId,
          idempotencyKey: "assistant-concurrent-0001",
          requestDigest: digest,
        }),
      ),
    );
    expect(claims.filter(({ kind }) => kind === "claimed")).toHaveLength(1);
    expect(claims.filter(({ kind }) => kind === "busy")).toHaveLength(1);
    const acquired = claims.find(({ kind }) => kind === "claimed");
    if (acquired?.kind !== "claimed") throw new Error("claim missing");
    await stores[0]!.complete(acquired.claimId, {
      status: 200,
      body: { status: "completed", proposalKind: "view_referral_summary" },
    });
    await expect(
      stores[1]!.claim({
        expertId,
        idempotencyKey: "assistant-concurrent-0001",
        requestDigest: digest,
      }),
    ).resolves.toEqual({
      kind: "replay",
      outcome: {
        status: 200,
        body: {
          status: "completed",
          proposalKind: "view_referral_summary",
        },
      },
    });
    const row = (
      await db.execute<{ raw: string }>(
        sql`select row_to_json(r)::text as raw from expert_ai_request_receipts r where request_digest=${digest}`,
      )
    ).rows[0]!.raw;
    expect(row).not.toMatch(
      /assistant-concurrent|Покажи|00000000-0000-4000-8000-000000000101|payment|https?:/u,
    );
  });

  it("conflicts on digest reuse, fences stale leases, and reclaims failed work", async () => {
    const store = stores[0]!;
    const first = await store.claim({
      expertId,
      idempotencyKey: "assistant-fence-0001",
      requestDigest: digest,
    });
    if (first.kind !== "claimed") throw new Error("claim missing");
    expect(
      await store.claim({
        expertId,
        idempotencyKey: "assistant-fence-0001",
        requestDigest: "b".repeat(64),
      }),
    ).toEqual({ kind: "conflict" });
    await db.execute(
      sql`update expert_ai_request_receipts set lease_until=now()-interval '1 second' where request_digest=${digest} and status='processing'`,
    );
    const second = await store.claim({
      expertId,
      idempotencyKey: "assistant-fence-0001",
      requestDigest: digest,
    });
    if (second.kind !== "claimed") throw new Error("reclaim missing");
    await expect(
      store.complete(first.claimId, {
        status: 403,
        body: { error: "forbidden" },
      }),
    ).rejects.toThrow("expert_ai_receipt_claim_lost");
    await store.fail(second.claimId);
    expect(
      (
        await store.claim({
          expertId,
          idempotencyKey: "assistant-fence-0001",
          requestDigest: digest,
        })
      ).kind,
    ).toBe("claimed");
  });

  it("rejects any outcome detail outside the transport allowlist", async () => {
    const store = stores[0]!;
    const claim = await store.claim({
      expertId,
      idempotencyKey: "assistant-private-outcome-0001",
      requestDigest: digest,
    });
    if (claim.kind !== "claimed") throw new Error("claim missing");
    await expect(
      store.complete(claim.claimId, {
        status: 200,
        body: {
          status: "completed",
          proposalKind: "00000000-0000-4000-8000-000000000999",
        },
      }),
    ).rejects.toThrow("expert_ai_receipt_outcome_invalid");
    await expect(
      store.claim({
        expertId,
        idempotencyKey: "assistant-private-outcome-0001",
        requestDigest: digest,
      }),
    ).resolves.toEqual({ kind: "busy" });
  });

  it("deletes only bounded terminal expired receipts", async () => {
    const store = stores[0]!;
    const claim = await store.claim({
      expertId,
      idempotencyKey: "assistant-cleanup-0001",
      requestDigest: digest,
    });
    if (claim.kind !== "claimed") throw new Error("claim missing");
    await store.complete(claim.claimId, {
      status: 403,
      body: { error: "forbidden" },
    });
    await db.execute(
      sql`update expert_ai_request_receipts set expires_at=now()-interval '1 second' where status='complete'`,
    );
    expect(await store.cleanup(1)).toBe(1);
    await expect(store.cleanup(1001)).rejects.toThrow(
      "expert_ai_receipt_cleanup_invalid",
    );
  });
});
