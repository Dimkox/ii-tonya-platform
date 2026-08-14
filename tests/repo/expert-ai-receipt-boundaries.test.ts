import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "packages/db/migrations/0027_expert_ai_request_receipts.sql";
const repositoryPath =
  "packages/db/src/repositories/expert-ai-request-receipt-repository.ts";

describe("ER-AI-003 durable receipt boundary", () => {
  it("persists only server hashes, lease fencing, retention, and bounded outcomes", async () => {
    const migration = await readFile(migrationPath, "utf8");
    for (const required of [
      '"request_key_hash" char(64) PRIMARY KEY',
      '"request_digest" char(64)',
      '"claim_id" uuid',
      '"lease_until" timestamp with time zone',
      '"version" integer',
      '"outcome_status" integer',
      '"outcome_code" text',
      '"outcome_detail" text',
      '"expires_at" timestamp with time zone',
    ])
      expect(migration).toContain(required);
    expect(migration).not.toMatch(
      /"(?:expert_id|user_id|order_id|tariff_version_id|raw_text|prompt|context|proposal|referral_code|payment_url|model_output)"/u,
    );
    expect(migration).toContain(
      "'redeem_expert_referral','view_referral_summary','quote_residency','start_residency_checkout'",
    );
    expect(migration).toContain(
      "'invalid_shape','unsupported_intent','unauthorized_scope'",
    );
  });

  it("hashes the composite request identity before every SQL access", async () => {
    const repository = await readFile(repositoryPath, "utf8");
    expect(repository).toContain(
      'createHash("sha256").update(`${expertId}:${key}`, "utf8")',
    );
    expect(repository).not.toMatch(
      /(?:insert into|update|select)[\s\S]{0,180}\bexpert_id\b/iu,
    );
    expect(repository).toContain("expert_ai_receipt_claim_lost");
    expect(repository).toContain("for update skip locked");
  });
});
