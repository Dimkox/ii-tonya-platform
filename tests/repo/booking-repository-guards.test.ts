import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PostgresBookingRepository } from "../../packages/db/src/index.js";
import type { BookingWorkflowRepository } from "../../packages/application/src/booking-service.js";

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

  it("implements the production booking workflow port structurally", () => {
    const repository: BookingWorkflowRepository = new PostgresBookingRepository(
      {} as ConstructorParameters<typeof PostgresBookingRepository>[0],
    );

    expect(repository).toBeInstanceOf(PostgresBookingRepository);
  });

  it("gates the expert preparation note on note AND handoff consent in both read paths", () => {
    const booking = readFileSync(
      "packages/db/src/repositories/booking-repository.ts",
      "utf8",
    );
    const telegramQueries = readFileSync(
      "packages/db/src/repositories/expert-telegram-query-repository.ts",
      "utf8",
    );
    const predicate =
      "when note_consent.granted and handoff_consent.granted then cp.expert_note";

    expect(booking).toContain(predicate);
    expect(telegramQueries).toContain(predicate);
    // Контроль, который обязан перевернуться: асимметрия «note_consent alone»
    // возвращает plaintext заметки в слой приложения при denied handoff.
    expect(booking).not.toMatch(
      /when note_consent\.granted then cp\.expert_note/,
    );
    expect(telegramQueries).not.toMatch(
      /when note_consent\.granted then cp\.expert_note/,
    );
  });

  it("withholds the expert meeting URL until 30 minutes before the start (DEC-PLT-004 §4)", () => {
    const source = readFileSync(
      "packages/db/src/repositories/booking-repository.ts",
      "utf8",
    );

    expect(source).toContain(
      "const MEETING_URL_DISCLOSURE_LEAD_MS = 30 * 60 * 1_000;",
    );
    expect(source).toContain(
      "and s.starts_at - ${MEETING_URL_DISCLOSURE_LEAD_MS} * interval '1 millisecond' <= clock_timestamp()",
    );
  });

  it("does not expose split Telegram authorization and schedule reads", () => {
    const source = readFileSync(
      "packages/db/src/repositories/booking-repository.ts",
      "utf8",
    );

    expect(source).not.toContain("expertForTelegramIdentity(");
    expect(source).not.toContain("listExpertSchedule(");
  });
});
