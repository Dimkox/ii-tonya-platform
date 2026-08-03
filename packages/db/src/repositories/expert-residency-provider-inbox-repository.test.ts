import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
describe("expert residency provider inbox", () => {
  it("rejects values not authenticated by the verifier boundary", async () => {
    const db = { transaction: vi.fn() };
    const repo = new PostgresExpertResidencyProviderInboxRepository(
      db as never,
    );
    await expect(repo.settle({ kind: "settled" } as never)).rejects.toThrow(
      "verified_event_required",
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("shares the canonical verifier identity through the Vitest source alias", async () => {
    const db = {
      transaction: vi.fn(async () => {
        throw new Error("canonical_identity_reached");
      }),
    };
    const repo = new PostgresExpertResidencyProviderInboxRepository(
      db as never,
    );
    const event = verifiedEventFixture(
      expertResidencyPaymentEventSchema.parse({
        kind: "settled",
        provider: "sandbox",
        eventId: "evt_identity_0001",
        paymentId: "pay_identity_0001",
        orderId: "00000000-0000-4000-8000-000000000001",
        amountMinor: "50000",
        currency: "RUB",
        occurredAt: "2026-08-03T00:00:00.000Z",
        payloadDigest: `sha256:${"a".repeat(64)}`,
      }),
      {
        verificationId: "verify_identity_0001",
        verifierKeyVersion: "sandbox-v1",
        verifiedAt: "2026-08-03T00:00:01.000Z",
      },
    );
    await expect(
      repo.settle(
        event as unknown as Parameters<
          PostgresExpertResidencyProviderInboxRepository["settle"]
        >[0],
      ),
    ).rejects.toThrow("canonical_identity_reached");
    expect(db.transaction).toHaveBeenCalledOnce();
  });
  it("pins append-only reservation commit, debt-first reward, eligibility evidence, and distinct outbox hashing", () => {
    const source = readFileSync(
      new URL(
        "./expert-residency-provider-inbox-repository.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("'release'");
    expect(source).toContain("'spend'");
    expect(source).toContain("'debt_repayment'");
    expect(source).toContain("from expert_referral_balances");
    expect(source).not.toContain("expert_referral_credit_balances");
    expect(source).toContain("repayment-reversal:");
    expect(source).toContain("result_payload");
    expect(source).not.toMatch(/min\s*\(\s*ci\.id\s*\)/iu);
    expect(source).toMatch(
      /channel_identities[\s\S]{0,180}order by ci\.id limit 1/iu,
    );
    const migration = readFileSync(
      new URL(
        "../../migrations/0021_expert_settlement_snapshot.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).not.toMatch(/min\s*\(\s*ci\.id\s*\)/iu);
    expect(migration.match(/ORDER BY ci\.id LIMIT 1/gu)).toHaveLength(2);
    expect(migration).toContain("expert_provider_reversal_result_immutable");
    expect(source).toContain("expert.rows[0].active");
    expect(source).toContain("settlement_abuse_cleared");
    expect(source).toMatch(
      /createHash\("sha256"\)[\s\S]{0,80}\.update\(outboxPayload\)/u,
    );
    expect(source).not.toContain("${digest}) on conflict (idempotency_key)");
  });
});
