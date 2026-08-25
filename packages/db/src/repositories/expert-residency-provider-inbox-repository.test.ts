import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { ExpertResidencyPaymentEvent } from "@ii-tonya/contracts";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

describe("expert residency provider inbox", () => {
  it("durably records a bounded verified failure without raw request data", async () => {
    const event: ExpertResidencyPaymentEvent = {
      kind: "settled",
      provider: "sandbox",
      eventId: "evt_missing_order",
      paymentId: "pay_missing_order",
      orderId: "00000000-0000-4000-8000-000000000699",
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${"f".repeat(64)}`,
    };
    const verified = verifiedEventFixture(event, {
      verificationId: "verify_missing_order",
      verifierKeyVersion: "sandbox-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
      payloadDigest: event.payloadDigest,
    });

    await expect(
      new PostgresExpertResidencyProviderInboxRepository(testDb.db).settle(
        verified as unknown as Parameters<
          PostgresExpertResidencyProviderInboxRepository["settle"]
        >[0],
      ),
    ).rejects.toThrow("order_not_found");

    const row = (
      await testDb.db.execute<{
        provider: string;
        externalEventId: string;
        verificationId: string;
        verifierKeyVersion: string;
        authenticated: boolean;
        status: string;
      }>(sql`select provider, external_event_id as "externalEventId",
        verification_id as "verificationId", verifier_key_version as "verifierKeyVersion",
        authenticated, processing_status as status
        from expert_residency_provider_event_inbox`)
    ).rows[0];
    expect(row).toEqual({
      provider: "sandbox",
      externalEventId: "evt_missing_order",
      verificationId: "verify_missing_order",
      verifierKeyVersion: "sandbox-v1",
      authenticated: true,
      status: "failed",
    });
    expect(JSON.stringify(row)).not.toContain("rawBody");
    expect(JSON.stringify(row)).not.toContain("headers");
  });
});
