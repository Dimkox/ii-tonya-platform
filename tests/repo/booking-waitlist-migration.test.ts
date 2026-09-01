import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("booking waitlist D1 migration", () => {
  it("defines FIFO waitlist, replay receipts, and immutable reschedule facts", () => {
    const migration = readFileSync(
      "packages/db/migrations/0040_booking_waitlist_d1.sql",
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
  });

  it("registers 0040 after lifecycle scheduler migration", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-2)?.tag).toBe("0039_lifecycle_scheduler_c1");
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 40,
      tag: "0040_booking_waitlist_d1",
    });
  });
});
