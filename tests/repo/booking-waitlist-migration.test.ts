import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("booking waitlist D1 migration", () => {
  it("defines FIFO waitlist, replay receipts, and immutable reschedule facts", () => {
    const migration = readFileSync(
      "packages/db/migrations/0053_booking_waitlist_d1.sql",
      "utf8",
    );
    for (const required of [
      "CREATE TABLE booking_waitlist_entries",
      "CREATE TABLE booking_waitlist_command_receipts",
      "CREATE TABLE booking_reschedule_facts",
      "booking_waitlist_one_active_client_slot",
      "booking_waitlist_fifo_claim_idx",
      "waiting",
      "promoted",
      "cancelled",
      "expired",
      "72 hours",
    ]) {
      expect(migration).toContain(required);
    }
    expect(migration).not.toContain("result_status");
  });

  it("adds immutable replay results in a forward migration", () => {
    const migration = readFileSync(
      "packages/db/migrations/0054_booking_reschedule_replay.sql",
      "utf8",
    );
    expect(migration).toContain("ADD COLUMN result_status");
    expect(migration).toContain("ADD COLUMN result_reserved_until");
    expect(migration).toContain("ADD COLUMN replay_recoverable");
    expect(migration).toContain("booking_reschedule_replay_result_check");
    expect(migration).not.toContain("UPDATE booking_reschedule_facts");
  });

  it("registers replay repair after waitlist migration", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-2)?.tag).toBe("0053_booking_waitlist_d1");
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 54,
      tag: "0054_booking_reschedule_replay",
    });
  });
});
