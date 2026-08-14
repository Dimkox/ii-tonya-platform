import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("YooKassa unbound recovery repository", () => {
  const source = readFileSync(
    "packages/db/src/repositories/yookassa-operation-repository.ts",
    "utf8",
  ).toLowerCase();

  it("persists only a protector-produced encrypted replay bundle", () => {
    expect(source).toContain("replaysnapshot.ciphertext");
    expect(source).toContain("replay_ciphertext");
    expect(source).toContain("replay_key_reference");
    expect(source).toContain("replay_body_version");
    expect(source).not.toMatch(/replay_(body|plaintext)\b/u);
  });

  it("claims a bounded fenced batch without history scans and expires to manual review", () => {
    expect(source).toContain("claimunboundrecoverybatch");
    expect(source).toContain("for update skip locked");
    expect(source).toContain("recovery_lease_token = gen_random_uuid()");
    expect(source).toContain("manual_review_at = transaction_timestamp()");
    expect(source).toContain("recovery_expires_at <= transaction_timestamp()");
    expect(source).not.toContain("offset ${");
  });
});
