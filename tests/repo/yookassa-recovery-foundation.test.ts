import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "packages/db/migrations/0024_yookassa_encrypted_recovery.sql";

describe("YooKassa encrypted recovery schema", () => {
  it("stores receipt contacts append-only and never defines plaintext contact columns", () => {
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8").toLowerCase();
    expect(sql).toContain("expert_receipt_contacts_append_only");
    expect(sql).toContain('"ciphertext" text not null');
    expect(sql).toContain('"key_reference" text not null');
    expect(sql).toContain('"consent_purpose" text not null');
    expect(sql).toContain('"policy_version" text not null');
    expect(sql).toContain('"verified_at" timestamp with time zone');
    expect(sql).toContain('"revoked_at" timestamp with time zone');
    expect(sql).not.toMatch(/"(email|phone|plaintext|contact_value)"\s+text/u);
  });

  it("adds versioned encrypted snapshots and bounded fenced recovery fields", () => {
    const sql = readFileSync(path, "utf8").toLowerCase();
    for (const column of [
      "replay_ciphertext",
      "replay_key_reference",
      "replay_body_version",
      "recovery_attempt",
      "recovery_next_at",
      "recovery_lease_token",
      "recovery_lease_until",
      "manual_review_at",
    ])
      expect(sql).toContain(`\"${column}\"`);
    expect(sql).toContain(
      "for each row execute function reject_append_only_mutation()",
    );
    expect(sql).toContain("expert_provider_operations_unbound_recovery_idx");
    expect(sql).toContain('"provider_object_id" is null');
    expect(sql).toContain("\"status\" = 'unknown_outcome'");
  });
});
