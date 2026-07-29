import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PostgresBookingRepository } from "../../packages/db/src/index.js";

describe("booking SQL mutation guards", () => {
  it("bounds slot observation freshness on both sides of the server clock", () => {
    const repository = readFileSync(
      "packages/db/src/repositories/booking-repository.ts",
      "utf8",
    );

    expect(repository).toContain(
      "and s.observed_at >= ${new Date(command.now.getTime() - SLOT_FRESHNESS_MS)}",
    );
    expect(repository).toContain("and s.observed_at <= ${command.now}");
  });

  it("rejects malformed callback UUIDs before touching PostgreSQL", async () => {
    const repository = new PostgresBookingRepository(
      {} as ConstructorParameters<typeof PostgresBookingRepository>[0],
    );

    await expect(
      repository.transitionFromTelegramCallback({
        tokenHash: "a".repeat(64),
        reservationId: "not-a-uuid",
        expertId: "also-not-a-uuid",
        action: "confirm",
        version: 1,
        now: new Date("2026-07-28T10:00:00.000Z"),
        correlationId: "invalid-callback-input",
      }),
    ).resolves.toBeNull();
  });
});
