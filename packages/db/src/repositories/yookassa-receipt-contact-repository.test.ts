import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PostgresYooKassaReceiptContactAuthority } from "./yookassa-receipt-contact-repository.js";

describe("Postgres YooKassa receipt contact authority", () => {
  it("uses order -> expert -> user and returns the latest exact purpose/policy row", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const authority = new PostgresYooKassaReceiptContactAuthority({
      execute,
    } as never);
    await expect(
      authority.latestForOrder(
        "11111111-1111-4111-8111-111111111111",
        "fiscal_receipt",
        "policy-v1",
      ),
    ).resolves.toBeNull();
    expect(execute).toHaveBeenCalledOnce();
    const query = readFileSync(
      "packages/db/src/repositories/yookassa-receipt-contact-repository.ts",
      "utf8",
    ).toLowerCase();
    expect(query).toContain("expert_residency_orders");
    expect(query).toContain("join experts");
    expect(query).toContain("expert_residency_receipt_contacts");
    expect(query).toContain(
      "join consents consent on consent.id = contact.consent_id",
    );
    expect(query).toContain("consent.user_id = contact.user_id");
    expect(query).toContain("consent.decision = contact.consent_decision");
    expect(query).toContain("consent.consent_type = contact.consent_purpose");
    expect(query).toContain("consent.policy_version = contact.policy_version");
    expect(query).toContain("consent_purpose");
    expect(query).toContain("policy_version");
    expect(query).toContain("order by");
    expect(query).toContain("limit 1");
  });
});
